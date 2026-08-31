import { createHash } from "node:crypto";
import { prisma } from "./db.js";

export type GuildSidebarStyle = "SOLID" | "TINTED" | "GLASS";
export type GuildChannelDensity = "COMPACT" | "COZY";

export type GuildImageMime = "image/webp" | "image/gif";

function extensionForImageMime(mime: GuildImageMime) {
  return mime === "image/gif" ? "gif" : "webp";
}

export interface PublicGuildAppearance {
  accentColor: string;
  secondaryColor: string;
  sidebarStyle: GuildSidebarStyle;
  bannerPosition: number;
  channelDensity: GuildChannelDensity;
  showBannerInSidebar: boolean;
}

export type GuildAppearanceRow = {
  guild_id: string;
  icon_url: string | null;
  icon_blob?: Uint8Array | null;
  icon_mime?: string | null;
  icon_etag?: string | null;
  banner_url?: string | null;
  banner_blob?: Uint8Array | null;
  banner_mime?: string | null;
  banner_etag?: string | null;
  accent_color?: string | null;
  secondary_color?: string | null;
  sidebar_style?: GuildSidebarStyle | null;
  banner_position?: number | null;
  channel_density?: GuildChannelDensity | null;
  show_banner_sidebar?: boolean | null;
  updated_at?: Date | string;
};

export const DEFAULT_GUILD_APPEARANCE: PublicGuildAppearance = Object.freeze({
  accentColor: "#7c3cff",
  secondaryColor: "#2c74ff",
  sidebarStyle: "TINTED",
  bannerPosition: 50,
  channelDensity: "COZY",
  showBannerInSidebar: true
});

let storagePromise: Promise<void> | null = null;

