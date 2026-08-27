import { Prisma } from "@prisma/client";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { Router } from "express";
import rateLimit from "express-rate-limit";
import nodemailer from "nodemailer";
import { z } from "zod";
import { publicUser, signToken } from "../auth.js";
import { createAuthSession, listAuthSessions, replaceCurrentAuthSession, revokeAllAuthSessions, revokeAuthSession } from "../authSessions.js";
import { config } from "../config.js";
import { prisma } from "../db.js";
import { asyncHandler, HttpError } from "../errors.js";
import { requireAuth } from "../middleware.js";
import { hashPassword, verifyPassword } from "../password.js";
import { randomColor } from "../utils.js";
import { assertDeliverableEmail, assertPasswordNotPwned } from "../credentialSecurity.js";
import {
  createTwoFactorLoginChallenge, createTwoFactorSetup, disableTwoFactor, enableTwoFactor,
  isTwoFactorEnabled, regenerateRecoveryCodes, twoFactorStatus, verifyTwoFactorCode,
  verifyTwoFactorLoginChallenge
} from "../twoFactor.js";

export const authRouter = Router();

const loginLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: config.AUTH_LOGIN_LIMIT_10M,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  message: { error: "Muitas tentativas de login. Aguarde alguns minutos." }
});

const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: config.AUTH_REGISTER_LIMIT_HOUR,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Muitos cadastros a partir deste endereco. Tente novamente mais tarde." }
});

const sensitiveActionLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 20,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Muitas tentativas. Aguarde alguns minutos." }
});

const twoFactorLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 30,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Muitas tentativas de verificacao em duas etapas. Aguarde alguns minutos." }
});

const passwordPolicyLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 40,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Muitas verificacoes de senha. Aguarde alguns minutos." }
});


const passwordResetRequestLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 8,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Muitas solicitacoes de redefinicao. Aguarde alguns minutos." }
});

const passwordResetConfirmLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Muitas tentativas de redefinicao. Aguarde alguns minutos." }
});

const PASSWORD_RESET_TTL_MS = 30 * 60 * 1000;
let passwordResetStoragePromise: Promise<void> | null = null;

