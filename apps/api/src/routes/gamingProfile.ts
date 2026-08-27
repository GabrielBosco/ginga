import { createHash } from "node:crypto";
import { Router, raw } from "express";
import type { Server as SocketServer } from "socket.io";
import { z } from "zod";
import { prisma } from "../db.js";
import { asyncHandler, HttpError } from "../errors.js";
import { requireAuth } from "../middleware.js";
import { routeParam } from "../utils.js";
import { canObserveUser, observableUserIds, presenceAudienceUserIds } from "../socialPrivacy.js";

export const gamingProfileRouter = Router();

const PRESENCE_MODES = ["ONLINE", "AWAY", "BUSY", "OFFLINE"] as const;
const GAME_SOURCES = ["NONE", "MANUAL", "DESKTOP"] as const;
const ONLINE_WINDOW_MS = 90_000;
const DESKTOP_GAME_WINDOW_MS = 75_000;
const MAX_BATCH_USERS = 80;

type PresenceMode = typeof PRESENCE_MODES[number];
type GameSource = typeof GAME_SOURCES[number];

type GamingProfileRow = {
  user_id: string;
  avatar_url: string | null;
  avatar_attachment_id: string | null;
  avatar_mime: string | null;
  avatar_etag: string | null;
  bio: string | null;
  custom_status: string | null;
  presence_mode: PresenceMode;
  auto_away: boolean;
  idle: boolean;
  show_game_activity: boolean;
  auto_detect_game: boolean;
  game_name: string | null;
  game_details: string | null;
  game_source: GameSource;
  game_started_at: Date | string | null;
  game_last_seen_at: Date | string | null;
  last_seen_at: Date | string | null;
  updated_at: Date | string;
};

type UserSummary = {
  id: string;
  username: string;
  displayName: string;
  avatarColor: string;
};

const updateSchema = z.object({
  bio: z.string().trim().max(280).nullable().optional(),
  customStatus: z.string().trim().max(120).nullable().optional(),
  presenceMode: z.enum(PRESENCE_MODES).optional(),
  autoAway: z.boolean().optional(),
  showGameActivity: z.boolean().optional(),
  autoDetectGame: z.boolean().optional(),
  gameName: z.string().trim().max(100).nullable().optional(),
  gameDetails: z.string().trim().max(120).nullable().optional(),
  gameSource: z.enum(GAME_SOURCES).optional(),
  resetGameStartedAt: z.boolean().optional()
}).strict();

const heartbeatSchema = z.object({
  idle: z.boolean().default(false)
}).strict();

const batchSchema = z.object({
  usernames: z.string().trim().max(3000).default("")
});

function ioFrom(req: { app: { get(name: string): unknown } }): SocketServer | null {
  const io = req.app.get("io");
  return io && typeof io === "object" ? io as SocketServer : null;
}

function effectivePresence(row: GamingProfileRow): PresenceMode {
  if (row.presence_mode === "OFFLINE") return "OFFLINE";
  const lastSeen = row.last_seen_at ? new Date(row.last_seen_at).getTime() : 0;
  if (!lastSeen || Date.now() - lastSeen > ONLINE_WINDOW_MS) return "OFFLINE";
  if (row.presence_mode === "BUSY") return "BUSY";
  if (row.presence_mode === "AWAY") return "AWAY";
  if (row.auto_away && row.idle) return "AWAY";
  return "ONLINE";
}

function cleanNullable(value: string | null | undefined) {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const trimmed = value.trim();
  return trimmed || null;
}


function publicProfile(user: UserSummary, row: GamingProfileRow) {
  const presence = effectivePresence(row);
  const desktopGameFresh = row.game_source !== "DESKTOP" || (row.game_last_seen_at && Date.now() - new Date(row.game_last_seen_at).getTime() <= DESKTOP_GAME_WINDOW_MS);
  const gameVisible = row.show_game_activity && presence !== "OFFLINE" && Boolean(row.game_name) && Boolean(desktopGameFresh);
  return {
    user: {
      id: user.id,
      username: user.username,
      displayName: user.displayName,
      avatarColor: user.avatarColor
    },
    avatarUrl: row.avatar_url,
    bio: row.bio,
    customStatus: row.custom_status,
    presence,
    activity: gameVisible ? {
      type: "PLAYING" as const,
      name: row.game_name,
      details: row.game_details || "Sobreposição de jogo",
      startedAt: row.game_started_at ? new Date(row.game_started_at).toISOString() : null
    } : null,
    updatedAt: new Date(row.updated_at).toISOString()
  };
}

