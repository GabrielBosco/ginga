import { randomUUID } from "node:crypto";
import { Router } from "express";
import type { Server as SocketServer } from "socket.io";
import { z } from "zod";
import { prisma } from "../db.js";
import { asyncHandler, HttpError } from "../errors.js";
import { requireAuth } from "../middleware.js";
import { routeParam } from "../utils.js";
import { directConversationBetween, usersBlockEachOther } from "../socialPrivacy.js";

export const directCallsRouter = Router();

const RING_TIMEOUT_SECONDS = 45;
const HISTORY_RETENTION_DAYS = 120;

type CallState = "RINGING" | "ACTIVE" | "DECLINED" | "MISSED" | "ENDED" | "CANCELLED";
type ParticipantState = "INVITED" | "JOINED" | "LEFT" | "DECLINED" | "MISSED";

type DirectCallRow = {
  id: string;
  pair_key: string;
  conversation_id: string | null;
  room_key: string | null;
  caller_id: string;
  callee_id: string;
  state: CallState;
  started_at: Date | string;
  answered_at: Date | string | null;
  ended_at: Date | string | null;
  duration_ms: number | null;
  created_at: Date | string;
  updated_at: Date | string;
};

type DirectCallParticipantRow = {
  call_id: string;
  user_id: string;
  status: ParticipantState;
  invited_by: string | null;
  joined_at: Date | string | null;
  left_at: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string;
};

type PeerSummary = {
  id: string;
  username: string;
  displayName: string;
  avatarColor: string;
};

const startSchema = z.object({ peerUserId: z.string().trim().min(1).max(120) });
const inviteSchema = z.object({ userId: z.string().trim().min(1).max(120) });
const historyQuerySchema = z.object({ limit: z.coerce.number().int().min(1).max(100).default(40) });

function pairKey(a: string, b: string) {
  return [a, b].sort().join(":");
}

function asIso(value: Date | string | null) {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

async function peerSummary(userId: string): Promise<PeerSummary | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, username: true, displayName: true, avatarColor: true }
  });
  return user ?? null;
}

function ioFrom(req: { app: { get(name: string): unknown } }): SocketServer | null {
  const io = req.app.get("io");
  return io && typeof io === "object" ? io as SocketServer : null;
}

async function participantRows(callId: string): Promise<DirectCallParticipantRow[]> {
  return prisma.$queryRawUnsafe<DirectCallParticipantRow[]>(
    `SELECT * FROM "GingaDirectCallParticipant" WHERE call_id = $1 ORDER BY created_at ASC`,
    callId
  );
}

async function serializeCall(row: DirectCallRow, viewerId: string, explicitPeer?: PeerSummary | null) {
  const outgoing = row.caller_id === viewerId;
  const rows = await participantRows(row.id);
  const userIds = rows.map((item) => item.user_id);
  const users = userIds.length ? await prisma.user.findMany({
    where: { id: { in: userIds } },
    select: { id: true, username: true, displayName: true, avatarColor: true }
  }) : [];
  const userMap = new Map(users.map((item) => [item.id, item]));
  const membership = rows.find((item) => item.user_id === viewerId) ?? null;
  const peerId = outgoing ? row.callee_id : row.caller_id;
  const peer = explicitPeer === undefined ? await peerSummary(peerId) : explicitPeer;
  return {
    id: row.id,
    state: row.state,
    callerId: row.caller_id,
    calleeId: row.callee_id,
    conversationId: row.conversation_id,
    roomKey: row.room_key || row.id,
    peerUserId: peerId,
    direction: outgoing ? "OUTGOING" as const : "INCOMING" as const,
    membershipStatus: membership?.status ?? null,
    canJoin: row.state === "ACTIVE" && Boolean(membership && ["INVITED", "JOINED", "LEFT"].includes(membership.status)),
    startedAt: asIso(row.started_at),
    answeredAt: asIso(row.answered_at),
    endedAt: asIso(row.ended_at),
    durationMs: row.duration_ms ?? null,
    peer: peer ?? null,
    participants: rows.map((item) => ({
      userId: item.user_id,
      status: item.status,
      invitedBy: item.invited_by,
      joinedAt: asIso(item.joined_at),
      leftAt: asIso(item.left_at),
      user: userMap.get(item.user_id) ?? null
    }))
  };
}