function ensurePasswordResetStorage() {
  if (!passwordResetStoragePromise) {
    passwordResetStoragePromise = (async () => {
      await prisma.$executeRawUnsafe(`
        CREATE TABLE IF NOT EXISTS "GingaPasswordResetToken" (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL,
          token_hash VARCHAR(64) NOT NULL UNIQUE,
          expires_at TIMESTAMPTZ NOT NULL,
          used_at TIMESTAMPTZ NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);
      await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "ginga_password_reset_user_idx" ON "GingaPasswordResetToken" (user_id, created_at DESC)`);
      await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "ginga_password_reset_active_idx" ON "GingaPasswordResetToken" (token_hash, expires_at, used_at)`);
    })().catch((error) => {
      passwordResetStoragePromise = null;
      throw error;
    });
  }
  return passwordResetStoragePromise;
}

function passwordResetEmailProvider() {
  return String(process.env.EMAIL_PROVIDER ?? "resend").trim().toLowerCase();
}

function passwordResetEmailReady() {
  const provider = passwordResetEmailProvider();
  const from = String(process.env.EMAIL_FROM ?? "").trim();
  if (!from) return false;
  if (provider === "resend") return Boolean(String(process.env.RESEND_API_KEY ?? "").trim());
  if (provider === "smtp") {
    return Boolean(
      String(process.env.SMTP_HOST ?? "").trim()
      && String(process.env.SMTP_USER ?? "").trim()
      && String(process.env.SMTP_PASSWORD ?? "").trim()
    );
  }
  return false;
}

function escapeMailHtml(value: string) {
  return value.replace(/[&<>'"]/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "'": "&#39;",
    '"': "&quot;"
  })[char] ?? char);
}

async function sendConfiguredMail(to: string, subject: string, text: string, html: string) {
  const provider = passwordResetEmailProvider();
  const from = String(process.env.EMAIL_FROM ?? "").trim();
  if (!from) throw new Error("EMAIL_FROM nao configurado");

  if (provider === "resend") {
    const apiKey = String(process.env.RESEND_API_KEY ?? "").trim();
    if (!apiKey) throw new Error("RESEND_API_KEY nao configurada");
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to: [to], subject, text, html })
    });
    if (!response.ok) throw new Error(`Falha ao enviar e-mail via Resend (${response.status})`);
    return;
  }

  if (provider === "smtp") {
    const host = String(process.env.SMTP_HOST ?? "").trim();
    const user = String(process.env.SMTP_USER ?? "").trim();
    const pass = String(process.env.SMTP_PASSWORD ?? "").replace(/\s+/g, "").trim();
    const port = Number.parseInt(String(process.env.SMTP_PORT ?? "587"), 10);
    const secure = String(process.env.SMTP_SECURE ?? "false").trim().toLowerCase() === "true" || port === 465;
    if (!host || !user || !pass || !Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Configuracao SMTP invalida");
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
    await transporter.sendMail({ from, to, subject, text, html });
    return;
  }

  throw new Error("EMAIL_PROVIDER nao suportado");
}

function resetBaseUrl() {
  const configured = String(process.env.PASSWORD_RESET_BASE_URL ?? "").trim();
  const preferred = configured || config.appOrigins.find((origin) => !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin)) || config.appOrigins[0];
  if (!preferred) throw new Error("URL publica do Ginga nao configurada");
  const url = new URL(preferred);
  return url.origin;
}

function hashResetToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

async function sendPasswordResetEmail(email: string, displayName: string, token: string) {
  const url = new URL("/reset-password", resetBaseUrl());
  url.searchParams.set("token", token);
  const safeName = escapeMailHtml(displayName || "usuario");
  const safeUrl = escapeMailHtml(url.toString());
  const subject = "Redefinicao de senha do Ginga";
  const text = `Ola, ${displayName || "usuario"}. Recebemos uma solicitacao para redefinir sua senha do Ginga. Abra este link em ate 30 minutos: ${url.toString()} . Se voce nao pediu a troca, ignore este e-mail.`;
  const html = `<div style="font-family:Inter,Segoe UI,Arial,sans-serif;background:#101318;color:#e9edf2;padding:28px;border-radius:14px;max-width:560px"><div style="font-size:20px;font-weight:800;margin-bottom:18px">Ginga</div><p>Ola, ${safeName}.</p><p>Recebemos uma solicitacao para redefinir sua senha. O link abaixo funciona uma unica vez e expira em 30 minutos.</p><p style="margin:24px 0"><a href="${safeUrl}" style="display:inline-block;background:#e9edf2;color:#101318;text-decoration:none;font-weight:800;padding:12px 18px;border-radius:8px">Redefinir minha senha</a></p><p style="color:#a8b0ba;word-break:break-all">${safeUrl}</p><p style="color:#a8b0ba">Se voce nao solicitou esta troca, ignore a mensagem. Sua senha atual continua valida.</p></div>`;
  await sendConfiguredMail(email, subject, text, html);
}

async function sendPasswordChangedEmail(email: string, displayName: string) {
  const safeName = escapeMailHtml(displayName || "usuario");
  const subject = "Sua senha do Ginga foi alterada";
  const text = `Ola, ${displayName || "usuario"}. A senha da sua conta Ginga foi alterada. Todas as sessoes anteriores foram encerradas. Se nao foi voce, entre em contato com o administrador imediatamente.`;
  const html = `<div style="font-family:Inter,Segoe UI,Arial,sans-serif;background:#101318;color:#e9edf2;padding:28px;border-radius:14px;max-width:560px"><div style="font-size:20px;font-weight:800;margin-bottom:18px">Ginga</div><p>Ola, ${safeName}.</p><p>A senha da sua conta foi alterada com sucesso.</p><p style="color:#a8b0ba">Por seguranca, todas as sessoes anteriores foram encerradas. Se nao foi voce, procure o administrador do Ginga imediatamente.</p></div>`;
  await sendConfiguredMail(email, subject, text, html);
}

const registerSchema = z.object({
  email: z.string().trim().email("Digite um e-mail valido.").max(160, "O e-mail e muito longo.").transform((value) => value.toLowerCase()),
  username: z.string().trim().min(3, "O nome de usuario precisa ter pelo menos 3 caracteres.").max(24, "O nome de usuario pode ter no maximo 24 caracteres.").regex(/^[a-zA-Z0-9_.-]+$/, "Use apenas letras, numeros, ponto, traco ou underline no usuario.").transform((value) => value.toLowerCase()),
  displayName: z.string().trim().min(2, "O nome exibido precisa ter pelo menos 2 caracteres.").max(32, "O nome exibido pode ter no maximo 32 caracteres."),
  password: z.string().min(8, "A senha precisa ter pelo menos 8 caracteres.").max(128, "A senha e muito longa.")
});

const loginSchema = z.object({
  login: z.string().trim().min(3).max(160).transform((value) => value.toLowerCase()),
  password: z.string().min(1).max(128)
});

const twoFactorLoginSchema = z.object({
  challengeId: z.string().trim().min(32).max(200),
  code: z.string().trim().min(6).max(32)
});

const twoFactorCodeSchema = z.object({ code: z.string().trim().min(6).max(32) });
const twoFactorDisableSchema = z.object({
  password: z.string().min(1).max(128),
  code: z.string().trim().min(6).max(32)
});

const passwordPolicySchema = z.object({ password: z.string().min(8).max(128) });

const profileSchema = z.object({
  displayName: z.string().trim().min(2).max(32).optional(),
  bio: z.string().trim().max(240).optional(),
  statusMessage: z.string().trim().max(80).optional(),
  avatarColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  allowFriendRequests: z.boolean().optional(),
  allowDirectMessages: z.boolean().optional()
}).refine((value) => Object.keys(value).length > 0, { message: "Nenhuma alteracao informada" });

const passwordResetRequestSchema = z.object({
  email: z.string().trim().email("Digite um e-mail valido.").max(160).transform((value) => value.toLowerCase())
});

const passwordResetConfirmSchema = z.object({
  token: z.string().trim().min(32).max(200),
  newPassword: z.string().min(8, "A nova senha precisa ter pelo menos 8 caracteres.").max(128, "A nova senha e muito longa.")
});

const DUMMY_HASH = "scrypt$6e65786f72612d64756d6d792d73616c74$970e66a1ef7c09db146b2b4464e53358845b69e0bd92d402e1b5bca95d2e4122d69f278d597b48370a330004e71bbfb80c6abd0c7253c89368bd410a6185b8a7";

function accountLockedMessage(until: Date) {
  const minutes = Math.max(1, Math.ceil((until.getTime() - Date.now()) / 60_000));
  return `Conta temporariamente bloqueada por excesso de tentativas. Tente novamente em cerca de ${minutes} minuto(s).`;
}

authRouter.post("/register", registerLimiter, asyncHandler(async (req, res) => {
  if (!config.allowRegistration) throw new HttpError(403, "Novos cadastros estao desativados neste servidor");
  const data = registerSchema.parse(req.body);
  await Promise.all([config.emailVerificationRequired ? Promise.resolve() : assertDeliverableEmail(data.email), assertPasswordNotPwned(data.password)]);
  const existingAccount = await prisma.user.findFirst({
    where: { OR: [{ email: data.email }, { username: data.username }] },
    select: { email: true, username: true }
  });
  if (existingAccount?.email === data.email) throw new HttpError(409, "Este e-mail ja esta cadastrado.", { field: "email" });
  if (existingAccount?.username === data.username) throw new HttpError(409, "Este nome de usuario ja esta em uso.", { field: "username" });
  const passwordHash = await hashPassword(data.password);

  try {
    const result = await prisma.$transaction(async (tx) => {
      const humanCount = await tx.user.count({ where: { accountType: "HUMAN" } });
      const shouldOwnPlatform = config.platformOwnerUsername === data.username || (config.allowFirstUserPlatformOwner && humanCount === 0);
      const user = await tx.user.create({
        data: {
          email: data.email,
          username: data.username,
          displayName: data.displayName,
          passwordHash,
          avatarColor: randomColor(),
          systemRole: shouldOwnPlatform ? "PLATFORM_ADMIN" : "USER",
          platformOwner: shouldOwnPlatform,
          accountType: "HUMAN"
        }
      });

      // Conta nova comeca sem servidor. O onboarding do cliente oferece
      // explicitamente Criar servidor ou Entrar com codigo de convite.
      // Isso evita criar dados que o usuario nunca pediu e deixa o primeiro
      // acesso previsivel para contas humanas, bots e futuras automacoes.
      return { user };
    });

    const sessionId = await createAuthSession(result.user.id, req);
    res.status(201).json({ token: signToken(result.user, sessionId), user: publicUser(result.user), initialGuildId: null });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new HttpError(409, "E-mail ou nome de usuario ja esta em uso. Tente outro valor.");
    }
    throw error;
  }
}));

authRouter.post("/login", loginLimiter, asyncHandler(async (req, res) => {
  const data = loginSchema.parse(req.body);
  const user = await prisma.user.findFirst({
    where: { accountType: "HUMAN", OR: [{ email: data.login }, { username: data.login }] }
  });

  if (!user) {
    await verifyPassword(data.password, DUMMY_HASH);
    throw new HttpError(401, "Usuario/e-mail ou senha incorretos");
  }

  if (user.accountDisabled) throw new HttpError(403, user.accountDisabledReason || "Esta conta foi desativada por um administrador do Ginga.");

  if (user.loginLockedUntil && user.loginLockedUntil.getTime() > Date.now()) {
    throw new HttpError(429, accountLockedMessage(user.loginLockedUntil));
  }

  const valid = await verifyPassword(data.password, user.passwordHash);
  if (!valid) {
    const failed = user.failedLoginAttempts + 1;
    const lockNow = failed >= config.AUTH_MAX_FAILED_ATTEMPTS;
    await prisma.user.update({
      where: { id: user.id },
      data: {
        failedLoginAttempts: lockNow ? 0 : failed,
        loginLockedUntil: lockNow ? new Date(Date.now() + config.authLockMs) : null
      }
    });
    if (lockNow) throw new HttpError(429, `Conta temporariamente bloqueada por ${config.AUTH_LOCK_MINUTES} minuto(s).`);
    throw new HttpError(401, "Usuario/e-mail ou senha incorretos");
  }

  const twoFactorEnabled = await isTwoFactorEnabled(user.id);
  const updated = await prisma.user.update({
    where: { id: user.id },
    data: { failedLoginAttempts: 0, loginLockedUntil: null, ...(twoFactorEnabled ? {} : { lastLoginAt: new Date() }) }
  });

  if (twoFactorEnabled) {
    const challenge = await createTwoFactorLoginChallenge(updated.id);
    return res.json({ twoFactorRequired: true, ...challenge });
  }

  const sessionId = await createAuthSession(updated.id, req);
  return res.json({ token: signToken(updated, sessionId), user: publicUser(updated) });
}));

authRouter.post("/login/2fa", twoFactorLimiter, asyncHandler(async (req, res) => {
  const data = twoFactorLoginSchema.parse(req.body);
  const userId = await verifyTwoFactorLoginChallenge(data.challengeId, data.code);
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user || user.accountType !== "HUMAN" || user.accountDisabled) throw new HttpError(401, "Conta indisponivel.");
  const updated = await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
  const sessionId = await createAuthSession(updated.id, req);
  return res.json({ token: signToken(updated, sessionId), user: publicUser(updated) });
}));

authRouter.get("/me", requireAuth, asyncHandler(async (req, res) => {
  const user = await prisma.user.findUnique({ where: { id: req.auth!.sub } });
  if (!user) throw new HttpError(401, "Usuario nao encontrado");
  res.json({ user: publicUser({ ...user, email: user.email }) });
}));

authRouter.patch("/me", requireAuth, asyncHandler(async (req, res) => {
  if (req.body && typeof req.body === "object" && Object.prototype.hasOwnProperty.call(req.body, "username")) {
    throw new HttpError(400, "O nome de usuario e permanente e nao pode ser alterado depois do cadastro.", { field: "username" });
  }
  const data = profileSchema.parse(req.body);
  try {
    const user = await prisma.user.update({
      where: { id: req.auth!.sub },
      data
    });
    res.json({ token: signToken(user, req.auth!.sid), user: publicUser({ ...user, email: user.email }) });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new HttpError(409, "Este nome de usuario ja esta em uso");
    }
    throw error;
  }
}));

authRouter.post("/password-reset/request", passwordResetRequestLimiter, asyncHandler(async (req, res) => {
  if (!passwordResetEmailReady()) throw new HttpError(503, "A recuperacao de senha por e-mail ainda nao foi configurada pelo administrador.");
  const data = passwordResetRequestSchema.parse(req.body);
  await ensurePasswordResetStorage();

  // Resposta deliberadamente generica para nao revelar se um e-mail possui conta.
  const genericResponse = { ok: true, message: "Se existir uma conta com este e-mail, enviaremos um link de redefinicao." };
  const user = await prisma.user.findFirst({
    where: { email: data.email, accountType: "HUMAN" },
    select: { id: true, email: true, displayName: true, accountDisabled: true }
  });
  if (!user || user.accountDisabled) return res.status(202).json(genericResponse);

  await prisma.$executeRawUnsafe(`DELETE FROM "GingaPasswordResetToken" WHERE expires_at < NOW() - INTERVAL '7 days' OR used_at < NOW() - INTERVAL '7 days'`);
  await prisma.$executeRawUnsafe(`UPDATE "GingaPasswordResetToken" SET used_at=COALESCE(used_at,NOW()) WHERE user_id=$1 AND used_at IS NULL`, user.id);

  const token = randomBytes(32).toString("base64url");
  const tokenHash = hashResetToken(token);
  const tokenId = randomUUID();
  const expiresAt = new Date(Date.now() + PASSWORD_RESET_TTL_MS);
  await prisma.$executeRawUnsafe(
    `INSERT INTO "GingaPasswordResetToken" (id,user_id,token_hash,expires_at) VALUES ($1,$2,$3,$4)`,
    tokenId,
    user.id,
    tokenHash,
    expiresAt
  );

  // O envio ocorre fora do caminho da resposta para reduzir diferencas de tempo
  // entre e-mails cadastrados e nao cadastrados (protege contra enumeracao).
  void sendPasswordResetEmail(user.email, user.displayName, token).catch(async (error) => {
    await prisma.$executeRawUnsafe(`DELETE FROM "GingaPasswordResetToken" WHERE id=$1`, tokenId).catch(() => undefined);
    console.error("Falha ao enviar redefinicao de senha", error);
  });

  return res.status(202).json(genericResponse);
}));

authRouter.post("/password-reset/confirm", passwordResetConfirmLimiter, asyncHandler(async (req, res) => {
  const data = passwordResetConfirmSchema.parse(req.body);
  await ensurePasswordResetStorage();
  const tokenHash = hashResetToken(data.token);
  const preliminaryRows = await prisma.$queryRawUnsafe<Array<{ userId: string; expiresAt: Date; usedAt: Date | null }>>(
    `SELECT user_id AS "userId",expires_at AS "expiresAt",used_at AS "usedAt" FROM "GingaPasswordResetToken" WHERE token_hash=$1 LIMIT 1`,
    tokenHash
  );
  const preliminary = preliminaryRows[0];
  if (!preliminary || preliminary.usedAt || preliminary.expiresAt.getTime() <= Date.now()) {
    throw new HttpError(400, "Este link de redefinicao e invalido, ja foi usado ou expirou.");
  }
  await assertPasswordNotPwned(data.newPassword, "newPassword");
  const newPasswordHash = await hashPassword(data.newPassword);

  const result = await prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRawUnsafe<Array<{ id: string; userId: string; expiresAt: Date; usedAt: Date | null }>>(
      `SELECT id,user_id AS "userId",expires_at AS "expiresAt",used_at AS "usedAt" FROM "GingaPasswordResetToken" WHERE token_hash=$1 FOR UPDATE`,
      tokenHash
    );
    const reset = rows[0];
    if (!reset || reset.usedAt || reset.expiresAt.getTime() <= Date.now()) return null;

    const user = await tx.user.findUnique({ where: { id: reset.userId } });
    if (!user || user.accountType !== "HUMAN" || user.accountDisabled) return null;
    if (await verifyPassword(data.newPassword, user.passwordHash)) {
      throw new HttpError(400, "Escolha uma senha diferente da senha atual.", { field: "newPassword" });
    }

    const updated = await tx.user.update({
      where: { id: user.id },
      data: {
        passwordHash: newPasswordHash,
        tokenVersion: { increment: 1 },
        failedLoginAttempts: 0,
        loginLockedUntil: null
      },
      select: { id: true, email: true, displayName: true }
    });
    await tx.$executeRawUnsafe(`UPDATE "GingaPasswordResetToken" SET used_at=NOW() WHERE user_id=$1 AND used_at IS NULL`, user.id);
    return updated;
  });

  if (!result) throw new HttpError(400, "Este link de redefinicao e invalido, ja foi usado ou expirou.");
  await revokeAllAuthSessions(result.id);
  req.app.get("io")?.in?.(`user:${result.id}`)?.disconnectSockets?.(true);
  void sendPasswordChangedEmail(result.email, result.displayName).catch((error) => console.warn("Falha ao enviar aviso de senha alterada", error));
  res.json({ ok: true, message: "Senha alterada. Entre novamente com a nova senha." });
}));

authRouter.post("/password", requireAuth, sensitiveActionLimiter, asyncHandler(async (_req, res) => {
  res.status(410).json({ error: "A alteracao direta de senha foi desativada. Solicite um link de redefinicao por e-mail." });
}));

authRouter.post("/password-policy/check", passwordPolicyLimiter, asyncHandler(async (req, res) => {
  const data = passwordPolicySchema.parse(req.body);
  await assertPasswordNotPwned(data.password);
  res.json({ ok: true });
}));

authRouter.get("/2fa/status", requireAuth, asyncHandler(async (req, res) => {
  res.json(await twoFactorStatus(req.auth!.sub));
}));

authRouter.post("/2fa/setup", requireAuth, twoFactorLimiter, asyncHandler(async (req, res) => {
  const user = await prisma.user.findUnique({ where: { id: req.auth!.sub }, select: { username: true } });
  if (!user) throw new HttpError(404, "Conta nao encontrada.");
  if (await isTwoFactorEnabled(req.auth!.sub)) throw new HttpError(409, "A verificacao em duas etapas ja esta ativa.");
  res.json(await createTwoFactorSetup(req.auth!.sub, user.username));
}));

authRouter.post("/2fa/enable", requireAuth, twoFactorLimiter, asyncHandler(async (req, res) => {
  const data = twoFactorCodeSchema.parse(req.body);
  const recoveryCodes = await enableTwoFactor(req.auth!.sub, data.code);
  const user = await prisma.user.update({ where: { id: req.auth!.sub }, data: { tokenVersion: { increment: 1 } } });
  const sessionId = await replaceCurrentAuthSession(user.id, req, req.auth!.sid);
  res.json({ recoveryCodes, token: signToken(user, sessionId), user: publicUser(user) });
}));

authRouter.post("/2fa/recovery-codes", requireAuth, twoFactorLimiter, asyncHandler(async (req, res) => {
  const data = twoFactorCodeSchema.parse(req.body);
  const verified = await verifyTwoFactorCode(req.auth!.sub, data.code);
  if (!verified.ok) throw new HttpError(401, "Codigo do autenticador invalido.");
  res.json({ recoveryCodes: await regenerateRecoveryCodes(req.auth!.sub) });
}));

authRouter.post("/2fa/disable", requireAuth, twoFactorLimiter, asyncHandler(async (req, res) => {
  const data = twoFactorDisableSchema.parse(req.body);
  const user = await prisma.user.findUnique({ where: { id: req.auth!.sub } });
  if (!user || user.accountType !== "HUMAN") throw new HttpError(404, "Conta nao encontrada.");
  if (!(await verifyPassword(data.password, user.passwordHash))) throw new HttpError(401, "Senha atual incorreta.", { field: "password" });
  const verified = await verifyTwoFactorCode(user.id, data.code);
  if (!verified.ok) throw new HttpError(401, "Codigo do autenticador invalido.", { field: "code" });
  await disableTwoFactor(user.id);
  const updated = await prisma.user.update({ where: { id: user.id }, data: { tokenVersion: { increment: 1 } } });
  const sessionId = await replaceCurrentAuthSession(updated.id, req, req.auth!.sid);
  res.json({ token: signToken(updated, sessionId), user: publicUser(updated) });
}));

authRouter.get("/sessions", requireAuth, asyncHandler(async (req, res) => {
  res.json({ sessions: await listAuthSessions(req.auth!.sub, req.auth!.sid) });
}));

authRouter.delete("/sessions/:sessionId", requireAuth, sensitiveActionLimiter, asyncHandler(async (req, res) => {
  const sessionId = String(req.params.sessionId || "").trim();
  if (!sessionId) throw new HttpError(400, "Sessao invalida");
  if (sessionId === req.auth!.sid) throw new HttpError(409, "Use Sair para encerrar este dispositivo");
  if (!(await revokeAuthSession(req.auth!.sub, sessionId))) throw new HttpError(404, "Sessao ativa nao encontrada");
  res.status(204).end();
}));

authRouter.post("/logout-all", requireAuth, sensitiveActionLimiter, asyncHandler(async (req, res) => {
  const user = await prisma.user.update({
    where: { id: req.auth!.sub },
    data: { tokenVersion: { increment: 1 } }
  });
  const sessionId = await replaceCurrentAuthSession(user.id, req, req.auth!.sid);
  res.json({ token: signToken(user, sessionId), user: publicUser({ ...user, email: user.email }) });
}));
