import { createHmac, randomBytes, randomUUID } from "node:crypto";
import type { Request } from "express";
import { config } from "./config.js";
import { prisma } from "./db.js";

export interface AuthSessionSummary {
  id: string;
  createdAt: string;
  lastSeenAt: string;
  revokedAt: string | null;
  ipHash: string | null;
  userAgent: string;
  current?: boolean;
  remembered?: boolean;
  expiresAt?: string | null;
}

type SessionRow = {
  id: string;
  user_id: string;
  created_at: Date;
  last_seen_at: Date;
  revoked_at: Date | null;
  ip_hash: string | null;
  user_agent: string | null;
  remembered: boolean;
  expires_at: Date | null;
};

const touchCache = new Map<string, number>();
const TOUCH_INTERVAL_MS = 5 * 60_000;
export const REMEMBERED_SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;

function hashIp(ip: string | undefined): string | null {
  if (!ip) return null;
  return createHmac("sha256", config.JWT_SECRET).update(ip).digest("hex").slice(0, 32);
}

function safeUserAgent(req: Request) {
  return String(req.header("user-agent") || "Dispositivo desconhecido").replace(/[\r\n\t]+/g, " ").trim().slice(0, 240);
}

function refreshTokenHash(token: string) {
  return createHmac("sha256", config.JWT_SECRET).update(`remember-session:${token}`).digest("hex");
}

export async function ensureAuthSessionStorage() {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "GingaAuthSession" (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      revoked_at TIMESTAMPTZ NULL,
      ip_hash VARCHAR(64) NULL,
      user_agent VARCHAR(240) NOT NULL DEFAULT '',
      remembered BOOLEAN NOT NULL DEFAULT FALSE,
      refresh_token_hash VARCHAR(64) NULL,
      expires_at TIMESTAMPTZ NULL
    )
  `);
  await prisma.$executeRawUnsafe(`ALTER TABLE "GingaAuthSession" ADD COLUMN IF NOT EXISTS remembered BOOLEAN NOT NULL DEFAULT FALSE`);
  await prisma.$executeRawUnsafe(`ALTER TABLE "GingaAuthSession" ADD COLUMN IF NOT EXISTS refresh_token_hash VARCHAR(64) NULL`);
  await prisma.$executeRawUnsafe(`ALTER TABLE "GingaAuthSession" ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ NULL`);
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "ginga_auth_session_user_idx" ON "GingaAuthSession" (user_id, created_at DESC)`);
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "ginga_auth_session_active_idx" ON "GingaAuthSession" (user_id, revoked_at, last_seen_at DESC)`);
  await prisma.$executeRawUnsafe(`CREATE UNIQUE INDEX IF NOT EXISTS "ginga_auth_session_refresh_idx" ON "GingaAuthSession" (refresh_token_hash) WHERE refresh_token_hash IS NOT NULL`);
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "ginga_auth_session_expiry_idx" ON "GingaAuthSession" (expires_at, revoked_at) WHERE remembered=TRUE`);
}

export async function createAuthSession(userId: string, req: Request) {
  const id = randomUUID();
  await prisma.$executeRawUnsafe(
    `INSERT INTO "GingaAuthSession" (id, user_id, ip_hash, user_agent, remembered) VALUES ($1,$2,$3,$4,FALSE)`,
    id,
    userId,
    hashIp(req.ip),
    safeUserAgent(req)
  );
  return id;
}

export async function createRememberedAuthSession(userId: string, req: Request) {
  const id = randomUUID();
  const refreshToken = randomBytes(32).toString("base64url");
  const tokenHash = refreshTokenHash(refreshToken);
  await prisma.$executeRawUnsafe(
    `INSERT INTO "GingaAuthSession" (id,user_id,ip_hash,user_agent,remembered,refresh_token_hash,expires_at)
     VALUES ($1,$2,$3,$4,TRUE,$5,NOW()+INTERVAL '30 days')`,
    id,
    userId,
    hashIp(req.ip),
    safeUserAgent(req),
    tokenHash
  );
  return { sessionId: id, refreshToken, expiresInSeconds: REMEMBERED_SESSION_TTL_SECONDS };
}

