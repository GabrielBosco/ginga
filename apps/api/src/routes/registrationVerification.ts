import { randomBytes, randomInt, randomUUID, scryptSync, timingSafeEqual } from "node:crypto";
import { Router, type NextFunction, type Request, type Response } from "express";
import nodemailer from "nodemailer";
import { z } from "zod";
import { config } from "../config.js";
import { prisma } from "../db.js";
import { assertDeliverableEmail, assertPasswordNotPwned } from "../credentialSecurity.js";

const CODE_TTL_MS = 10 * 60 * 1000;
const REQUEST_WINDOW_MS = 15 * 60 * 1000;
const MAX_REQUESTS_PER_EMAIL = 4;
const MAX_REQUESTS_PER_IP = 12;
const MAX_CODE_ATTEMPTS = 5;

type Challenge = {
  id: string;
  email: string;
  username: string;
  salt: Buffer;
  codeHash: Buffer;
  expiresAt: number;
  attempts: number;
};

type RateBucket = {
  count: number;
  resetAt: number;
};

const challenges = new Map<string, Challenge>();
const activeChallengeByEmail = new Map<string, string>();
const emailBuckets = new Map<string, RateBucket>();
const ipBuckets = new Map<string, RateBucket>();

const requestCodeSchema = z.object({
  email: z.string().trim().email().max(160),
  username: z.string().trim().min(3).max(24),
  displayName: z.string().trim().min(2).max(32),
  password: z.string().min(8).max(128).optional()
});

function isVerificationRequired() {
  return config.emailVerificationRequired;
}

function emailProvider() {
  return String(process.env.EMAIL_PROVIDER ?? "resend").trim().toLowerCase();
}

function emailServiceReady() {
  if (!isVerificationRequired()) return true;

  const provider = emailProvider();
  const from = String(process.env.EMAIL_FROM ?? "").trim();

  if (provider === "resend") {
    return Boolean(String(process.env.RESEND_API_KEY ?? "").trim() && from);
  }

  if (provider === "smtp") {
    return Boolean(
      String(process.env.SMTP_HOST ?? "").trim()
      && String(process.env.SMTP_USER ?? "").trim()
      && String(process.env.SMTP_PASSWORD ?? "").trim()
      && from
    );
  }

  return false;
}

function cleanupExpired(now = Date.now()) {
  for (const [id, challenge] of challenges) {
    if (challenge.expiresAt > now) continue;
    challenges.delete(id);
    if (activeChallengeByEmail.get(challenge.email) === id) activeChallengeByEmail.delete(challenge.email);
  }

  for (const [key, bucket] of emailBuckets) {
    if (bucket.resetAt <= now) emailBuckets.delete(key);
  }
  for (const [key, bucket] of ipBuckets) {
    if (bucket.resetAt <= now) ipBuckets.delete(key);
  }
}

function hitRateLimit(store: Map<string, RateBucket>, key: string, limit: number, now = Date.now()) {
  const current = store.get(key);
  if (!current || current.resetAt <= now) {
    store.set(key, { count: 1, resetAt: now + REQUEST_WINDOW_MS });
    return 0;
  }

  if (current.count >= limit) return Math.max(1, Math.ceil((current.resetAt - now) / 1000));
  current.count += 1;
  return 0;
}

function hashCode(code: string, salt: Buffer) {
  return scryptSync(code, salt, 32);
}

function codesMatch(code: string, challenge: Challenge) {
  const candidate = hashCode(code, challenge.salt);
  return candidate.length === challenge.codeHash.length && timingSafeEqual(candidate, challenge.codeHash);
}

function escapeHtml(value: string) {
  return value.replace(/[&<>'"]/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "'": "&#39;",
    '"': "&quot;"
  })[char] ?? char);
}