function privacyFilteredProfile(user: UserSummary, row: GamingProfileRow, canObserve: boolean) {
  const profile = publicProfile(user, row);
  if (canObserve) return profile;
  return { ...profile, presence: "OFFLINE" as const, activity: null, customStatus: null };
}

function ownProfile(user: UserSummary, row: GamingProfileRow) {
  return {
    ...publicProfile(user, row),
    settings: {
      presenceMode: row.presence_mode,
      autoAway: row.auto_away,
      showGameActivity: row.show_game_activity,
      autoDetectGame: row.auto_detect_game,
      gameName: row.game_name,
      gameDetails: row.game_details,
      gameSource: row.game_source,
      idle: row.idle,
      avatarAttachmentId: row.avatar_attachment_id
    }
  };
}

async function userSummaryById(userId: string): Promise<UserSummary> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, username: true, displayName: true, avatarColor: true, accountType: true }
  });
  if (!user || user.accountType !== "HUMAN") throw new HttpError(404, "Usuario nao encontrado");
  return user;
}

async function ensureRow(userId: string): Promise<GamingProfileRow> {
  await prisma.$executeRawUnsafe(
    `INSERT INTO "GingaGamingProfile" (user_id) VALUES ($1) ON CONFLICT (user_id) DO NOTHING`,
    userId
  );
  const rows = await prisma.$queryRawUnsafe<GamingProfileRow[]>(
    `SELECT * FROM "GingaGamingProfile" WHERE user_id = $1 LIMIT 1`,
    userId
  );
  const row = rows[0];
  if (!row) throw new HttpError(500, "Nao foi possivel carregar o perfil");
  return row;
}

async function ensureRows(userIds: string[]) {
  if (!userIds.length) return;
  const values = userIds.map((_, index) => `($${index + 1})`).join(",");
  await prisma.$executeRawUnsafe(
    `INSERT INTO "GingaGamingProfile" (user_id) VALUES ${values} ON CONFLICT (user_id) DO NOTHING`,
    ...userIds
  );
}

async function emitProfile(io: SocketServer | null, userId: string) {
  if (!io) return;
  try {
    const [user, row] = await Promise.all([userSummaryById(userId), ensureRow(userId)]);
    const payload = publicProfile(user, row);
    const audience = await presenceAudienceUserIds(userId);
    for (const targetUserId of audience) {
      io.to(`user:${targetUserId}`).emit("ginga:profile:update", payload);
      io.to(`user:${targetUserId}`).emit("ginga:presence:update", {
        userId,
        username: user.username,
        presence: payload.presence,
        activity: payload.activity
      });
    }
  } catch (error) {
    console.warn("Ginga Gaming Profile: falha ao emitir perfil", error);
  }
}

let gamingProfileStoragePromise: Promise<void> | null = null;