async function emitCall(io: SocketServer | null, row: DirectCallRow) {
  if (!io) return;
  const participants = await participantRows(row.id);
  const base = {
    id: row.id,
    state: row.state,
    callerId: row.caller_id,
    calleeId: row.callee_id,
    conversationId: row.conversation_id,
    startedAt: asIso(row.started_at),
    answeredAt: asIso(row.answered_at),
    endedAt: asIso(row.ended_at),
    durationMs: row.duration_ms ?? null
  };
  const ids = new Set([row.caller_id, row.callee_id, ...participants.map((item) => item.user_id)]);
  for (const userId of ids) {
    for (const room of [`user:${userId}`, `user-${userId}`, userId]) io.to(room).emit("direct-call:event", base);
  }
}

async function queryOne(id: string): Promise<DirectCallRow | null> {
  const rows = await prisma.$queryRawUnsafe<DirectCallRow[]>(`SELECT * FROM "GingaDirectCall" WHERE id = $1 LIMIT 1`, id);
  return rows[0] ?? null;
}

async function updateAndReturn(query: string, ...values: unknown[]): Promise<DirectCallRow | null> {
  const rows = await prisma.$queryRawUnsafe<DirectCallRow[]>(query, ...values);
  return rows[0] ?? null;
}

async function viewerParticipant(callId: string, userId: string) {
  const rows = await prisma.$queryRawUnsafe<DirectCallParticipantRow[]>(
    `SELECT * FROM "GingaDirectCallParticipant" WHERE call_id = $1 AND user_id = $2 LIMIT 1`, callId, userId
  );
  return rows[0] ?? null;
}

async function expireRinging(io: SocketServer | null) {
  const rows = await prisma.$queryRawUnsafe<DirectCallRow[]>(`
    UPDATE "GingaDirectCall"
       SET state = 'MISSED', ended_at = NOW(), duration_ms = NULL, updated_at = NOW()
     WHERE state = 'RINGING' AND started_at < NOW() - INTERVAL '${RING_TIMEOUT_SECONDS} seconds'
     RETURNING *
  `);
  for (const row of rows) {
    await prisma.$executeRawUnsafe(
      `UPDATE "GingaDirectCallParticipant" SET status = CASE WHEN user_id = $2 THEN 'MISSED' ELSE status END, left_at = CASE WHEN user_id = $2 THEN NOW() ELSE left_at END, updated_at = NOW() WHERE call_id = $1`,
      row.id,
      row.callee_id
    );
    await emitCall(io, row);
  }
  return rows;
}