async function sendVerificationEmail(email: string, displayName: string, code: string) {
  const provider = emailProvider();
  const from = String(process.env.EMAIL_FROM ?? "").trim();
  if (!from) throw new Error("EMAIL_FROM nao configurado");

  const safeName = escapeHtml(displayName || "usuario");
  const safeCode = escapeHtml(code);
  const subject = "Seu codigo de verificacao do Ginga";
  const text = `Ola, ${displayName || "usuario"}. Seu codigo de verificacao do Ginga e ${code}. Ele expira em 10 minutos. Se voce nao solicitou este cadastro, ignore esta mensagem.`;
  const html = `<div style="font-family:Inter,Segoe UI,Arial,sans-serif;background:#101318;color:#e9edf2;padding:28px;border-radius:14px;max-width:520px"><div style="font-size:20px;font-weight:800;margin-bottom:18px">Ginga</div><p>Ola, ${safeName}.</p><p>Use este codigo para confirmar seu e-mail e concluir o cadastro:</p><div style="font-size:32px;font-weight:900;letter-spacing:8px;padding:18px 0;color:#9cc8b8">${safeCode}</div><p style="color:#a8b0ba">O codigo expira em 10 minutos. Se voce nao solicitou este cadastro, pode ignorar esta mensagem.</p></div>`;

  if (provider === "resend") {
    const apiKey = String(process.env.RESEND_API_KEY ?? "").trim();
    if (!apiKey) throw new Error("RESEND_API_KEY nao configurada");

    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        from,
        to: [email],
        subject,
        text,
        html
      })
    });

    if (!response.ok) {
      const detail = (await response.text()).slice(0, 300);
      console.error("Falha ao enviar codigo de verificacao via Resend", response.status, detail);
      throw new Error("Falha ao enviar o e-mail de verificacao");
    }
    return;
  }

  if (provider === "smtp") {
    const host = String(process.env.SMTP_HOST ?? "").trim();
    const user = String(process.env.SMTP_USER ?? "").trim();
    const pass = String(process.env.SMTP_PASSWORD ?? "").replace(/\s+/g, "").trim();
    const port = Number.parseInt(String(process.env.SMTP_PORT ?? "587"), 10);
    const secure = String(process.env.SMTP_SECURE ?? "false").trim().toLowerCase() === "true" || port === 465;

    if (!host || !user || !pass || !Number.isInteger(port) || port < 1 || port > 65535) {
      throw new Error("Configuracao SMTP invalida");
    }

    const transporter = nodemailer.createTransport({
      host,
      port,
      secure,
      requireTLS: !secure,
      auth: { user, pass },
      connectionTimeout: 10000,
      greetingTimeout: 10000,
      socketTimeout: 15000
    });

    await transporter.sendMail({
      from,
      to: email,
      subject,
      text,
      html
    });
    return;
  }

  throw new Error("EMAIL_PROVIDER nao suportado");
}

function sendConfigurationError(res: Response) {
  return res.status(503).json({
    error: "Cadastro por e-mail ainda nao foi configurado pelo administrador. Use EMAIL_PROVIDER=resend com RESEND_API_KEY, ou EMAIL_PROVIDER=smtp com SMTP_HOST/SMTP_USER/SMTP_PASSWORD, e configure EMAIL_FROM."
  });
}

export const registrationVerificationRouter = Router();

registrationVerificationRouter.get("/registration-policy", (_req, res) => {
  res.json({
    required: isVerificationRequired(),
    available: emailServiceReady(),
    provider: ["resend", "smtp"].includes(emailProvider()) ? "email" : "indisponivel",
    codeLength: 6,
    expiresInSeconds: CODE_TTL_MS / 1000
  });
});