export async function restoreRememberedAuthSession(refreshToken: string, req: Request) {
  if (!refreshToken) return null;
  await ensureAuthSessionStorage();
  const tokenHash = refreshTokenHash(refreshToken);
  const rows = await prisma.$queryRawUnsafe<Array<{ id: string; userId: string; expiresAt: Date }>>(
    `SELECT id,user_id AS "userId",expires_at AS "expiresAt"
       FROM "GingaAuthSession"
      WHERE refresh_token_hash=$1 AND remembered=TRUE AND revoked_at IS NULL AND expires_at > NOW()
      LIMIT 1`,
    tokenHash
  );
  const row = rows[0];
  if (!row) return null;

  // Rotaciona o segredo a cada restauracao. Um cookie antigo nao pode ser reutilizado.
  const nextRefreshToken = randomBytes(32).toString("base64url");
  const nextHash = refreshTokenHash(nextRefreshToken);
  const changed = await prisma.$executeRawUnsafe(
    `UPDATE "GingaAuthSession"
        SET refresh_token_hash=$2,last_seen_at=NOW(),ip_hash=$3,user_agent=$4
      WHERE id=$1 AND refresh_token_hash=$5 AND revoked_at IS NULL AND expires_at > NOW()`,
    row.id,
    nextHash,
    hashIp(req.ip),
    safeUserAgent(req),
    tokenHash
  );
  if (Number(changed) < 1) return null;
  touchCache.set(row.id, Date.now());
  return {
    sessionId: row.id,
    userId: row.userId,
    refreshToken: nextRefreshToken,
    expiresInSeconds: Math.max(1, Math.floor((row.expiresAt.getTime() - Date.now()) / 1000))
  };
}

export async function revokeRememberedAuthSession(refreshToken: string) {
  if (!refreshToken) return false;
  await ensureAuthSessionStorage();
  const changed = await prisma.$executeRawUnsafe(
    `UPDATE "GingaAuthSession" SET revoked_at=COALESCE(revoked_at,NOW()),refresh_token_hash=NULL WHERE refresh_token_hash=$1 AND revoked_at IS NULL`,
    refreshTokenHash(refreshToken)
  );
  return Number(changed) > 0;
}

export async function isAuthSessionActive(sessionId: string, userId: string, touch = true) {
  const rows = await prisma.$queryRawUnsafe<Array<{ active: boolean }>>(
    `SELECT EXISTS(
       SELECT 1 FROM "GingaAuthSession"
        WHERE id=$1 AND user_id=$2 AND revoked_at IS NULL
          AND (remembered=FALSE OR expires_at IS NULL OR expires_at > NOW())
     ) AS active`,
    sessionId,
    userId
  );
  const active = Boolean(rows[0]?.active);
  if (active && touch) {
    const now = Date.now();
    const last = touchCache.get(sessionId) ?? 0;
    if (now - last >= TOUCH_INTERVAL_MS) {
      touchCache.set(sessionId, now);
      void prisma.$executeRawUnsafe(`UPDATE "GingaAuthSession" SET last_seen_at=NOW() WHERE id=$1 AND revoked_at IS NULL`, sessionId).catch(() => undefined);
    }
  }
  return active;
}

export async function revokeAuthSession(userId: string, sessionId: string) {
  const changed = await prisma.$executeRawUnsafe(
    `UPDATE "GingaAuthSession" SET revoked_at=COALESCE(revoked_at,NOW()),refresh_token_hash=NULL WHERE id=$1 AND user_id=$2 AND revoked_at IS NULL`,
    sessionId,
    userId
  );
  touchCache.delete(sessionId);
  return Number(changed) > 0;
}

export async function revokeAllAuthSessions(userId: string, exceptSessionId?: string | null) {
  if (exceptSessionId) {
    await prisma.$executeRawUnsafe(
      `UPDATE "GingaAuthSession" SET revoked_at=COALESCE(revoked_at,NOW()),refresh_token_hash=NULL WHERE user_id=$1 AND id<>$2 AND revoked_at IS NULL`,
      userId,
      exceptSessionId
    );
  } else {
    await prisma.$executeRawUnsafe(`UPDATE "GingaAuthSession" SET revoked_at=COALESCE(revoked_at,NOW()),refresh_token_hash=NULL WHERE user_id=$1 AND revoked_at IS NULL`, userId);
  }
}

export async function replaceCurrentAuthSession(userId: string, req: Request, previousSessionId?: string | null) {
  await revokeAllAuthSessions(userId);
  if (previousSessionId) touchCache.delete(previousSessionId);
  return createAuthSession(userId, req);
}

export async function listAuthSessions(userId: string, currentSessionId?: string | null): Promise<AuthSessionSummary[]> {
  const rows = await prisma.$queryRawUnsafe<SessionRow[]>(
    `SELECT id,user_id,created_at,last_seen_at,revoked_at,ip_hash,user_agent,remembered,expires_at
       FROM "GingaAuthSession"
      WHERE user_id=$1
      ORDER BY last_seen_at DESC
      LIMIT 50`,
    userId
  );
  return rows.map((row) => ({
    id: row.id,
    createdAt: row.created_at.toISOString(),
    lastSeenAt: row.last_seen_at.toISOString(),
    revokedAt: row.revoked_at?.toISOString() ?? null,
    ipHash: row.ip_hash,
    userAgent: row.user_agent || "Dispositivo desconhecido",
    remembered: Boolean(row.remembered),
    expiresAt: row.expires_at?.toISOString() ?? null,
    current: Boolean(currentSessionId && row.id === currentSessionId)
  }));
}