async function initializeGamingProfileStorage() {
  // Esta tabela nasceu antes de algumas opcoes atuais de perfil/presenca. Em
  // instalacoes atualizadas, CREATE TABLE IF NOT EXISTS nao adiciona colunas nem
  // corrige constraints antigas. A migracao abaixo e deliberadamente idempotente
  // para que uma atualizacao do Ginga repare o schema sem exigir SQL manual.
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "GingaGamingProfile" (
      user_id TEXT PRIMARY KEY,
      avatar_url TEXT NULL,
      avatar_attachment_id TEXT NULL,
      avatar_blob BYTEA NULL,
      avatar_mime VARCHAR(40) NULL,
      avatar_etag VARCHAR(64) NULL,
      bio VARCHAR(280) NULL,
      custom_status VARCHAR(120) NULL,
      presence_mode VARCHAR(16) NOT NULL DEFAULT 'ONLINE',
      auto_away BOOLEAN NOT NULL DEFAULT TRUE,
      idle BOOLEAN NOT NULL DEFAULT FALSE,
      show_game_activity BOOLEAN NOT NULL DEFAULT FALSE,
      auto_detect_game BOOLEAN NOT NULL DEFAULT FALSE,
      game_name VARCHAR(100) NULL,
      game_details VARCHAR(120) NULL,
      game_source VARCHAR(16) NOT NULL DEFAULT 'NONE',
      game_started_at TIMESTAMPTZ NULL,
      game_last_seen_at TIMESTAMPTZ NULL,
      last_seen_at TIMESTAMPTZ NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  const additiveMigrations = [
    `ALTER TABLE "GingaGamingProfile" ADD COLUMN IF NOT EXISTS avatar_url TEXT NULL`,
    `ALTER TABLE "GingaGamingProfile" ADD COLUMN IF NOT EXISTS avatar_attachment_id TEXT NULL`,
    `ALTER TABLE "GingaGamingProfile" ADD COLUMN IF NOT EXISTS avatar_blob BYTEA NULL`,
    `ALTER TABLE "GingaGamingProfile" ADD COLUMN IF NOT EXISTS avatar_mime VARCHAR(40) NULL`,
    `ALTER TABLE "GingaGamingProfile" ADD COLUMN IF NOT EXISTS avatar_etag VARCHAR(64) NULL`,
    `ALTER TABLE "GingaGamingProfile" ADD COLUMN IF NOT EXISTS bio VARCHAR(280) NULL`,
    `ALTER TABLE "GingaGamingProfile" ADD COLUMN IF NOT EXISTS custom_status VARCHAR(120) NULL`,
    `ALTER TABLE "GingaGamingProfile" ADD COLUMN IF NOT EXISTS presence_mode VARCHAR(16) DEFAULT 'ONLINE'`,
    `ALTER TABLE "GingaGamingProfile" ADD COLUMN IF NOT EXISTS auto_away BOOLEAN DEFAULT TRUE`,
    `ALTER TABLE "GingaGamingProfile" ADD COLUMN IF NOT EXISTS idle BOOLEAN DEFAULT FALSE`,
    `ALTER TABLE "GingaGamingProfile" ADD COLUMN IF NOT EXISTS show_game_activity BOOLEAN DEFAULT FALSE`,
    `ALTER TABLE "GingaGamingProfile" ADD COLUMN IF NOT EXISTS auto_detect_game BOOLEAN DEFAULT FALSE`,
    `ALTER TABLE "GingaGamingProfile" ADD COLUMN IF NOT EXISTS game_name VARCHAR(100) NULL`,
    `ALTER TABLE "GingaGamingProfile" ADD COLUMN IF NOT EXISTS game_details VARCHAR(120) NULL`,
    `ALTER TABLE "GingaGamingProfile" ADD COLUMN IF NOT EXISTS game_source VARCHAR(16) DEFAULT 'NONE'`,
    `ALTER TABLE "GingaGamingProfile" ADD COLUMN IF NOT EXISTS game_started_at TIMESTAMPTZ NULL`,
    `ALTER TABLE "GingaGamingProfile" ADD COLUMN IF NOT EXISTS game_last_seen_at TIMESTAMPTZ NULL`,
    `ALTER TABLE "GingaGamingProfile" ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ NULL`,
    `ALTER TABLE "GingaGamingProfile" ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW()`
  ];
  for (const statement of additiveMigrations) await prisma.$executeRawUnsafe(statement);

  // Normaliza dados legados antes de reconstruir as constraints. Isso corrige
  // bases que tinham nomes antigos de status e e a causa mais comum de 500 ao
  // alternar Online/Ausente/Ocupado em instalacoes atualizadas.
  await prisma.$executeRawUnsafe(`UPDATE "GingaGamingProfile" SET presence_mode = 'ONLINE' WHERE presence_mode IS NULL OR presence_mode NOT IN ('ONLINE','AWAY','BUSY','OFFLINE')`);
  await prisma.$executeRawUnsafe(`UPDATE "GingaGamingProfile" SET game_source = 'NONE' WHERE game_source IS NULL OR game_source NOT IN ('NONE','MANUAL','DESKTOP')`);
  await prisma.$executeRawUnsafe(`UPDATE "GingaGamingProfile" SET auto_away = TRUE WHERE auto_away IS NULL`);
  await prisma.$executeRawUnsafe(`UPDATE "GingaGamingProfile" SET idle = FALSE WHERE idle IS NULL`);
  await prisma.$executeRawUnsafe(`UPDATE "GingaGamingProfile" SET show_game_activity = FALSE WHERE show_game_activity IS NULL`);
  await prisma.$executeRawUnsafe(`UPDATE "GingaGamingProfile" SET auto_detect_game = FALSE WHERE auto_detect_game IS NULL`);
  await prisma.$executeRawUnsafe(`UPDATE "GingaGamingProfile" SET updated_at = NOW() WHERE updated_at IS NULL`);

  await prisma.$executeRawUnsafe(`ALTER TABLE "GingaGamingProfile" ALTER COLUMN presence_mode SET DEFAULT 'ONLINE', ALTER COLUMN presence_mode SET NOT NULL`);
  await prisma.$executeRawUnsafe(`ALTER TABLE "GingaGamingProfile" ALTER COLUMN auto_away SET DEFAULT TRUE, ALTER COLUMN auto_away SET NOT NULL`);
  await prisma.$executeRawUnsafe(`ALTER TABLE "GingaGamingProfile" ALTER COLUMN idle SET DEFAULT FALSE, ALTER COLUMN idle SET NOT NULL`);
  await prisma.$executeRawUnsafe(`ALTER TABLE "GingaGamingProfile" ALTER COLUMN show_game_activity SET DEFAULT FALSE, ALTER COLUMN show_game_activity SET NOT NULL`);
  await prisma.$executeRawUnsafe(`ALTER TABLE "GingaGamingProfile" ALTER COLUMN auto_detect_game SET DEFAULT FALSE, ALTER COLUMN auto_detect_game SET NOT NULL`);
  await prisma.$executeRawUnsafe(`ALTER TABLE "GingaGamingProfile" ALTER COLUMN game_source SET DEFAULT 'NONE', ALTER COLUMN game_source SET NOT NULL`);
  await prisma.$executeRawUnsafe(`ALTER TABLE "GingaGamingProfile" ALTER COLUMN updated_at SET DEFAULT NOW(), ALTER COLUMN updated_at SET NOT NULL`);

  // Remove inclusive constraints antigas com outro nome. Houve builds antigos em
  // que o Postgres recebeu CHECKs diferentes; manter um deles faria BUSY/AWAY
  // continuar retornando 500 mesmo depois da atualizacao do codigo.
  await prisma.$executeRawUnsafe(`
    DO $$
    DECLARE constraint_name TEXT;
    BEGIN
      FOR constraint_name IN
        SELECT con.conname
          FROM pg_constraint con
          JOIN pg_class rel ON rel.oid = con.conrelid
         WHERE rel.relname = 'GingaGamingProfile'
           AND con.contype = 'c'
           AND (pg_get_constraintdef(con.oid) ILIKE '%presence_mode%' OR pg_get_constraintdef(con.oid) ILIKE '%game_source%')
      LOOP
        EXECUTE format('ALTER TABLE "GingaGamingProfile" DROP CONSTRAINT %I', constraint_name);
      END LOOP;
    END $$;
  `);
  await prisma.$executeRawUnsafe(`ALTER TABLE "GingaGamingProfile" ADD CONSTRAINT ginga_presence_mode_check CHECK (presence_mode IN ('ONLINE','AWAY','BUSY','OFFLINE'))`);
  await prisma.$executeRawUnsafe(`ALTER TABLE "GingaGamingProfile" ADD CONSTRAINT ginga_game_source_check CHECK (game_source IN ('NONE','MANUAL','DESKTOP'))`);
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "ginga_gaming_profile_last_seen_idx" ON "GingaGamingProfile" (last_seen_at DESC)`);
}

export async function ensureGamingProfileStorage() {
  if (!gamingProfileStoragePromise) {
    gamingProfileStoragePromise = initializeGamingProfileStorage().catch((error) => {
      gamingProfileStoragePromise = null;
      throw error;
    });
  }
  await gamingProfileStoragePromise;
}


gamingProfileRouter.get("/gaming-profile/avatars", requireAuth, asyncHandler(async (req, res) => {
  await ensureGamingProfileStorage();
  const rawIds = String(req.query.ids ?? "");
  const ids = Array.from(new Set(rawIds.split(",").map((item) => item.trim()).filter(Boolean))).slice(0, 100);
  if (!ids.length) return res.json({ avatars: {} });
  const placeholders = ids.map((_, index) => `$${index + 1}`).join(",");
  const rows = await prisma.$queryRawUnsafe<Array<{ user_id: string; avatar_url: string | null }>>(
    `SELECT user_id, avatar_url FROM "GingaGamingProfile" WHERE user_id IN (${placeholders})`,
    ...ids
  );
  const avatars: Record<string, string | null> = Object.fromEntries(ids.map((id) => [id, null]));
  rows.forEach((row) => { avatars[row.user_id] = row.avatar_url ?? null; });
  res.json({ avatars });
}));

gamingProfileRouter.get("/gaming-profile/avatar/:userId/:etag", asyncHandler(async (req, res) => {
  const userId = routeParam(req.params.userId, "userId");
  const etag = routeParam(req.params.etag, "etag").replace(/\.webp$/i, "");
  await ensureGamingProfileStorage();
  const rows = await prisma.$queryRawUnsafe<Array<{ avatar_blob: Uint8Array | null; avatar_mime: string | null; avatar_etag: string | null }>>(
    `SELECT avatar_blob, avatar_mime, avatar_etag FROM "GingaGamingProfile" WHERE user_id = $1 LIMIT 1`,
    userId
  );
  const avatar = rows[0];
  if (!avatar?.avatar_blob || !avatar.avatar_etag || avatar.avatar_etag !== etag) throw new HttpError(404, "Avatar nao encontrado");
  res.setHeader("Content-Type", avatar.avatar_mime || "image/webp");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Content-Disposition", "inline");
  res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
  res.setHeader("ETag", `"${avatar.avatar_etag}"`);
  res.send(Buffer.from(avatar.avatar_blob));
}));

gamingProfileRouter.post(
  "/gaming-profile/avatar",
  requireAuth,
  raw({ type: "image/webp", limit: "1mb" }),
  asyncHandler(async (req, res) => {
    const userId = req.auth!.sub;
    const body = req.body;
    if (!Buffer.isBuffer(body) || body.length < 16) throw new HttpError(400, "Avatar WebP invalido");
    if (body.length > 1024 * 1024) throw new HttpError(413, "Avatar muito grande");
    const isWebp = body.subarray(0, 4).toString("ascii") === "RIFF" && body.subarray(8, 12).toString("ascii") === "WEBP";
    if (!isWebp) throw new HttpError(400, "O avatar precisa ser uma imagem WebP valida");

    await ensureGamingProfileStorage();
    await ensureRow(userId);
    const etag = createHash("sha256").update(body).digest("hex").slice(0, 32);
    const avatarUrl = `/api/gaming-profile/avatar/${encodeURIComponent(userId)}/${etag}.webp`;
    await prisma.$executeRawUnsafe(
      `UPDATE "GingaGamingProfile"
          SET avatar_blob = $2,
              avatar_mime = 'image/webp',
              avatar_etag = $3,
              avatar_url = $4,
              avatar_attachment_id = NULL,
              updated_at = NOW()
        WHERE user_id = $1`,
      userId,
      body,
      etag,
      avatarUrl
    );
    const [user, row] = await Promise.all([userSummaryById(userId), ensureRow(userId)]);
    const profile = ownProfile(user, row);
    await emitProfile(ioFrom(req), userId);
    res.json({ profile });
  })
);

gamingProfileRouter.delete("/gaming-profile/avatar", requireAuth, asyncHandler(async (req, res) => {
  const userId = req.auth!.sub;
  await ensureGamingProfileStorage();
  await ensureRow(userId);
  await prisma.$executeRawUnsafe(
    `UPDATE "GingaGamingProfile"
        SET avatar_blob = NULL,
            avatar_mime = NULL,
            avatar_etag = NULL,
            avatar_url = NULL,
            avatar_attachment_id = NULL,
            updated_at = NOW()
      WHERE user_id = $1`,
    userId
  );
  const [user, row] = await Promise.all([userSummaryById(userId), ensureRow(userId)]);
  const profile = ownProfile(user, row);
  await emitProfile(ioFrom(req), userId);
  res.json({ profile });
}));

gamingProfileRouter.get("/gaming-profile/me", requireAuth, asyncHandler(async (req, res) => {
  const userId = req.auth!.sub;
  await ensureGamingProfileStorage();
  const [user, row] = await Promise.all([userSummaryById(userId), ensureRow(userId)]);
  res.json({ profile: ownProfile(user, row) });
}));

gamingProfileRouter.patch("/gaming-profile/presence", requireAuth, asyncHandler(async (req, res) => {
  const userId = req.auth!.sub;
  const { presenceMode } = z.object({ presenceMode: z.enum(PRESENCE_MODES) }).strict().parse(req.body);
  await ensureGamingProfileStorage();
  await ensureRow(userId);

  const rows = await prisma.$queryRawUnsafe<GamingProfileRow[]>(
    `UPDATE "GingaGamingProfile"
        SET presence_mode = $2,
            idle = FALSE,
            last_seen_at = CASE WHEN $2::text = 'OFFLINE' THEN last_seen_at ELSE NOW() END,
            updated_at = NOW()
      WHERE user_id = $1
      RETURNING *`,
    userId,
    presenceMode
  );
  const row = rows[0];
  if (!row) throw new HttpError(500, "Nao foi possivel atualizar a presenca");
  const user = await userSummaryById(userId);
  const profile = ownProfile(user, row);
  await emitProfile(ioFrom(req), userId);
  res.json({ profile });
}));

gamingProfileRouter.patch("/gaming-profile/me", requireAuth, asyncHandler(async (req, res) => {
  const userId = req.auth!.sub;
  const input = updateSchema.parse(req.body);
  await ensureGamingProfileStorage();
  const current = await ensureRow(userId);

  const avatarUrl = current.avatar_url;
  const avatarAttachmentId = current.avatar_attachment_id;
  const bio = input.bio === undefined ? current.bio : cleanNullable(input.bio);
  const customStatus = input.customStatus === undefined ? current.custom_status : cleanNullable(input.customStatus);
  const presenceMode = input.presenceMode ?? current.presence_mode;
  const autoAway = input.autoAway ?? current.auto_away;
  const showGameActivity = input.showGameActivity ?? current.show_game_activity;
  const autoDetectGame = input.autoDetectGame ?? current.auto_detect_game;
  const gameName = input.gameName === undefined ? current.game_name : cleanNullable(input.gameName);
  const gameDetails = input.gameDetails === undefined ? current.game_details : cleanNullable(input.gameDetails);
  const gameSource = input.gameSource ?? current.game_source;
  const gameChanged = gameName !== current.game_name || gameSource !== current.game_source;

  const rows = await prisma.$queryRawUnsafe<GamingProfileRow[]>(
    `UPDATE "GingaGamingProfile"
        SET avatar_url = $2,
            avatar_attachment_id = $3,
            bio = $4,
            custom_status = $5,
            presence_mode = $6,
            auto_away = $7,
            show_game_activity = $8,
            auto_detect_game = $9,
            game_name = $10,
            game_details = $11,
            game_source = $12,
            game_started_at = CASE
              WHEN $13::boolean THEN NULL
              WHEN $14::boolean AND $10::text IS NOT NULL THEN NOW()
              WHEN $10::text IS NULL THEN NULL
              ELSE game_started_at
            END,
            game_last_seen_at = CASE
              WHEN $10::text IS NULL OR $12::text <> 'DESKTOP' THEN NULL
              ELSE NOW()
            END,
            updated_at = NOW()
      WHERE user_id = $1
      RETURNING *`,
    userId,
    avatarUrl,
    avatarAttachmentId,
    bio,
    customStatus,
    presenceMode,
    autoAway,
    showGameActivity,
    autoDetectGame,
    gameName,
    gameDetails,
    gameSource,
    Boolean(input.resetGameStartedAt),
    gameChanged
  );
  const row = rows[0];
  if (!row) throw new HttpError(500, "Nao foi possivel salvar o perfil");
  const user = await userSummaryById(userId);
  const profile = ownProfile(user, row);
  await emitProfile(ioFrom(req), userId);
  res.json({ profile });
}));

gamingProfileRouter.post("/gaming-profile/heartbeat", requireAuth, asyncHandler(async (req, res) => {
  const userId = req.auth!.sub;
  const { idle } = heartbeatSchema.parse(req.body ?? {});
  await ensureGamingProfileStorage();
  const previous = await ensureRow(userId);
  const previousPresence = effectivePresence(previous);
  const rows = await prisma.$queryRawUnsafe<GamingProfileRow[]>(
    `UPDATE "GingaGamingProfile"
        SET idle = $2,
            last_seen_at = NOW(),
            updated_at = CASE WHEN idle IS DISTINCT FROM $2 THEN NOW() ELSE updated_at END
      WHERE user_id = $1
      RETURNING *`,
    userId,
    idle
  );
  const row = rows[0];
  if (!row) throw new HttpError(500, "Nao foi possivel atualizar a presenca");
  const user = await userSummaryById(userId);
  const profile = ownProfile(user, row);
  if (previousPresence !== profile.presence || previous.idle !== idle) await emitProfile(ioFrom(req), userId);
  res.json({ presence: profile.presence, activity: profile.activity });
}));

gamingProfileRouter.get("/gaming-profile/user/:userId", requireAuth, asyncHandler(async (req, res) => {
  const userId = routeParam(req.params.userId, "userId");
  await ensureGamingProfileStorage();
  const [user, row, visible] = await Promise.all([userSummaryById(userId), ensureRow(userId), canObserveUser(req.auth!.sub, userId)]);
  res.json({ profile: privacyFilteredProfile(user, row, visible) });
}));

gamingProfileRouter.get("/gaming-profile/by-username/:username", requireAuth, asyncHandler(async (req, res) => {
  const username = routeParam(req.params.username, "username").toLowerCase();
  await ensureGamingProfileStorage();
  const user = await prisma.user.findFirst({
    where: { username: { equals: username, mode: "insensitive" }, accountType: "HUMAN" },
    select: { id: true, username: true, displayName: true, avatarColor: true }
  });
  if (!user) throw new HttpError(404, "Usuario nao encontrado");
  const [row, visible] = await Promise.all([ensureRow(user.id), canObserveUser(req.auth!.sub, user.id)]);
  res.json({ profile: privacyFilteredProfile(user, row, visible) });
}));

gamingProfileRouter.get("/gaming-profile/batch", requireAuth, asyncHandler(async (req, res) => {
  const { usernames } = batchSchema.parse(req.query);
  await ensureGamingProfileStorage();
  const requested = Array.from(new Set(usernames.split(",").map((value) => value.trim().toLowerCase()).filter(Boolean))).slice(0, MAX_BATCH_USERS);
  if (!requested.length) return res.json({ profiles: [] });

  const users = await prisma.user.findMany({
    where: {
      accountType: "HUMAN",
      OR: requested.map((username) => ({ username: { equals: username, mode: "insensitive" as const } }))
    },
    select: { id: true, username: true, displayName: true, avatarColor: true }
  });
  if (!users.length) return res.json({ profiles: [] });
  const ids = users.map((user) => user.id);
  await ensureRows(ids);
  const placeholders = ids.map((_, index) => `$${index + 1}`).join(",");
  const rows = await prisma.$queryRawUnsafe<GamingProfileRow[]>(
    `SELECT * FROM "GingaGamingProfile" WHERE user_id IN (${placeholders})`,
    ...ids
  );
  const byId = new Map(rows.map((row) => [row.user_id, row]));
  const visible = await observableUserIds(req.auth!.sub, ids);
  res.json({
    profiles: users.flatMap((user) => {
      const row = byId.get(user.id);
      return row ? [privacyFilteredProfile(user, row, visible.has(user.id))] : [];
    })
  });
}));
