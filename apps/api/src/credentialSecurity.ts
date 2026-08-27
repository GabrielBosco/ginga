import { createHash } from "node:crypto";
import { resolve4, resolve6, resolveMx } from "node:dns/promises";
import { HttpError } from "./errors.js";

const DNS_CACHE_TTL_MS = 15 * 60 * 1000;
const PWNED_CACHE_TTL_MS = 30 * 60 * 1000;
const dnsCache = new Map<string, { ok: boolean; expiresAt: number }>();
const pwnedCache = new Map<string, { count: number; expiresAt: number }>();

function pruneCache<T extends { expiresAt: number }>(cache: Map<string, T>, maxEntries = 2500) {
  if (cache.size < maxEntries) return;
  const now = Date.now();
  for (const [key, value] of cache) if (value.expiresAt <= now) cache.delete(key);
  while (cache.size >= maxEntries) {
    const first = cache.keys().next().value as string | undefined;
    if (!first) break;
    cache.delete(first);
  }
}

const disposableDomains = new Set([
  "10minutemail.com", "guerrillamail.com", "guerrillamail.net", "mailinator.com", "maildrop.cc",
  "minuteinbox.com", "mohmal.com", "sharklasers.com", "temp-mail.org", "tempmail.com",
  "throwawaymail.com", "trashmail.com", "yopmail.com", "yopmail.fr", "yopmail.net"
]);

function emailDomain(email: string) {
  const at = email.lastIndexOf("@");
  return at >= 0 ? email.slice(at + 1).trim().toLowerCase().replace(/\.$/, "") : "";
}

function dnsErrorCode(error: unknown) {
  return typeof error === "object" && error && "code" in error ? String((error as { code?: unknown }).code ?? "") : "";
}

async function hasMailAddressFallback(domain: string) {
  // RFC 5321 permite entrega no A/AAAA do dominio quando nao existe MX.
  // Isso evita barrar dominios legitimos que nao publicam um registro MX explicito.
  try {
    const ipv4 = await resolve4(domain);
    if (ipv4.length) return true;
  } catch (error) {
    const code = dnsErrorCode(error);
    if (!["ENODATA", "ENOTFOUND", "ENONAME"].includes(code)) throw error;
  }
  try {
    const ipv6 = await resolve6(domain);
    if (ipv6.length) return true;
  } catch (error) {
    const code = dnsErrorCode(error);
    if (!["ENODATA", "ENOTFOUND", "ENONAME"].includes(code)) throw error;
  }
  return false;
}

export async function assertDeliverableEmail(email: string) {
  const domain = emailDomain(email);
  if (!domain || domain.length > 253 || domain === "localhost" || domain.endsWith(".local") || domain.endsWith(".invalid") || domain.endsWith(".test")) {
    throw new HttpError(400, "Use um e-mail valido e que voce consiga acessar.", { field: "email" });
  }
  if (disposableDomains.has(domain)) {
    throw new HttpError(400, "E-mails temporarios ou descartaveis nao podem ser usados no Ginga.", { field: "email" });
  }

  const cached = dnsCache.get(domain);
  if (cached && cached.expiresAt > Date.now()) {
    if (!cached.ok) throw new HttpError(400, "Esse dominio de e-mail nao recebe mensagens. Confira o endereco.", { field: "email" });
    return;
  }

  try {
    let ok = false;
    try {
      const records = await resolveMx(domain);
      // Um Null MX (exchange=".") declara explicitamente que o dominio nao recebe e-mail.
      ok = records.some((record) => Number.isFinite(record.priority) && Boolean(record.exchange?.trim()) && record.exchange !== ".");
    } catch (error) {
      const code = dnsErrorCode(error);
      if (!["ENODATA", "ENOTFOUND", "ENONAME"].includes(code)) throw error;
      ok = await hasMailAddressFallback(domain);
    }

    pruneCache(dnsCache);
    dnsCache.set(domain, { ok, expiresAt: Date.now() + (ok ? DNS_CACHE_TTL_MS : 2 * 60 * 1000) });
    if (!ok) throw new HttpError(400, "Esse dominio de e-mail nao existe ou nao recebe mensagens.", { field: "email" });
  } catch (error) {
    if (error instanceof HttpError) throw error;
    const code = dnsErrorCode(error);
    console.warn("Falha temporaria ao validar DNS do e-mail", { domain, code });
    throw new HttpError(503, "Nao foi possivel validar o e-mail agora. Tente novamente em instantes.", { field: "email" });
  }
}

export async function pwnedPasswordCount(password: string) {
  const sha1 = createHash("sha1").update(password, "utf8").digest("hex").toUpperCase();
  const cached = pwnedCache.get(sha1);
  if (cached && cached.expiresAt > Date.now()) return cached.count;

  const prefix = sha1.slice(0, 5);
  const suffix = sha1.slice(5);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await fetch(`https://api.pwnedpasswords.com/range/${prefix}`, {
      signal: controller.signal,
      headers: {
        "Add-Padding": "true",
        "User-Agent": "Ginga/0.1 password-security"
      }
    });
    if (!response.ok) throw new Error(`Pwned Passwords respondeu ${response.status}`);
    const body = await response.text();
    let count = 0;
    for (const line of body.split(/\r?\n/)) {
      const [candidate, rawCount] = line.trim().split(":");
      if (candidate === suffix) {
        count = Number.parseInt(rawCount || "0", 10) || 0;
        break;
      }
    }
    pruneCache(pwnedCache);
    pwnedCache.set(sha1, { count, expiresAt: Date.now() + PWNED_CACHE_TTL_MS });
    return count;
  } finally {
    clearTimeout(timeout);
  }
}

export async function assertPasswordNotPwned(password: string, field = "password") {
  if (String(process.env.PWNED_PASSWORD_CHECK ?? "true").trim().toLowerCase() === "false") return;
  try {
    const count = await pwnedPasswordCount(password);
    if (count > 0) {
      throw new HttpError(400, `Essa senha ja apareceu em vazamentos conhecidos (${count.toLocaleString("pt-BR")} ocorrencia${count === 1 ? "" : "s"}). Escolha outra senha.`, { field });
    }
  } catch (error) {
    if (error instanceof HttpError) throw error;
    // Falha aberta apenas quando o servico externo esta indisponivel. A senha continua
    // protegida por scrypt e pelas demais regras; nao derrubamos cadastro/reset por outage alheio.
    console.warn("Nao foi possivel consultar Pwned Passwords; seguindo sem o resultado desta verificacao", error);
  }
}