async function initialize() {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "GingaGuildAppearance" (
      guild_id TEXT PRIMARY KEY,
      icon_url TEXT NULL,
      icon_blob BYTEA NULL,
      icon_mime VARCHAR(40) NULL,
      icon_etag VARCHAR(64) NULL,
      banner_url TEXT NULL,
      banner_blob BYTEA NULL,
      banner_mime VARCHAR(40) NULL,
      banner_etag VARCHAR(64) NULL,
      accent_color VARCHAR(7) NULL,
      secondary_color VARCHAR(7) NULL,
      sidebar_style VARCHAR(16) NOT NULL DEFAULT 'TINTED',
      banner_position INTEGER NOT NULL DEFAULT 50,
      channel_density VARCHAR(16) NOT NULL DEFAULT 'COZY',
      show_banner_sidebar BOOLEAN NOT NULL DEFAULT TRUE,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  const migrations = [
    `ALTER TABLE "GingaGuildAppearance" ADD COLUMN IF NOT EXISTS icon_url TEXT`,
    `ALTER TABLE "GingaGuildAppearance" ADD COLUMN IF NOT EXISTS icon_blob BYTEA`,
    `ALTER TABLE "GingaGuildAppearance" ADD COLUMN IF NOT EXISTS icon_mime VARCHAR(40)`,
    `ALTER TABLE "GingaGuildAppearance" ADD COLUMN IF NOT EXISTS icon_etag VARCHAR(64)`,
    `ALTER TABLE "GingaGuildAppearance" ADD COLUMN IF NOT EXISTS banner_url TEXT`,
    `ALTER TABLE "GingaGuildAppearance" ADD COLUMN IF NOT EXISTS banner_blob BYTEA`,
    `ALTER TABLE "GingaGuildAppearance" ADD COLUMN IF NOT EXISTS banner_mime VARCHAR(40)`,
    `ALTER TABLE "GingaGuildAppearance" ADD COLUMN IF NOT EXISTS banner_etag VARCHAR(64)`,
    `ALTER TABLE "GingaGuildAppearance" ADD COLUMN IF NOT EXISTS accent_color VARCHAR(7)`,
    `ALTER TABLE "GingaGuildAppearance" ADD COLUMN IF NOT EXISTS secondary_color VARCHAR(7)`,
    `ALTER TABLE "GingaGuildAppearance" ADD COLUMN IF NOT EXISTS sidebar_style VARCHAR(16) DEFAULT 'TINTED'`,
    `ALTER TABLE "GingaGuildAppearance" ADD COLUMN IF NOT EXISTS banner_position INTEGER DEFAULT 50`,
    `ALTER TABLE "GingaGuildAppearance" ADD COLUMN IF NOT EXISTS channel_density VARCHAR(16) DEFAULT 'COZY'`,
    `ALTER TABLE "GingaGuildAppearance" ADD COLUMN IF NOT EXISTS show_banner_sidebar BOOLEAN DEFAULT TRUE`,
    `ALTER TABLE "GingaGuildAppearance" ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW()`
  ];
  for (const statement of migrations) await prisma.$executeRawUnsafe(statement);

  await prisma.$executeRawUnsafe(`UPDATE "GingaGuildAppearance" SET sidebar_style='TINTED' WHERE sidebar_style IS NULL OR sidebar_style NOT IN ('SOLID','TINTED','GLASS')`);
  await prisma.$executeRawUnsafe(`UPDATE "GingaGuildAppearance" SET channel_density='COZY' WHERE channel_density IS NULL OR channel_density NOT IN ('COMPACT','COZY')`);
  await prisma.$executeRawUnsafe(`UPDATE "GingaGuildAppearance" SET banner_position=50 WHERE banner_position IS NULL OR banner_position < 0 OR banner_position > 100`);
  await prisma.$executeRawUnsafe(`UPDATE "GingaGuildAppearance" SET show_banner_sidebar=TRUE WHERE show_banner_sidebar IS NULL`);
  await prisma.$executeRawUnsafe(`UPDATE "GingaGuildAppearance" SET updated_at=NOW() WHERE updated_at IS NULL`);
}

export async function ensureGuildAppearanceStorage() {
  if (!storagePromise) {
    storagePromise = initialize().catch((error) => {
      storagePromise = null;
      throw error;
    });
  }
  await storagePromise;
}

function publicAppearance(row: GuildAppearanceRow | undefined, fallbackAccent = DEFAULT_GUILD_APPEARANCE.accentColor): PublicGuildAppearance {
  return {
    accentColor: row?.accent_color || fallbackAccent,
    secondaryColor: row?.secondary_color || DEFAULT_GUILD_APPEARANCE.secondaryColor,
    sidebarStyle: row?.sidebar_style === "SOLID" || row?.sidebar_style === "GLASS" ? row.sidebar_style : "TINTED",
    bannerPosition: Math.max(0, Math.min(100, Number(row?.banner_position ?? 50))),
    channelDensity: row?.channel_density === "COMPACT" ? "COMPACT" : "COZY",
    showBannerInSidebar: row?.show_banner_sidebar !== false
  };
}

export async function guildAppearanceMap(guildIds: string[], fallbackAccentByGuild: ReadonlyMap<string, string> = new Map()) {
  await ensureGuildAppearanceStorage();
  if (!guildIds.length) return new Map<string, PublicGuildAppearance>();
  const placeholders = guildIds.map((_, index) => `$${index + 1}`).join(",");
  const rows = await prisma.$queryRawUnsafe<GuildAppearanceRow[]>(
    `SELECT guild_id,accent_color,secondary_color,sidebar_style,banner_position,channel_density,show_banner_sidebar FROM "GingaGuildAppearance" WHERE guild_id IN (${placeholders})`,
    ...guildIds
  );
  return new Map(rows.map((row) => [row.guild_id, publicAppearance(row, fallbackAccentByGuild.get(row.guild_id) || DEFAULT_GUILD_APPEARANCE.accentColor)]));
}

export async function guildAppearance(guildId: string, fallbackAccent?: string) {
  await ensureGuildAppearanceStorage();
  const rows = await prisma.$queryRawUnsafe<GuildAppearanceRow[]>(
    `SELECT guild_id,accent_color,secondary_color,sidebar_style,banner_position,channel_density,show_banner_sidebar FROM "GingaGuildAppearance" WHERE guild_id=$1 LIMIT 1`,
    guildId
  );
  return publicAppearance(rows[0], fallbackAccent ?? DEFAULT_GUILD_APPEARANCE.accentColor);
}

export async function saveGuildAppearance(guildId: string, appearance: PublicGuildAppearance) {
  await ensureGuildAppearanceStorage();
  await prisma.$executeRawUnsafe(
    `INSERT INTO "GingaGuildAppearance" (guild_id,accent_color,secondary_color,sidebar_style,banner_position,channel_density,show_banner_sidebar,updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,NOW())
     ON CONFLICT (guild_id) DO UPDATE SET
       accent_color=$2,
       secondary_color=$3,
       sidebar_style=$4,
       banner_position=$5,
       channel_density=$6,
       show_banner_sidebar=$7,
       updated_at=NOW()`,
    guildId,
    appearance.accentColor,
    appearance.secondaryColor,
    appearance.sidebarStyle,
    appearance.bannerPosition,
    appearance.channelDensity,
    appearance.showBannerInSidebar
  );
  return appearance;
}

export async function guildIconUrlMap(guildIds: string[]) {
  await ensureGuildAppearanceStorage();
  if (!guildIds.length) return new Map<string, string>();
  const placeholders = guildIds.map((_, index) => `$${index + 1}`).join(",");
  const rows = await prisma.$queryRawUnsafe<GuildAppearanceRow[]>(
    `SELECT guild_id, icon_url FROM "GingaGuildAppearance" WHERE guild_id IN (${placeholders})`,
    ...guildIds
  );
  return new Map(rows.filter((row) => row.icon_url).map((row) => [row.guild_id, row.icon_url as string]));
}

export async function guildIconUrl(guildId: string) {
  await ensureGuildAppearanceStorage();
  const rows = await prisma.$queryRawUnsafe<GuildAppearanceRow[]>(
    `SELECT guild_id, icon_url FROM "GingaGuildAppearance" WHERE guild_id = $1 LIMIT 1`,
    guildId
  );
  return rows[0]?.icon_url ?? null;
}

export async function guildIconBlob(guildId: string, etag: string) {
  await ensureGuildAppearanceStorage();
  const rows = await prisma.$queryRawUnsafe<GuildAppearanceRow[]>(
    `SELECT guild_id, icon_blob, icon_mime, icon_etag, icon_url FROM "GingaGuildAppearance" WHERE guild_id = $1 LIMIT 1`,
    guildId
  );
  const row = rows[0];
  if (!row?.icon_blob || !row.icon_etag || row.icon_etag !== etag) return null;
  return row;
}

export async function saveGuildIcon(guildId: string, body: Buffer, mime: GuildImageMime = "image/webp") {
  await ensureGuildAppearanceStorage();
  const etag = createHash("sha256").update(body).digest("hex").slice(0, 32);
  const iconUrl = `/api/guilds/${encodeURIComponent(guildId)}/icon/${etag}.${extensionForImageMime(mime)}`;
  await prisma.$executeRawUnsafe(
    `INSERT INTO "GingaGuildAppearance" (guild_id, icon_url, icon_blob, icon_mime, icon_etag, updated_at)
     VALUES ($1,$2,$3,$4,$5,NOW())
     ON CONFLICT (guild_id) DO UPDATE SET icon_url=$2, icon_blob=$3, icon_mime=$4, icon_etag=$5, updated_at=NOW()`,
    guildId,
    iconUrl,
    body,
    mime,
    etag
  );
  return { iconUrl, etag };
}

export async function removeGuildIcon(guildId: string) {
  await ensureGuildAppearanceStorage();
  await prisma.$executeRawUnsafe(`UPDATE "GingaGuildAppearance" SET icon_url=NULL, icon_blob=NULL, icon_mime=NULL, icon_etag=NULL, updated_at=NOW() WHERE guild_id=$1`, guildId);
}

export async function guildBannerUrlMap(guildIds: string[]) {
  await ensureGuildAppearanceStorage();
  if (!guildIds.length) return new Map<string, string>();
  const placeholders = guildIds.map((_, index) => `$${index + 1}`).join(",");
  const rows = await prisma.$queryRawUnsafe<GuildAppearanceRow[]>(
    `SELECT guild_id,banner_url FROM "GingaGuildAppearance" WHERE guild_id IN (${placeholders})`,
    ...guildIds
  );
  return new Map(rows.filter((row) => row.banner_url).map((row) => [row.guild_id, row.banner_url as string]));
}

export async function guildBannerUrl(guildId: string) {
  await ensureGuildAppearanceStorage();
  const rows = await prisma.$queryRawUnsafe<GuildAppearanceRow[]>(
    `SELECT guild_id,banner_url FROM "GingaGuildAppearance" WHERE guild_id=$1 LIMIT 1`,
    guildId
  );
  return rows[0]?.banner_url ?? null;
}

export async function guildBannerBlob(guildId: string, etag: string) {
  await ensureGuildAppearanceStorage();
  const rows = await prisma.$queryRawUnsafe<GuildAppearanceRow[]>(
    `SELECT guild_id,banner_blob,banner_mime,banner_etag,banner_url FROM "GingaGuildAppearance" WHERE guild_id=$1 LIMIT 1`,
    guildId
  );
  const row = rows[0];
  return row?.banner_blob && row.banner_etag === etag ? row : null;
}

export async function saveGuildBanner(guildId: string, body: Buffer, mime: GuildImageMime = "image/webp") {
  await ensureGuildAppearanceStorage();
  const etag = createHash("sha256").update(body).digest("hex").slice(0, 32);
  const bannerUrl = `/api/guilds/${encodeURIComponent(guildId)}/banner/${etag}.${extensionForImageMime(mime)}`;
  await prisma.$executeRawUnsafe(
    `INSERT INTO "GingaGuildAppearance" (guild_id,banner_url,banner_blob,banner_mime,banner_etag,updated_at)
     VALUES ($1,$2,$3,$4,$5,NOW())
     ON CONFLICT (guild_id) DO UPDATE SET banner_url=$2,banner_blob=$3,banner_mime=$4,banner_etag=$5,updated_at=NOW()`,
    guildId,
    bannerUrl,
    body,
    mime,
    etag
  );
  return { bannerUrl, etag };
}

export async function removeGuildBanner(guildId: string) {
  await ensureGuildAppearanceStorage();
  await prisma.$executeRawUnsafe(`UPDATE "GingaGuildAppearance" SET banner_url=NULL,banner_blob=NULL,banner_mime=NULL,banner_etag=NULL,updated_at=NOW() WHERE guild_id=$1`, guildId);
}