registrationVerificationRouter.post("/register/code", async (req, res) => {
  cleanupExpired();

  if (!isVerificationRequired()) {
    return res.json({ required: false, challengeId: null, expiresInSeconds: 0 });
  }
  if (!emailServiceReady()) return sendConfigurationError(res);

  const parsed = requestCodeSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Revise nome, usuario e e-mail antes de continuar." });

  const email = parsed.data.email.toLowerCase();
  const username = parsed.data.username.toLowerCase();
  await assertDeliverableEmail(email);
  if (parsed.data.password) await assertPasswordNotPwned(parsed.data.password);
  const existing = await prisma.user.findFirst({ where: { OR: [{ email }, { username }] }, select: { email: true, username: true } });
  if (existing?.email === email) return res.status(409).json({ error: "Este e-mail ja esta cadastrado.", field: "email" });
  if (existing?.username === username) return res.status(409).json({ error: "Este nome de usuario ja esta em uso.", field: "username" });
  const ip = req.ip || req.socket.remoteAddress || "unknown";
  const emailRetryAfter = hitRateLimit(emailBuckets, email, MAX_REQUESTS_PER_EMAIL);
  const ipRetryAfter = hitRateLimit(ipBuckets, ip, MAX_REQUESTS_PER_IP);
  const retryAfter = Math.max(emailRetryAfter, ipRetryAfter);

  if (retryAfter > 0) {
    res.setHeader("Retry-After", String(retryAfter));
    return res.status(429).json({ error: "Muitos codigos solicitados. Aguarde alguns minutos e tente novamente." });
  }

  const previousId = activeChallengeByEmail.get(email);
  if (previousId) challenges.delete(previousId);

  const code = String(randomInt(100000, 1000000));
  const salt = randomBytes(16);
  const challenge: Challenge = {
    id: randomUUID(),
    email,
    username,
    salt,
    codeHash: hashCode(code, salt),
    expiresAt: Date.now() + CODE_TTL_MS,
    attempts: 0
  };

  challenges.set(challenge.id, challenge);
  activeChallengeByEmail.set(email, challenge.id);

  try {
    await sendVerificationEmail(email, parsed.data.displayName, code);
  } catch (error) {
    challenges.delete(challenge.id);
    if (activeChallengeByEmail.get(email) === challenge.id) activeChallengeByEmail.delete(email);
    console.error(error);
    return res.status(502).json({ error: "Nao foi possivel enviar o codigo agora. Tente novamente em instantes." });
  }

  return res.status(201).json({
    required: true,
    challengeId: challenge.id,
    expiresInSeconds: CODE_TTL_MS / 1000
  });
});

registrationVerificationRouter.post("/register", (req: Request, res: Response, next: NextFunction) => {
  cleanupExpired();
  if (!isVerificationRequired()) return next();
  if (!emailServiceReady()) return sendConfigurationError(res);

  const body = req.body && typeof req.body === "object" ? req.body as Record<string, unknown> : {};
  const challengeId = String(body.challengeId ?? "").trim();
  const verificationCode = String(body.verificationCode ?? "").replace(/\D/g, "");
  const email = String(body.email ?? "").trim().toLowerCase();
  const username = String(body.username ?? "").trim().toLowerCase();

  if (!challengeId || !/^\d{6}$/.test(verificationCode)) {
    return res.status(400).json({ error: "Confirme seu e-mail com o codigo de 6 digitos antes de criar a conta." });
  }

  const challenge = challenges.get(challengeId);
  if (!challenge || challenge.expiresAt <= Date.now()) {
    if (challenge) challenges.delete(challenge.id);
    return res.status(400).json({ error: "Esse codigo expirou. Solicite um novo codigo de verificacao." });
  }

  if (challenge.email !== email || challenge.username !== username) {
    return res.status(400).json({ error: "Os dados do cadastro mudaram. Solicite um novo codigo de verificacao." });
  }

  challenge.attempts += 1;
  if (challenge.attempts > MAX_CODE_ATTEMPTS) {
    challenges.delete(challenge.id);
    if (activeChallengeByEmail.get(challenge.email) === challenge.id) activeChallengeByEmail.delete(challenge.email);
    return res.status(429).json({ error: "Limite de tentativas excedido. Solicite um novo codigo." });
  }

  if (!codesMatch(verificationCode, challenge)) {
    return res.status(400).json({ error: "Codigo de verificacao incorreto." });
  }

  challenges.delete(challenge.id);
  if (activeChallengeByEmail.get(challenge.email) === challenge.id) activeChallengeByEmail.delete(challenge.email);
  delete body.challengeId;
  delete body.verificationCode;
  req.body = body;
  return next();
});