export async function ensureDirectCallStorage() {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "GingaDirectCall" (
      id TEXT PRIMARY KEY,
      pair_key TEXT NOT NULL,
      conversation_id TEXT NULL,
      room_key TEXT NULL,
      caller_id TEXT NOT NULL,
      callee_id TEXT NOT NULL,
      state TEXT NOT NULL,
      started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      answered_at TIMESTAMPTZ NULL,
      ended_at TIMESTAMPTZ NULL,
      duration_ms INTEGER NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await prisma.$executeRawUnsafe(`ALTER TABLE "GingaDirectCall" ADD COLUMN IF NOT EXISTS conversation_id TEXT NULL`);
  await prisma.$executeRawUnsafe(`ALTER TABLE "GingaDirectCall" ADD COLUMN IF NOT EXISTS room_key TEXT NULL`);
  await prisma.$executeRawUnsafe(`UPDATE "GingaDirectCall" SET room_key = id WHERE room_key IS NULL`);
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "GingaDirectCallParticipant" (
      call_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      status TEXT NOT NULL,
      invited_by TEXT NULL,
      joined_at TIMESTAMPTZ NULL,
      left_at TIMESTAMPTZ NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (call_id, user_id)
    )
  `);
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "ginga_direct_call_pair_idx" ON "GingaDirectCall" (pair_key, started_at DESC)`);
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "ginga_direct_call_users_idx" ON "GingaDirectCall" (caller_id, callee_id, started_at DESC)`);
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "ginga_direct_call_participant_user_idx" ON "GingaDirectCallParticipant" (user_id, status, updated_at DESC)`);
  await prisma.$executeRawUnsafe(`CREATE UNIQUE INDEX IF NOT EXISTS "ginga_direct_call_one_active_pair" ON "GingaDirectCall" (pair_key) WHERE state IN ('RINGING', 'ACTIVE')`);
  // Compatibilidade com chamadas criadas antes do suporte a grupos.
  await prisma.$executeRawUnsafe(`
    INSERT INTO "GingaDirectCallParticipant" (call_id, user_id, status, invited_by, joined_at, left_at)
    SELECT id, caller_id,
           CASE WHEN state IN ('RINGING','ACTIVE') THEN 'JOINED' ELSE 'LEFT' END,
           caller_id, started_at,
           CASE WHEN state IN ('RINGING','ACTIVE') THEN NULL ELSE COALESCE(ended_at, updated_at) END
      FROM "GingaDirectCall"
    ON CONFLICT (call_id, user_id) DO NOTHING
  `);
  await prisma.$executeRawUnsafe(`
    INSERT INTO "GingaDirectCallParticipant" (call_id, user_id, status, invited_by, joined_at, left_at)
    SELECT id, callee_id,
           CASE WHEN state = 'ACTIVE' THEN 'JOINED' WHEN state = 'RINGING' THEN 'INVITED' WHEN state = 'DECLINED' THEN 'DECLINED' WHEN state = 'MISSED' THEN 'MISSED' ELSE 'LEFT' END,
           caller_id,
           CASE WHEN state = 'ACTIVE' THEN COALESCE(answered_at, started_at) ELSE NULL END,
           CASE WHEN state IN ('RINGING','ACTIVE') THEN NULL ELSE COALESCE(ended_at, updated_at) END
      FROM "GingaDirectCall"
    ON CONFLICT (call_id, user_id) DO NOTHING
  `);
}

export function scheduleDirectCallMaintenance(io: SocketServer) {
  const timer = setInterval(() => {
    void expireRinging(io).catch((error) => console.warn("Ginga Calls: falha ao expirar chamada", error));
    void prisma.$executeRawUnsafe(`DELETE FROM "GingaDirectCallParticipant" WHERE call_id IN (SELECT id FROM "GingaDirectCall" WHERE ended_at IS NOT NULL AND ended_at < NOW() - INTERVAL '${HISTORY_RETENTION_DAYS} days')`)
      .then(() => prisma.$executeRawUnsafe(`DELETE FROM "GingaDirectCall" WHERE ended_at IS NOT NULL AND ended_at < NOW() - INTERVAL '${HISTORY_RETENTION_DAYS} days'`))
      .catch((error) => console.warn("Ginga Calls: falha na limpeza do historico", error));
  }, 15_000);
  timer.unref?.();
}

export async function canJoinDirectCall(callId: string, userId: string) {
  await ensureDirectCallStorage();
  const [call, participant] = await Promise.all([queryOne(callId), viewerParticipant(callId, userId)]);
  if (!call || !participant) return null;
  if (call.state !== "ACTIVE") return null;
  if (!["JOINED", "LEFT"].includes(participant.status)) return null;
  return call;
}

directCallsRouter.get("/direct-calls/active", requireAuth, asyncHandler(async (req, res) => {
  const userId = req.auth!.sub;
  await ensureDirectCallStorage();
  await expireRinging(ioFrom(req));
  const rows = await prisma.$queryRawUnsafe<DirectCallRow[]>(
    `SELECT c.* FROM "GingaDirectCall" c
       JOIN "GingaDirectCallParticipant" p ON p.call_id = c.id
      WHERE c.state IN ('RINGING', 'ACTIVE') AND p.user_id = $1
      ORDER BY c.started_at DESC`,
    userId
  );
  res.json({ calls: await Promise.all(rows.map((row) => serializeCall(row, userId))) });
}));

