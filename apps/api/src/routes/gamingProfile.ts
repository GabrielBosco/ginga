import { createHash } from "node:crypto";
import { Router, raw, type Request } from "express";
import type { Server as SocketServer } from "socket.io";
import { z } from "zod";
import { prisma } from "../db.js";
import { asyncHandler, HttpError } from "../errors.js";
import { requireAuth } from "../middleware.js";
import { routeParam } from "../utils.js";
import { canObserveUser, observableUserIds, presenceAudienceUserIds } from "../socialPrivacy.js";
import { reasonableGifDimensions, signatureMatches } from "../fileValidation.js";

export const gamingProfileRouter = Router();

const PRESENCE_MODES = ["ONLINE", "AWAY", "BUSY", "OFFLINE"] as const;
const GAME_SOURCES = ["NONE", "MANUAL", "DESKTOP"] as const;
const PROFILE_THEMES = ["AURORA", "SOLID", "MIDNIGHT"] as const;
const ONLINE_WINDOW_MS = 90_000;
const DESKTOP_GAME_WINDOW_MS = 75_000;
const MAX_BATCH_USERS = 80;

const PROFILE_IMAGE_MIMES = ["image/webp", "image/gif"] as const;
type ProfileImageMime = typeof PROFILE_IMAGE_MIMES[number];

function profileImageMime(req: Request): ProfileImageMime {
  const mime = String(req.headers["content-type"] || "").split(";", 1)[0]!.trim().toLowerCase();
  if (!(PROFILE_IMAGE_MIMES as readonly string[]).includes(mime)) throw new HttpError(415, "Use WebP ou GIF para esta imagem");
  return mime as ProfileImageMime;
}

function profileImageExtension(mime: ProfileImageMime) {
  return mime === "image/gif" ? "gif" : "webp";
}

type PresenceMode = typeof PRESENCE_MODES[number];
type GameSource = typeof GAME_SOURCES[number];
type ProfileTheme = typeof PROFILE_THEMES[number];

type ProfileLink = { label: string; url: string };

