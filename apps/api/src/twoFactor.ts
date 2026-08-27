import { createCipheriv, createDecipheriv, createHmac, randomBytes } from "node:crypto";
import { config } from "./config.js";
import { prisma } from "./db.js";
import { HttpError } from "./errors.js";

const TOTP_STEP_SECONDS = 30;
const TOTP_DIGITS = 6;
const LOGIN_CHALLENGE_TTL_SECONDS = 5 * 60;
const MAX_CHALLENGE_ATTEMPTS = 5;
const TRUSTED_DEVICE_TTL_SECONDS = 30 * 24 * 60 * 60;
const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const RECOVERY_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

let storagePromise: Promise<void> | null = null;

export async function ensureTwoFactorStorage() {
  if (!storagePromise) {
    storagePromise = (async () => {
      await prisma.$executeRawUnsafe(`
        CREATE TABLE IF NOT EXISTS "GingaTwoFactor" (
          user_id TEXT PRIMARY KEY,
          secret_cipher TEXT NOT NULL,
          secret_iv TEXT NOT NULL,
          secret_tag TEXT NOT NULL,
          recovery_hashes JSONB NOT NULL DEFAULT '[]'::jsonb,
          enabled_at TIMESTAMPTZ NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);
      await prisma.$executeRawUnsafe(`
        CREATE TABLE IF NOT EXISTS "GingaTwoFactorLoginChallenge" (
          token_hash VARCHAR(64) PRIMARY KEY,
          user_id TEXT NOT NULL,
          expires_at TIMESTAMPTZ NOT NULL,
          attempts INTEGER NOT NULL DEFAULT 0,
          used_at TIMESTAMPTZ NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);
      await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "ginga_2fa_challenge_user_idx" ON "GingaTwoFactorLoginChallenge" (user_id, created_at DESC)`);
      await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "ginga_2fa_challenge_expiry_idx" ON "GingaTwoFactorLoginChallenge" (expires_at, used_at)`);
      await prisma.$executeRawUnsafe(`
        CREATE TABLE IF NOT EXISTS "GingaTwoFactorTrustedDevice" (
          token_hash VARCHAR(64) PRIMARY KEY,
          user_id TEXT NOT NULL,
          user_agent_hash VARCHAR(64) NOT NULL,
          user_agent VARCHAR(240) NOT NULL DEFAULT 'Dispositivo desconhecido',
          expires_at TIMESTAMPTZ NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          last_used_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          revoked_at TIMESTAMPTZ NULL
        )
      `);
      await prisma.$executeRawUnsafe(`ALTER TABLE "GingaTwoFactorTrustedDevice" ADD COLUMN IF NOT EXISTS user_agent VARCHAR(240) NOT NULL DEFAULT 'Dispositivo desconhecido'`);
      await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "ginga_2fa_trusted_device_user_idx" ON "GingaTwoFactorTrustedDevice" (user_id, revoked_at, expires_at DESC)`);
      await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "ginga_2fa_trusted_device_expiry_idx" ON "GingaTwoFactorTrustedDevice" (expires_at, revoked_at)`);
    })().catch((error) => {
      storagePromise = null;
      throw error;
    });
  }
  await storagePromise;
}

function keyBuffer() {
  const raw = String(config.MFA_ENCRYPTION_KEY ?? "").trim();
  if (!/^[0-9a-fA-F]{64}$/.test(raw)) throw new HttpError(503, "2FA ainda nao foi configurado pelo administrador do Ginga.");
  return Buffer.from(raw, "hex");
}

export function twoFactorAvailable() {
  return /^[0-9a-fA-F]{64}$/.test(String(config.MFA_ENCRYPTION_KEY ?? "").trim());
}

function encryptSecret(secret: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", keyBuffer(), iv);
  const encrypted = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
  return {
    cipher: encrypted.toString("base64"),
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64")
  };
}

function decryptSecret(row: { secretCipher: string; secretIv: string; secretTag: string }) {
  const decipher = createDecipheriv("aes-256-gcm", keyBuffer(), Buffer.from(row.secretIv, "base64"));
  decipher.setAuthTag(Buffer.from(row.secretTag, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(row.secretCipher, "base64")), decipher.final()]).toString("utf8");
}

function base32Encode(input: Buffer) {
  let bits = 0;
  let value = 0;
  let output = "";
  for (const byte of input) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  return output;
}