directCallsRouter.get("/direct-calls/history", requireAuth, asyncHandler(async (req,res)=>{const userId=req.auth!.sub;const {limit}=historyQuerySchema.parse(req.query);await ensureDirectCallStorage();await expireRinging(ioFrom(req));const rows=await prisma.$queryRawUnsafe<DirectCallRow[]>(`SELECT c.* FROM "GingaDirectCall" c JOIN "GingaDirectCallParticipant" p ON p.call_id=c.id WHERE p.user_id=$1 AND c.state NOT IN ('RINGING','ACTIVE') ORDER BY c.started_at DESC LIMIT $2`,userId,limit);res.json({calls:await Promise.all(rows.map(row=>serializeCall(row,userId)))});}));

directCallsRouter.get("/direct-calls/with/:peerUserId", requireAuth, asyncHandler(async (req, res) => {
  const userId = req.auth!.sub;
  const peerUserId = routeParam(req.params.peerUserId, "peerUserId");
  const { limit } = historyQuerySchema.parse(req.query);
  const conversation = await directConversationBetween(userId, peerUserId);
  if (!conversation || await usersBlockEachOther(userId, peerUserId)) throw new HttpError(403, "Historico de chamadas indisponivel");
  await ensureDirectCallStorage();
  await expireRinging(ioFrom(req));
  const rows = await prisma.$queryRawUnsafe<DirectCallRow[]>(
    `SELECT * FROM "GingaDirectCall" WHERE pair_key = $1 ORDER BY started_at DESC LIMIT $2`,
    pairKey(userId, peerUserId), limit
  );
  const peer = await peerSummary(peerUserId);
  res.json({ calls: await Promise.all(rows.map((row) => serializeCall(row, userId, peer))), peer });
}));

directCallsRouter.post("/direct-calls/start", requireAuth, asyncHandler(async (req, res) => {
  const callerId = req.auth!.sub;
  const { peerUserId: calleeId } = startSchema.parse(req.body);
  if (calleeId === callerId) throw new HttpError(400, "Voce nao pode ligar para si mesmo");
  const conversation = await directConversationBetween(callerId, calleeId);
  if (!conversation) throw new HttpError(403, "Inicie uma conversa privada antes de ligar para este usuario");
  await ensureDirectCallStorage();
  await expireRinging(ioFrom(req));

  const peer = await prisma.user.findUnique({ where: { id: calleeId }, select: { id: true, accountType: true, username: true, displayName: true, avatarColor: true } });
  if (!peer || peer.accountType !== "HUMAN") throw new HttpError(404, "Usuario nao encontrado");
  if (await usersBlockEachOther(callerId, calleeId)) throw new HttpError(403, "Nao e possivel iniciar chamada com este usuario");

  const pair = pairKey(callerId, calleeId);
  const existingPair = await prisma.$queryRawUnsafe<DirectCallRow[]>(
    `SELECT * FROM "GingaDirectCall" WHERE pair_key = $1 AND state IN ('RINGING', 'ACTIVE') ORDER BY started_at DESC LIMIT 1`, pair
  );
  if (existingPair[0]) return res.status(200).json({ call: await serializeCall(existingPair[0], callerId, peer), reused: true });

  const busy = await prisma.$queryRawUnsafe<{ id: string }[]>(
    `SELECT c.id FROM "GingaDirectCall" c JOIN "GingaDirectCallParticipant" p ON p.call_id = c.id
      WHERE c.state IN ('RINGING','ACTIVE') AND p.user_id IN ($1,$2) AND p.status IN ('INVITED','JOINED') LIMIT 1`, callerId, calleeId
  );
  if (busy[0]) throw new HttpError(409, "Um dos usuarios ja esta em outra chamada");

  const id = randomUUID();
  let row: DirectCallRow | null = null;
  try {
    await prisma.$transaction(async (tx) => {
      const created = await tx.$queryRawUnsafe<DirectCallRow[]>(
        `INSERT INTO "GingaDirectCall" (id, pair_key, conversation_id, room_key, caller_id, callee_id, state)
         VALUES ($1,$2,$3,$4,$5,$6,'RINGING') RETURNING *`, id, pair, conversation.id, id, callerId, calleeId
      );
      row = created[0] ?? null;
      await tx.$executeRawUnsafe(
        `INSERT INTO "GingaDirectCallParticipant" (call_id,user_id,status,invited_by,joined_at) VALUES ($1,$2,'JOINED',$2,NOW()),($1,$3,'INVITED',$2,NULL)`,
        id, callerId, calleeId
      );
    });
  } catch (error) {
    const raced = await prisma.$queryRawUnsafe<DirectCallRow[]>(`SELECT * FROM "GingaDirectCall" WHERE pair_key=$1 AND state IN ('RINGING','ACTIVE') ORDER BY started_at DESC LIMIT 1`, pair);
    if (raced[0]) return res.status(200).json({ call: await serializeCall(raced[0], callerId, peer), reused: true });
    throw error;
  }
  if (!row) throw new HttpError(500, "Nao foi possivel iniciar a chamada");
  await emitCall(ioFrom(req), row);
  res.status(201).json({ call: await serializeCall(row, callerId, peer), reused: false });
}));