type GamingProfileRow = {
  user_id: string;
  avatar_url: string | null;
  avatar_attachment_id: string | null;
  avatar_mime: string | null;
  avatar_etag: string | null;
  banner_url: string | null;
  banner_blob: Uint8Array | null;
  banner_mime: string | null;
  banner_etag: string | null;
  bio: string | null;
  custom_status: string | null;
  accent_color: string | null;
  secondary_color: string | null;
  profile_theme: ProfileTheme;
  banner_position: number;
  pronouns: string | null;
  profile_links: unknown;
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

const profileLinkSchema = z.object({
  label: z.string().trim().min(1).max(24),
  url: z.string().trim().url().max(300)
}).strict();

const updateSchema = z.object({
  bio: z.string().trim().max(280).nullable().optional(),
  customStatus: z.string().trim().max(120).nullable().optional(),
  accentColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).nullable().optional(),
  secondaryColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).nullable().optional(),
  profileTheme: z.enum(PROFILE_THEMES).optional(),
  bannerPosition: z.number().int().min(0).max(100).optional(),
  pronouns: z.string().trim().max(40).nullable().optional(),
  profileLinks: z.array(profileLinkSchema).max(3).optional(),
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

function profileLinks(value: unknown): ProfileLink[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const candidate = item as { label?: unknown; url?: unknown };
    if (typeof candidate.label !== "string" || typeof candidate.url !== "string") return [];
    const parsed = profileLinkSchema.safeParse({ label: candidate.label, url: candidate.url });
    return parsed.success ? [parsed.data] : [];
  }).slice(0, 3);
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
    bannerUrl: row.banner_url,
    bio: row.bio,
    customStatus: row.custom_status,
    appearance: {
      accentColor: row.accent_color || user.avatarColor || "#7c3cff",
      secondaryColor: row.secondary_color || "#2c74ff",
      profileTheme: row.profile_theme || "AURORA",
      bannerPosition: Number.isFinite(Number(row.banner_position)) ? Math.min(100, Math.max(0, Number(row.banner_position))) : 50,
      pronouns: row.pronouns,
      links: profileLinks(row.profile_links)
    },
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
      banner_url TEXT NULL,
      banner_blob BYTEA NULL,
      banner_mime VARCHAR(40) NULL,
      banner_etag VARCHAR(64) NULL,
      bio VARCHAR(280) NULL,
      custom_status VARCHAR(120) NULL,
      accent_color VARCHAR(7) NULL,
      secondary_color VARCHAR(7) NULL,
      profile_theme VARCHAR(16) NOT NULL DEFAULT 'AURORA',
      banner_position INTEGER NOT NULL DEFAULT 50,
      pronouns VARCHAR(40) NULL,
      profile_links JSONB NOT NULL DEFAULT '[]'::jsonb,
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
    `ALTER TABLE "GingaGamingProfile" ADD COLUMN IF NOT EXISTS banner_url TEXT NULL`,
    `ALTER TABLE "GingaGamingProfile" ADD COLUMN IF NOT EXISTS banner_blob BYTEA NULL`,
    `ALTER TABLE "GingaGamingProfile" ADD COLUMN IF NOT EXISTS banner_mime VARCHAR(40) NULL`,
    `ALTER TABLE "GingaGamingProfile" ADD COLUMN IF NOT EXISTS banner_etag VARCHAR(64) NULL`,
    `ALTER TABLE "GingaGamingProfile" ADD COLUMN IF NOT EXISTS bio VARCHAR(280) NULL`,
    `ALTER TABLE "GingaGamingProfile" ADD COLUMN IF NOT EXISTS custom_status VARCHAR(120) NULL`,
    `ALTER TABLE "GingaGamingProfile" ADD COLUMN IF NOT EXISTS accent_color VARCHAR(7) NULL`,
    `ALTER TABLE "GingaGamingProfile" ADD COLUMN IF NOT EXISTS secondary_color VARCHAR(7) NULL`,
    `ALTER TABLE "GingaGamingProfile" ADD COLUMN IF NOT EXISTS profile_theme VARCHAR(16) DEFAULT 'AURORA'`,
    `ALTER TABLE "GingaGamingProfile" ADD COLUMN IF NOT EXISTS banner_position INTEGER DEFAULT 50`,
    `ALTER TABLE "GingaGamingProfile" ADD COLUMN IF NOT EXISTS pronouns VARCHAR(40) NULL`,
    `ALTER TABLE "GingaGamingProfile" ADD COLUMN IF NOT EXISTS profile_links JSONB DEFAULT '[]'::jsonb`,
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
  await prisma.$executeRawUnsafe(`UPDATE "GingaGamingProfile" SET profile_theme = 'AURORA' WHERE profile_theme IS NULL OR profile_theme NOT IN ('AURORA','SOLID','MIDNIGHT')`);
  await prisma.$executeRawUnsafe(`UPDATE "GingaGamingProfile" SET banner_position = 50 WHERE banner_position IS NULL OR banner_position < 0 OR banner_position > 100`);
  await prisma.$executeRawUnsafe(`UPDATE "GingaGamingProfile" SET profile_links = '[]'::jsonb WHERE profile_links IS NULL OR jsonb_typeof(profile_links) <> 'array'`);
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
  await prisma.$executeRawUnsafe(`ALTER TABLE "GingaGamingProfile" ALTER COLUMN profile_theme SET DEFAULT 'AURORA', ALTER COLUMN profile_theme SET NOT NULL`);
  await prisma.$executeRawUnsafe(`ALTER TABLE "GingaGamingProfile" ALTER COLUMN banner_position SET DEFAULT 50, ALTER COLUMN banner_position SET NOT NULL`);
  await prisma.$executeRawUnsafe(`ALTER TABLE "GingaGamingProfile" ALTER COLUMN profile_links SET DEFAULT '[]'::jsonb, ALTER COLUMN profile_links SET NOT NULL`);
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
           AND (pg_get_constraintdef(con.oid) ILIKE '%presence_mode%' OR pg_get_constraintdef(con.oid) ILIKE '%game_source%' OR pg_get_constraintdef(con.oid) ILIKE '%profile_theme%' OR pg_get_constraintdef(con.oid) ILIKE '%banner_position%')
      LOOP
        EXECUTE format('ALTER TABLE "GingaGamingProfile" DROP CONSTRAINT %I', constraint_name);
      END LOOP;
    END $$;
  `);
  await prisma.$executeRawUnsafe(`ALTER TABLE "GingaGamingProfile" ADD CONSTRAINT ginga_presence_mode_check CHECK (presence_mode IN ('ONLINE','AWAY','BUSY','OFFLINE'))`);
  await prisma.$executeRawUnsafe(`ALTER TABLE "GingaGamingProfile" ADD CONSTRAINT ginga_game_source_check CHECK (game_source IN ('NONE','MANUAL','DESKTOP'))`);
  await prisma.$executeRawUnsafe(`ALTER TABLE "GingaGamingProfile" ADD CONSTRAINT ginga_profile_theme_check CHECK (profile_theme IN ('AURORA','SOLID','MIDNIGHT'))`);
  await prisma.$executeRawUnsafe(`ALTER TABLE "GingaGamingProfile" ADD CONSTRAINT ginga_banner_position_check CHECK (banner_position BETWEEN 0 AND 100)`);
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
  const etag = routeParam(req.params.etag, "etag").replace(/\.(?:webp|gif)$/i, "");
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
  raw({ type: ["image/webp", "image/gif"], limit: "8mb" }),
  asyncHandler(async (req, res) => {
    const userId = req.auth!.sub;
    const body = req.body;
    if (!Buffer.isBuffer(body) || body.length < 16) throw new HttpError(400, "Avatar invalido");
    if (body.length > 8 * 1024 * 1024) throw new HttpError(413, "Avatar muito grande. Limite: 8 MB");
    const mime = profileImageMime(req);
    if (!signatureMatches(mime, body)) throw new HttpError(415, "O conteudo do avatar nao corresponde ao tipo informado");
    if (mime === "image/gif" && !reasonableGifDimensions(body)) throw new HttpError(415, "GIF invalido ou com resolucao grande demais");

    await ensureGamingProfileStorage();
    await ensureRow(userId);
    const etag = createHash("sha256").update(body).digest("hex").slice(0, 32);
    const extension = profileImageExtension(mime);
    const avatarUrl = `/api/gaming-profile/avatar/${encodeURIComponent(userId)}/${etag}.${extension}`;
    await prisma.$executeRawUnsafe(
      `UPDATE "GingaGamingProfile"
          SET avatar_blob = $2,
              avatar_mime = $5,
              avatar_etag = $3,
              avatar_url = $4,
              avatar_attachment_id = NULL,
              updated_at = NOW()
        WHERE user_id = $1`,
      userId,
      body,
      etag,
      avatarUrl,
      mime
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

gamingProfileRouter.get("/gaming-profile/banner/:userId/:etag", asyncHandler(async (req, res) => {
  const userId = routeParam(req.params.userId, "userId");
  const etag = routeParam(req.params.etag, "etag").replace(/\.(?:webp|gif)$/i, "");
  await ensureGamingProfileStorage();
  const rows = await prisma.$queryRawUnsafe<Array<{ banner_blob: Uint8Array | null; banner_mime: string | null; banner_etag: string | null }>>(
    `SELECT banner_blob, banner_mime, banner_etag FROM "GingaGamingProfile" WHERE user_id = $1 LIMIT 1`,
    userId
  );
  const banner = rows[0];
  if (!banner?.banner_blob || !banner.banner_etag || banner.banner_etag !== etag) throw new HttpError(404, "Banner nao encontrado");
  res.setHeader("Content-Type", banner.banner_mime || "image/webp");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Content-Disposition", "inline");
  res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
  res.setHeader("ETag", `"${banner.banner_etag}"`);
  res.send(Buffer.from(banner.banner_blob));
}));

gamingProfileRouter.post(
  "/gaming-profile/banner",
  requireAuth,
  raw({ type: ["image/webp", "image/gif"], limit: "12mb" }),
  asyncHandler(async (req, res) => {
    const userId = req.auth!.sub;
    const body = req.body;
    if (!Buffer.isBuffer(body) || body.length < 16) throw new HttpError(400, "Banner invalido");
    if (body.length > 12 * 1024 * 1024) throw new HttpError(413, "Banner muito grande. Limite: 12 MB");
    const mime = profileImageMime(req);
    if (!signatureMatches(mime, body)) throw new HttpError(415, "O conteudo do banner nao corresponde ao tipo informado");
    if (mime === "image/gif" && !reasonableGifDimensions(body)) throw new HttpError(415, "GIF invalido ou com resolucao grande demais");

    await ensureGamingProfileStorage();
    await ensureRow(userId);
    const etag = createHash("sha256").update(body).digest("hex").slice(0, 32);
    const extension = profileImageExtension(mime);
    const bannerUrl = `/api/gaming-profile/banner/${encodeURIComponent(userId)}/${etag}.${extension}`;
    await prisma.$executeRawUnsafe(
      `UPDATE "GingaGamingProfile"
          SET banner_blob = $2,
              banner_mime = $5,
              banner_etag = $3,
              banner_url = $4,
              updated_at = NOW()
        WHERE user_id = $1`,
      userId, body, etag, bannerUrl, mime
    );
    const [user, row] = await Promise.all([userSummaryById(userId), ensureRow(userId)]);
    const profile = ownProfile(user, row);
    await emitProfile(ioFrom(req), userId);
    res.json({ profile });
  })
);

gamingProfileRouter.delete("/gaming-profile/banner", requireAuth, asyncHandler(async (req, res) => {
  const userId = req.auth!.sub;
  await ensureGamingProfileStorage();
  await ensureRow(userId);
  await prisma.$executeRawUnsafe(
    `UPDATE "GingaGamingProfile"
        SET banner_blob = NULL, banner_mime = NULL, banner_etag = NULL, banner_url = NULL, updated_at = NOW()
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
  const accentColor = input.accentColor === undefined ? current.accent_color : cleanNullable(input.accentColor);
  const secondaryColor = input.secondaryColor === undefined ? current.secondary_color : cleanNullable(input.secondaryColor);
  const profileTheme = input.profileTheme ?? current.profile_theme;
  const bannerPosition = input.bannerPosition ?? current.banner_position;
  const pronouns = input.pronouns === undefined ? current.pronouns : cleanNullable(input.pronouns);
  const links = input.profileLinks === undefined ? profileLinks(current.profile_links) : input.profileLinks;
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
            accent_color = $6,
            secondary_color = $7,
            profile_theme = $8,
            banner_position = $9,
            pronouns = $10,
            profile_links = $11::jsonb,
            presence_mode = $12,
            auto_away = $13,
            show_game_activity = $14,
            auto_detect_game = $15,
            game_name = $16,
            game_details = $17,
            game_source = $18,
            game_started_at = CASE
              WHEN $19::boolean THEN NULL
              WHEN $20::boolean AND $16::text IS NOT NULL THEN NOW()
              WHEN $16::text IS NULL THEN NULL
              ELSE game_started_at
            END,
            game_last_seen_at = CASE
              WHEN $16::text IS NULL OR $18::text <> 'DESKTOP' THEN NULL
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
    accentColor,
    secondaryColor,
    profileTheme,
    bannerPosition,
    pronouns,
    JSON.stringify(links),
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

export async function publicGamingProfileForViewer(viewerId: string, userId: string) {
  await ensureGamingProfileStorage();
  const [user, row, visible] = await Promise.all([userSummaryById(userId), ensureRow(userId), canObserveUser(viewerId, userId)]);
  return privacyFilteredProfile(user, row, visible);
}

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
