import { createHash } from "node:crypto";
import { prisma } from "./db.js";

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
  updated_at?: Date | string;
};

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
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await prisma.$executeRawUnsafe(`ALTER TABLE "GingaGuildAppearance" ADD COLUMN IF NOT EXISTS banner_url TEXT`);
  await prisma.$executeRawUnsafe(`ALTER TABLE "GingaGuildAppearance" ADD COLUMN IF NOT EXISTS banner_blob BYTEA`);
  await prisma.$executeRawUnsafe(`ALTER TABLE "GingaGuildAppearance" ADD COLUMN IF NOT EXISTS banner_mime VARCHAR(40)`);
  await prisma.$executeRawUnsafe(`ALTER TABLE "GingaGuildAppearance" ADD COLUMN IF NOT EXISTS banner_etag VARCHAR(64)`);
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

export async function saveGuildIcon(guildId: string, body: Buffer) {
  await ensureGuildAppearanceStorage();
  const etag = createHash("sha256").update(body).digest("hex").slice(0, 32);
  const iconUrl = `/api/guilds/${encodeURIComponent(guildId)}/icon/${etag}.webp`;
  await prisma.$executeRawUnsafe(
    `INSERT INTO "GingaGuildAppearance" (guild_id, icon_url, icon_blob, icon_mime, icon_etag, updated_at)
     VALUES ($1,$2,$3,'image/webp',$4,NOW())
     ON CONFLICT (guild_id) DO UPDATE SET icon_url=$2, icon_blob=$3, icon_mime='image/webp', icon_etag=$4, updated_at=NOW()`,
    guildId,
    iconUrl,
    body,
    etag
  );
  return { iconUrl, etag };
}

export async function removeGuildIcon(guildId: string) {
  await ensureGuildAppearanceStorage();
  await prisma.$executeRawUnsafe(`UPDATE "GingaGuildAppearance" SET icon_url=NULL, icon_blob=NULL, icon_mime=NULL, icon_etag=NULL, updated_at=NOW() WHERE guild_id=$1`, guildId);
}

export async function guildBannerUrlMap(guildIds:string[]){await ensureGuildAppearanceStorage();if(!guildIds.length)return new Map<string,string>();const placeholders=guildIds.map((_,i)=>`$${i+1}`).join(",");const rows=await prisma.$queryRawUnsafe<GuildAppearanceRow[]>(`SELECT guild_id,banner_url FROM "GingaGuildAppearance" WHERE guild_id IN (${placeholders})`,...guildIds);return new Map(rows.filter(r=>r.banner_url).map(r=>[r.guild_id,r.banner_url as string]));}
export async function guildBannerUrl(guildId:string){await ensureGuildAppearanceStorage();const rows=await prisma.$queryRawUnsafe<GuildAppearanceRow[]>(`SELECT guild_id,banner_url FROM "GingaGuildAppearance" WHERE guild_id=$1 LIMIT 1`,guildId);return rows[0]?.banner_url??null;}
export async function guildBannerBlob(guildId:string,etag:string){await ensureGuildAppearanceStorage();const rows=await prisma.$queryRawUnsafe<GuildAppearanceRow[]>(`SELECT guild_id,banner_blob,banner_mime,banner_etag,banner_url FROM "GingaGuildAppearance" WHERE guild_id=$1 LIMIT 1`,guildId);const row=rows[0];return row?.banner_blob&&row.banner_etag===etag?row:null;}
export async function saveGuildBanner(guildId:string,body:Buffer){await ensureGuildAppearanceStorage();const etag=createHash("sha256").update(body).digest("hex").slice(0,32);const bannerUrl=`/api/guilds/${encodeURIComponent(guildId)}/banner/${etag}.webp`;await prisma.$executeRawUnsafe(`INSERT INTO "GingaGuildAppearance" (guild_id,banner_url,banner_blob,banner_mime,banner_etag,updated_at) VALUES ($1,$2,$3,'image/webp',$4,NOW()) ON CONFLICT (guild_id) DO UPDATE SET banner_url=$2,banner_blob=$3,banner_mime='image/webp',banner_etag=$4,updated_at=NOW()`,guildId,bannerUrl,body,etag);return{bannerUrl,etag};}
export async function removeGuildBanner(guildId:string){await ensureGuildAppearanceStorage();await prisma.$executeRawUnsafe(`UPDATE "GingaGuildAppearance" SET banner_url=NULL,banner_blob=NULL,banner_mime=NULL,banner_etag=NULL,updated_at=NOW() WHERE guild_id=$1`,guildId);}