directCallsRouter.post("/direct-calls/:callId/answer", requireAuth, asyncHandler(async (req, res) => {
  const userId = req.auth!.sub;
  const callId = routeParam(req.params.callId, "callId");
  await ensureDirectCallStorage();
  await expireRinging(ioFrom(req));
  const current = await queryOne(callId);
  if (!current || current.callee_id !== userId) throw new HttpError(404, "Chamada nao encontrada");
  if (await usersBlockEachOther(current.caller_id, current.callee_id)) throw new HttpError(403, "Essa chamada foi bloqueada");
  if (current.state === "ACTIVE") return res.json({ call: await serializeCall(current, userId) });
  if (current.state !== "RINGING") throw new HttpError(409, "Essa chamada nao esta mais tocando");
  const row = await updateAndReturn(`UPDATE "GingaDirectCall" SET state='ACTIVE', answered_at=NOW(), updated_at=NOW() WHERE id=$1 AND state='RINGING' RETURNING *`, callId);
  if (!row) throw new HttpError(409, "Essa chamada nao esta mais disponivel");
  await prisma.$executeRawUnsafe(`UPDATE "GingaDirectCallParticipant" SET status='JOINED', joined_at=NOW(), left_at=NULL, updated_at=NOW() WHERE call_id=$1 AND user_id=$2`, callId, userId);
  await emitCall(ioFrom(req), row);
  res.json({ call: await serializeCall(row, userId) });
}));

directCallsRouter.post("/direct-calls/:callId/decline", requireAuth, asyncHandler(async (req, res) => {
  const userId = req.auth!.sub;
  const callId = routeParam(req.params.callId, "callId");
  await ensureDirectCallStorage();
  const current = await queryOne(callId);
  const participant = await viewerParticipant(callId, userId);
  if (!current || !participant || participant.status !== "INVITED") throw new HttpError(404, "Chamada nao encontrada");

  if (current.state === "RINGING" && current.callee_id === userId) {
    const row = await updateAndReturn(`UPDATE "GingaDirectCall" SET state='DECLINED', ended_at=NOW(), updated_at=NOW() WHERE id=$1 AND state='RINGING' RETURNING *`, callId);
    if (!row) throw new HttpError(409, "Essa chamada nao esta mais disponivel");
    await prisma.$executeRawUnsafe(`UPDATE "GingaDirectCallParticipant" SET status='DECLINED', left_at=NOW(), updated_at=NOW() WHERE call_id=$1 AND user_id=$2`, callId, userId);
    await emitCall(ioFrom(req), row);
    return res.json({ call: await serializeCall(row, userId) });
  }

  await prisma.$executeRawUnsafe(`UPDATE "GingaDirectCallParticipant" SET status='DECLINED', left_at=NOW(), updated_at=NOW() WHERE call_id=$1 AND user_id=$2`, callId, userId);
  await emitCall(ioFrom(req), current);
  res.json({ call: await serializeCall(current, userId) });
}));