function base32Decode(value: string) {
  let bits = 0;
  let current = 0;
  const bytes: number[] = [];
  for (const char of value.toUpperCase().replace(/=+$/g, "")) {
    const index = BASE32_ALPHABET.indexOf(char);
    if (index < 0) throw new Error("Base32 invalido");
    current = (current << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bytes.push((current >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

function totpAt(secret: string, counter: number) {
  const buffer = Buffer.alloc(8);
  buffer.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac("sha1", base32Decode(secret)).update(buffer).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const binary = ((digest[offset] & 0x7f) << 24)
    | ((digest[offset + 1] & 0xff) << 16)
    | ((digest[offset + 2] & 0xff) << 8)
    | (digest[offset + 3] & 0xff);
  return String(binary % (10 ** TOTP_DIGITS)).padStart(TOTP_DIGITS, "0");
}

function verifyTotp(secret: string, code: string) {
  if (!/^\d{6}$/.test(code)) return false;
  const current = Math.floor(Date.now() / 1000 / TOTP_STEP_SECONDS);
  for (let drift = -1; drift <= 1; drift += 1) {
    if (totpAt(secret, current + drift) === code) return true;
  }
  return false;
}

function normalizeRecoveryCode(code: string) {
  return code.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function recoveryHash(code: string) {
  return createHmac("sha256", keyBuffer()).update(normalizeRecoveryCode(code)).digest("hex");
}

function generateRecoveryCodes() {
  const codes: string[] = [];
  for (let i = 0; i < 10; i += 1) {
    const random = randomBytes(12);
    let raw = "";
    for (let j = 0; j < 12; j += 1) raw += RECOVERY_ALPHABET[random[j] % RECOVERY_ALPHABET.length];
    codes.push(`${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8, 12)}`);
  }
  return codes;
}

function hashChallenge(token: string) {
  return createHmac("sha256", keyBuffer()).update(token).digest("hex");
}

function hashTrustedDeviceToken(token: string) {
  return createHmac("sha256", keyBuffer()).update(`trusted-device:${token}`).digest("hex");
}

function normalizeTrustedDeviceUserAgent(userAgent: string) {
  return String(userAgent || "Dispositivo desconhecido").replace(/[\r\n\t]+/g, " ").replace(/\s{2,}/g, " ").trim().slice(0, 240) || "Dispositivo desconhecido";
}

function hashTrustedDeviceUserAgent(userAgent: string) {
  const normalized = normalizeTrustedDeviceUserAgent(userAgent);
  return createHmac("sha256", keyBuffer()).update(`trusted-device-ua:${normalized}`).digest("hex");
}

export function trustedTwoFactorDeviceIdFromToken(token: string) {
  return token && twoFactorAvailable() ? hashTrustedDeviceToken(token) : "";
}

type TwoFactorRow = {
  userId: string;
  secretCipher: string;
  secretIv: string;
  secretTag: string;
  recoveryHashes: unknown;
  enabledAt: Date | null;
};

async function readTwoFactor(userId: string): Promise<TwoFactorRow | null> {
  await ensureTwoFactorStorage();
  const rows = await prisma.$queryRawUnsafe<TwoFactorRow[]>(
    `SELECT user_id AS "userId", secret_cipher AS "secretCipher", secret_iv AS "secretIv", secret_tag AS "secretTag", recovery_hashes AS "recoveryHashes", enabled_at AS "enabledAt" FROM "GingaTwoFactor" WHERE user_id=$1 LIMIT 1`,
    userId
  );
  return rows[0] ?? null;
}

export async function twoFactorStatus(userId: string) {
  if (!twoFactorAvailable()) return { available: false, enabled: false };
  const row = await readTwoFactor(userId);
  return { available: true, enabled: Boolean(row?.enabledAt) };
}

export async function isTwoFactorEnabled(userId: string) {
  if (!twoFactorAvailable()) return false;
  const row = await readTwoFactor(userId);
  return Boolean(row?.enabledAt);
}

export async function createTwoFactorSetup(userId: string, username: string) {
  await ensureTwoFactorStorage();
  if (!twoFactorAvailable()) throw new HttpError(503, "2FA ainda nao foi configurado pelo administrador do Ginga.");
  await revokeTrustedTwoFactorDevices(userId);
  const secret = base32Encode(randomBytes(20));
  const encrypted = encryptSecret(secret);
  await prisma.$executeRawUnsafe(
    `INSERT INTO "GingaTwoFactor" (user_id,secret_cipher,secret_iv,secret_tag,recovery_hashes,enabled_at,updated_at)
     VALUES ($1,$2,$3,$4,'[]'::jsonb,NULL,NOW())
     ON CONFLICT (user_id) DO UPDATE SET secret_cipher=EXCLUDED.secret_cipher,secret_iv=EXCLUDED.secret_iv,secret_tag=EXCLUDED.secret_tag,recovery_hashes='[]'::jsonb,enabled_at=NULL,updated_at=NOW()`,
    userId,
    encrypted.cipher,
    encrypted.iv,
    encrypted.tag
  );
  const label = encodeURIComponent(`Ginga:${username}`);
  const issuer = encodeURIComponent("Ginga");
  const otpauthUri = `otpauth://totp/${label}?secret=${secret}&issuer=${issuer}&algorithm=SHA1&digits=6&period=30`;
  return { secret, otpauthUri };
}

export async function enableTwoFactor(userId: string, code: string) {
  const row = await readTwoFactor(userId);
  if (!row) throw new HttpError(409, "Inicie a configuracao do 2FA novamente.");
  if (!verifyTotp(decryptSecret(row), code.trim())) throw new HttpError(400, "Codigo do autenticador invalido.");
  const recoveryCodes = generateRecoveryCodes();
  const recoveryHashes = recoveryCodes.map(recoveryHash);
  await prisma.$executeRawUnsafe(
    `UPDATE "GingaTwoFactor" SET recovery_hashes=$2::jsonb,enabled_at=NOW(),updated_at=NOW() WHERE user_id=$1`,
    userId,
    JSON.stringify(recoveryHashes)
  );
  return recoveryCodes;
}

export async function regenerateRecoveryCodes(userId: string) {
  const row = await readTwoFactor(userId);
  if (!row?.enabledAt) throw new HttpError(409, "2FA nao esta ativo nesta conta.");
  const recoveryCodes = generateRecoveryCodes();
  await prisma.$executeRawUnsafe(
    `UPDATE "GingaTwoFactor" SET recovery_hashes=$2::jsonb,updated_at=NOW() WHERE user_id=$1`,
    userId,
    JSON.stringify(recoveryCodes.map(recoveryHash))
  );
  return recoveryCodes;
}

export async function disableTwoFactor(userId: string) {
  await ensureTwoFactorStorage();
  await revokeTrustedTwoFactorDevices(userId);
  await prisma.$executeRawUnsafe(`DELETE FROM "GingaTwoFactor" WHERE user_id=$1`, userId);
}

export async function createTrustedTwoFactorDevice(userId: string, userAgent: string) {
  await ensureTwoFactorStorage();
  if (!twoFactorAvailable()) throw new HttpError(503, "O segundo fator desta conta esta indisponivel. Contate o administrador.");
  await prisma.$executeRawUnsafe(`DELETE FROM "GingaTwoFactorTrustedDevice" WHERE expires_at < NOW() - INTERVAL '7 days' OR revoked_at < NOW() - INTERVAL '7 days'`);
  const token = randomBytes(32).toString("base64url");
  const tokenHash = hashTrustedDeviceToken(token);
  const normalizedUserAgent = normalizeTrustedDeviceUserAgent(userAgent);
  const userAgentHash = hashTrustedDeviceUserAgent(normalizedUserAgent);
  await prisma.$executeRawUnsafe(
    `INSERT INTO "GingaTwoFactorTrustedDevice" (token_hash,user_id,user_agent_hash,user_agent,expires_at) VALUES ($1,$2,$3,$4,NOW()+INTERVAL '30 days')`,
    tokenHash,
    userId,
    userAgentHash,
    normalizedUserAgent
  );
  return { token, expiresInSeconds: TRUSTED_DEVICE_TTL_SECONDS };
}

export async function verifyTrustedTwoFactorDevice(userId: string, token: string, userAgent: string) {
  await ensureTwoFactorStorage();
  if (!token || !twoFactorAvailable()) return false;
  const tokenHash = hashTrustedDeviceToken(token);
  const userAgentHash = hashTrustedDeviceUserAgent(userAgent);
  const rows = await prisma.$queryRawUnsafe<Array<{ userAgentHash: string }>>(
    `SELECT user_agent_hash AS "userAgentHash" FROM "GingaTwoFactorTrustedDevice" WHERE token_hash=$1 AND user_id=$2 AND revoked_at IS NULL AND expires_at > NOW() LIMIT 1`,
    tokenHash,
    userId
  );
  const row = rows[0];
  if (!row) return false;
  if (row.userAgentHash !== userAgentHash) {
    await prisma.$executeRawUnsafe(`UPDATE "GingaTwoFactorTrustedDevice" SET revoked_at=COALESCE(revoked_at,NOW()) WHERE token_hash=$1`, tokenHash);
    return false;
  }
  await prisma.$executeRawUnsafe(`UPDATE "GingaTwoFactorTrustedDevice" SET last_used_at=NOW() WHERE token_hash=$1 AND revoked_at IS NULL`, tokenHash);
  return true;
}

export interface TrustedTwoFactorDevice {
  id: string;
  userAgent: string;
  createdAt: Date;
  lastUsedAt: Date;
  expiresAt: Date;
  current: boolean;
}

export async function listTrustedTwoFactorDevices(userId: string, currentToken = ""): Promise<TrustedTwoFactorDevice[]> {
  await ensureTwoFactorStorage();
  const currentId = currentToken && twoFactorAvailable() ? hashTrustedDeviceToken(currentToken) : "";
  const rows = await prisma.$queryRawUnsafe<Array<{
    id: string; userAgent: string; createdAt: Date; lastUsedAt: Date; expiresAt: Date;
  }>>(
    `SELECT token_hash AS id,user_agent AS "userAgent",created_at AS "createdAt",last_used_at AS "lastUsedAt",expires_at AS "expiresAt"
     FROM "GingaTwoFactorTrustedDevice"
     WHERE user_id=$1 AND revoked_at IS NULL AND expires_at > NOW()
     ORDER BY last_used_at DESC, created_at DESC`,
    userId
  );
  return rows.map((row) => ({ ...row, current: Boolean(currentId && row.id === currentId) }));
}

export async function revokeTrustedTwoFactorDevice(userId: string, deviceId: string) {
  await ensureTwoFactorStorage();
  if (!/^[0-9a-f]{64}$/i.test(deviceId)) return false;
  const changed = await prisma.$executeRawUnsafe(
    `UPDATE "GingaTwoFactorTrustedDevice" SET revoked_at=COALESCE(revoked_at,NOW()) WHERE token_hash=$1 AND user_id=$2 AND revoked_at IS NULL`,
    deviceId,
    userId
  );
  return Number(changed) > 0;
}

export async function revokeTrustedTwoFactorDevices(userId: string) {
  await ensureTwoFactorStorage();
  await prisma.$executeRawUnsafe(`UPDATE "GingaTwoFactorTrustedDevice" SET revoked_at=COALESCE(revoked_at,NOW()) WHERE user_id=$1 AND revoked_at IS NULL`, userId);
}

export async function verifyTwoFactorCode(userId: string, code: string) {
  await ensureTwoFactorStorage();
  const normalized = code.trim();
  return prisma.$transaction(async (tx) => {
    // O lock impede que o mesmo codigo de recuperacao seja aceito em duas
    // requisicoes concorrentes (ex.: dois cliques/requests ao mesmo tempo).
    const rows = await tx.$queryRawUnsafe<TwoFactorRow[]>(
      `SELECT user_id AS "userId", secret_cipher AS "secretCipher", secret_iv AS "secretIv", secret_tag AS "secretTag", recovery_hashes AS "recoveryHashes", enabled_at AS "enabledAt" FROM "GingaTwoFactor" WHERE user_id=$1 FOR UPDATE`,
      userId
    );
    const row = rows[0];
    if (!row?.enabledAt) throw new HttpError(409, "2FA nao esta ativo nesta conta.");
    if (verifyTotp(decryptSecret(row), normalized)) return { ok: true, recovery: false };

    const hashes = Array.isArray(row.recoveryHashes) ? row.recoveryHashes.filter((item): item is string => typeof item === "string") : [];
    const wanted = recoveryHash(normalized);
    const index = hashes.indexOf(wanted);
    if (index < 0) return { ok: false, recovery: false };
    hashes.splice(index, 1);
    await tx.$executeRawUnsafe(`UPDATE "GingaTwoFactor" SET recovery_hashes=$2::jsonb,updated_at=NOW() WHERE user_id=$1`, userId, JSON.stringify(hashes));
    return { ok: true, recovery: true };
  });
}

export async function createTwoFactorLoginChallenge(userId: string) {
  await ensureTwoFactorStorage();
  if (!twoFactorAvailable()) throw new HttpError(503, "O segundo fator desta conta esta indisponivel. Contate o administrador.");
  await prisma.$executeRawUnsafe(`DELETE FROM "GingaTwoFactorLoginChallenge" WHERE expires_at < NOW() - INTERVAL '1 day' OR used_at < NOW() - INTERVAL '1 day'`);
  await prisma.$executeRawUnsafe(`UPDATE "GingaTwoFactorLoginChallenge" SET used_at=COALESCE(used_at,NOW()) WHERE user_id=$1 AND used_at IS NULL`, userId);
  const token = randomBytes(32).toString("base64url");
  const tokenHash = hashChallenge(token);
  await prisma.$executeRawUnsafe(
    `INSERT INTO "GingaTwoFactorLoginChallenge" (token_hash,user_id,expires_at) VALUES ($1,$2,NOW()+INTERVAL '5 minutes')`,
    tokenHash,
    userId
  );
  return { challengeId: token, expiresInSeconds: LOGIN_CHALLENGE_TTL_SECONDS };
}

export async function verifyTwoFactorLoginChallenge(challengeId: string, code: string) {
  await ensureTwoFactorStorage();
  const tokenHash = hashChallenge(challengeId);
  return prisma.$transaction(async (tx) => {
    const challengeRows = await tx.$queryRawUnsafe<Array<{ userId: string; expiresAt: Date; attempts: number; usedAt: Date | null }>>(
      `SELECT user_id AS "userId",expires_at AS "expiresAt",attempts,used_at AS "usedAt" FROM "GingaTwoFactorLoginChallenge" WHERE token_hash=$1 FOR UPDATE`,
      tokenHash
    );
    const challenge = challengeRows[0];
    if (!challenge || challenge.usedAt || challenge.expiresAt.getTime() <= Date.now()) throw new HttpError(400, "Desafio de 2FA expirado. Entre novamente.");
    if (challenge.attempts >= MAX_CHALLENGE_ATTEMPTS) {
      await tx.$executeRawUnsafe(`UPDATE "GingaTwoFactorLoginChallenge" SET used_at=NOW() WHERE token_hash=$1`, tokenHash);
      throw new HttpError(429, "Muitas tentativas de 2FA. Entre novamente.");
    }

    const rows = await tx.$queryRawUnsafe<TwoFactorRow[]>(
      `SELECT user_id AS "userId", secret_cipher AS "secretCipher", secret_iv AS "secretIv", secret_tag AS "secretTag", recovery_hashes AS "recoveryHashes", enabled_at AS "enabledAt" FROM "GingaTwoFactor" WHERE user_id=$1 FOR UPDATE`,
      challenge.userId
    );
    const row = rows[0];
    if (!row?.enabledAt) throw new HttpError(409, "2FA nao esta mais ativo nesta conta.");

    const normalized = code.trim();
    let valid = verifyTotp(decryptSecret(row), normalized);
    if (!valid) {
      const hashes = Array.isArray(row.recoveryHashes) ? row.recoveryHashes.filter((item): item is string => typeof item === "string") : [];
      const wanted = recoveryHash(normalized);
      const index = hashes.indexOf(wanted);
      if (index >= 0) {
        valid = true;
        hashes.splice(index, 1);
        await tx.$executeRawUnsafe(`UPDATE "GingaTwoFactor" SET recovery_hashes=$2::jsonb,updated_at=NOW() WHERE user_id=$1`, challenge.userId, JSON.stringify(hashes));
      }
    }

    if (!valid) {
      await tx.$executeRawUnsafe(`UPDATE "GingaTwoFactorLoginChallenge" SET attempts=attempts+1 WHERE token_hash=$1`, tokenHash);
      throw new HttpError(401, "Codigo de autenticacao invalido.");
    }

    await tx.$executeRawUnsafe(`UPDATE "GingaTwoFactorLoginChallenge" SET used_at=NOW() WHERE token_hash=$1`, tokenHash);
    return challenge.userId;
  });
}
