import { createHmac, randomUUID } from "node:crypto";
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
}

type SessionRow = {
  id: string;
  user_id: string;
  created_at: Date;
  last_seen_at: Date;
  revoked_at: Date | null;
  ip_hash: string | null;
  user_agent: string | null;
};

const touchCache = new Map<string, number>();
const TOUCH_INTERVAL_MS = 5 * 60_000;

function hashIp(ip: string | undefined): string | null {
  if (!ip) return null;
  return createHmac("sha256", config.JWT_SECRET).update(ip).digest("hex").slice(0, 32);
}

function safeUserAgent(req: Request) {
  return String(req.header("user-agent") || "Dispositivo desconhecido").replace(/[\r\n\t]+/g, " ").trim().slice(0, 240);
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
      user_agent VARCHAR(240) NOT NULL DEFAULT ''
    )
  `);
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "ginga_auth_session_user_idx" ON "GingaAuthSession" (user_id, created_at DESC)`);
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "ginga_auth_session_active_idx" ON "GingaAuthSession" (user_id, revoked_at, last_seen_at DESC)`);
}

export async function createAuthSession(userId: string, req: Request) {
  const id = randomUUID();
  await prisma.$executeRawUnsafe(
    `INSERT INTO "GingaAuthSession" (id, user_id, ip_hash, user_agent) VALUES ($1,$2,$3,$4)`,
    id,
    userId,
    hashIp(req.ip),
    safeUserAgent(req)
  );
  return id;
}

export async function isAuthSessionActive(sessionId: string, userId: string, touch = true) {
  const rows = await prisma.$queryRawUnsafe<Array<{ active: boolean }>>(
    `SELECT EXISTS(SELECT 1 FROM "GingaAuthSession" WHERE id=$1 AND user_id=$2 AND revoked_at IS NULL) AS active`,
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
    `UPDATE "GingaAuthSession" SET revoked_at=COALESCE(revoked_at,NOW()) WHERE id=$1 AND user_id=$2 AND revoked_at IS NULL`,
    sessionId,
    userId
  );
  touchCache.delete(sessionId);
  return Number(changed) > 0;
}

export async function revokeAllAuthSessions(userId: string, exceptSessionId?: string | null) {
  if (exceptSessionId) {
    await prisma.$executeRawUnsafe(
      `UPDATE "GingaAuthSession" SET revoked_at=COALESCE(revoked_at,NOW()) WHERE user_id=$1 AND id<>$2 AND revoked_at IS NULL`,
      userId,
      exceptSessionId
    );
  } else {
    await prisma.$executeRawUnsafe(`UPDATE "GingaAuthSession" SET revoked_at=COALESCE(revoked_at,NOW()) WHERE user_id=$1 AND revoked_at IS NULL`, userId);
  }
}

export async function replaceCurrentAuthSession(userId: string, req: Request, previousSessionId?: string | null) {
  await revokeAllAuthSessions(userId);
  if (previousSessionId) touchCache.delete(previousSessionId);
  return createAuthSession(userId, req);
}

export async function listAuthSessions(userId: string, currentSessionId?: string | null): Promise<AuthSessionSummary[]> {
  const rows = await prisma.$queryRawUnsafe<SessionRow[]>(
    `SELECT id,user_id,created_at,last_seen_at,revoked_at,ip_hash,user_agent
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
    current: Boolean(currentSessionId && row.id === currentSessionId)
  }));
}