directCallsRouter.post("/direct-calls/:callId/join", requireAuth, asyncHandler(async (req, res) => {
  const userId = req.auth!.sub;
  const callId = routeParam(req.params.callId, "callId");
  await ensureDirectCallStorage();
  await expireRinging(ioFrom(req));
  let row = await queryOne(callId);
  const participant = await viewerParticipant(callId, userId);
  if (!row || !participant) throw new HttpError(404, "Chamada nao encontrada");
  if (!["RINGING", "ACTIVE"].includes(row.state)) throw new HttpError(409, "Essa chamada ja terminou");

  if (row.state === "RINGING") {
    if (row.callee_id !== userId) throw new HttpError(409, "Aguarde a outra pessoa atender");
    row = await updateAndReturn(`UPDATE "GingaDirectCall" SET state='ACTIVE', answered_at=COALESCE(answered_at,NOW()), updated_at=NOW() WHERE id=$1 AND state='RINGING' RETURNING *`, callId);
    if (!row) throw new HttpError(409, "Essa chamada nao esta mais disponivel");
  }
  await prisma.$executeRawUnsafe(`UPDATE "GingaDirectCallParticipant" SET status='JOINED', joined_at=COALESCE(joined_at,NOW()), left_at=NULL, updated_at=NOW() WHERE call_id=$1 AND user_id=$2`, callId, userId);
  await emitCall(ioFrom(req), row);
  res.json({ call: await serializeCall(row, userId) });
}));

directCallsRouter.post("/direct-calls/:callId/leave", requireAuth, asyncHandler(async (req, res) => {
  const userId = req.auth!.sub;
  const callId = routeParam(req.params.callId, "callId");
  await ensureDirectCallStorage();
  let row = await queryOne(callId);
  const participant = await viewerParticipant(callId, userId);
  if (!row || !participant) throw new HttpError(404, "Chamada nao encontrada");

  if (row.state === "RINGING") {
    if (row.caller_id === userId) {
      row = await updateAndReturn(`UPDATE "GingaDirectCall" SET state='CANCELLED', ended_at=NOW(), updated_at=NOW() WHERE id=$1 AND state='RINGING' RETURNING *`, callId) ?? row;
    } else {
      row = await updateAndReturn(`UPDATE "GingaDirectCall" SET state='DECLINED', ended_at=NOW(), updated_at=NOW() WHERE id=$1 AND state='RINGING' RETURNING *`, callId) ?? row;
    }
    await prisma.$executeRawUnsafe(`UPDATE "GingaDirectCallParticipant" SET status='LEFT', left_at=NOW(), updated_at=NOW() WHERE call_id=$1 AND user_id=$2`, callId, userId);
    await emitCall(ioFrom(req), row);
    return res.json({ call: await serializeCall(row, userId) });
  }

  if (row.state !== "ACTIVE") return res.json({ call: await serializeCall(row, userId) });
  await prisma.$executeRawUnsafe(`UPDATE "GingaDirectCallParticipant" SET status='LEFT', left_at=NOW(), updated_at=NOW() WHERE call_id=$1 AND user_id=$2`, callId, userId);
  const joined = await prisma.$queryRawUnsafe<{ count: bigint }[]>(`SELECT COUNT(*)::bigint AS count FROM "GingaDirectCallParticipant" WHERE call_id=$1 AND status='JOINED'`, callId);
  if (Number(joined[0]?.count ?? 0) === 0) {
    row = await updateAndReturn(`UPDATE "GingaDirectCall" SET state='ENDED', ended_at=NOW(), duration_ms=GREATEST(0,FLOOR(EXTRACT(EPOCH FROM (NOW()-COALESCE(answered_at,started_at)))*1000))::INTEGER, updated_at=NOW() WHERE id=$1 AND state='ACTIVE' RETURNING *`, callId) ?? row;
  }
  await emitCall(ioFrom(req), row);
  res.json({ call: await serializeCall(row, userId) });
}));

directCallsRouter.post("/direct-calls/:callId/invite", requireAuth, asyncHandler(async (req, res) => {
  const inviterId = req.auth!.sub;
  const callId = routeParam(req.params.callId, "callId");
  const { userId } = inviteSchema.parse(req.body);
  if (userId === inviterId) throw new HttpError(400, "Esse usuario ja esta na chamada");
  await ensureDirectCallStorage();
  const row = await queryOne(callId);
  const inviter = await viewerParticipant(callId, inviterId);
  if (!row || row.state !== "ACTIVE" || !inviter || inviter.status !== "JOINED") throw new HttpError(404, "Chamada ativa nao encontrada");
  if (await usersBlockEachOther(inviterId, userId)) throw new HttpError(403, "Nao e possivel convidar este usuario");

  const friendship = await prisma.friendship.findFirst({
    where: { status: "ACCEPTED", OR: [{ requesterId: inviterId, addresseeId: userId }, { requesterId: userId, addresseeId: inviterId }] },
    select: { id: true }
  });
  if (!friendship) throw new HttpError(403, "So e possivel convidar amigos para a chamada");
  const target = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, accountType: true } });
  if (!target || target.accountType !== "HUMAN") throw new HttpError(404, "Usuario nao encontrado");

  const busy = await prisma.$queryRawUnsafe<{ id: string }[]>(
    `SELECT c.id FROM "GingaDirectCall" c JOIN "GingaDirectCallParticipant" p ON p.call_id=c.id
      WHERE c.state IN ('RINGING','ACTIVE') AND p.user_id=$1 AND p.status IN ('INVITED','JOINED') AND c.id<>$2 LIMIT 1`, userId, callId
  );
  if (busy[0]) throw new HttpError(409, "Esse usuario ja esta em outra chamada");

  await prisma.$executeRawUnsafe(
    `INSERT INTO "GingaDirectCallParticipant" (call_id,user_id,status,invited_by,joined_at,left_at,updated_at)
     VALUES ($1,$2,'INVITED',$3,NULL,NULL,NOW())
     ON CONFLICT (call_id,user_id) DO UPDATE SET status='INVITED', invited_by=$3, joined_at=NULL, left_at=NULL, updated_at=NOW()`,
    callId, userId, inviterId
  );
  await emitCall(ioFrom(req), row);
  res.json({ call: await serializeCall(row, inviterId), invitedUserId: userId });
}));

directCallsRouter.post("/direct-calls/:callId/end", requireAuth, asyncHandler(async (req, res) => {
  const userId = req.auth!.sub;
  const callId = routeParam(req.params.callId, "callId");
  await ensureDirectCallStorage();
  const current = await queryOne(callId);
  const participant = await viewerParticipant(callId, userId);
  if (!current || !participant) throw new HttpError(404, "Chamada nao encontrada");
  if (!["RINGING", "ACTIVE"].includes(current.state)) return res.json({ call: await serializeCall(current, userId) });
  if (current.caller_id !== userId) throw new HttpError(403, "Somente quem iniciou pode encerrar a chamada para todos");
  const nextState: CallState = current.state === "RINGING" ? "CANCELLED" : "ENDED";
  const row = await updateAndReturn(
    `UPDATE "GingaDirectCall" SET state=$2, ended_at=NOW(), duration_ms=CASE WHEN state='ACTIVE' THEN GREATEST(0,FLOOR(EXTRACT(EPOCH FROM (NOW()-COALESCE(answered_at,started_at)))*1000))::INTEGER ELSE NULL END, updated_at=NOW() WHERE id=$1 AND state IN ('RINGING','ACTIVE') RETURNING *`,
    callId, nextState
  );
  if (!row) throw new HttpError(409, "Essa chamada ja foi encerrada");
  await prisma.$executeRawUnsafe(`UPDATE "GingaDirectCallParticipant" SET status='LEFT', left_at=COALESCE(left_at,NOW()), updated_at=NOW() WHERE call_id=$1 AND status IN ('INVITED','JOINED')`, callId);
  await emitCall(ioFrom(req), row);
  res.json({ call: await serializeCall(row, userId) });
}));
