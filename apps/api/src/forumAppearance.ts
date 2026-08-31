import { createHash } from "node:crypto";
import { prisma } from "./db.js";

export type ForumAppearance = {
  iconUrl: string | null;
  bannerUrl: string | null;
};

type ForumAppearanceRow = {
  channel_id: string;
  icon_url?: string | null;
  icon_blob?: Uint8Array | null;
  icon_mime?: string | null;
  icon_etag?: string | null;
  banner_url?: string | null;
  banner_blob?: Uint8Array | null;
  banner_mime?: string | null;
  banner_etag?: string | null;
};

let storagePromise: Promise<void> | null = null;

async function initialize() {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "GingaForumAppearance" (
      channel_id TEXT PRIMARY KEY,
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
  const migrations = [
    `ALTER TABLE "GingaForumAppearance" ADD COLUMN IF NOT EXISTS icon_url TEXT`,
    `ALTER TABLE "GingaForumAppearance" ADD COLUMN IF NOT EXISTS icon_blob BYTEA`,
    `ALTER TABLE "GingaForumAppearance" ADD COLUMN IF NOT EXISTS icon_mime VARCHAR(40)`,
    `ALTER TABLE "GingaForumAppearance" ADD COLUMN IF NOT EXISTS icon_etag VARCHAR(64)`,
    `ALTER TABLE "GingaForumAppearance" ADD COLUMN IF NOT EXISTS banner_url TEXT`,
    `ALTER TABLE "GingaForumAppearance" ADD COLUMN IF NOT EXISTS banner_blob BYTEA`,
    `ALTER TABLE "GingaForumAppearance" ADD COLUMN IF NOT EXISTS banner_mime VARCHAR(40)`,
    `ALTER TABLE "GingaForumAppearance" ADD COLUMN IF NOT EXISTS banner_etag VARCHAR(64)`,
    `ALTER TABLE "GingaForumAppearance" ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW()`
  ];
  for (const statement of migrations) await prisma.$executeRawUnsafe(statement);
}

export async function ensureForumAppearanceStorage() {
  if (!storagePromise) {
    storagePromise = initialize().catch((error) => {
      storagePromise = null;
      throw error;
    });
  }
  await storagePromise;
}

export async function forumAppearance(channelId: string): Promise<ForumAppearance> {
  await ensureForumAppearanceStorage();
  const rows = await prisma.$queryRawUnsafe<ForumAppearanceRow[]>(
    `SELECT channel_id,icon_url,banner_url FROM "GingaForumAppearance" WHERE channel_id=$1 LIMIT 1`,
    channelId
  );
  return { iconUrl: rows[0]?.icon_url ?? null, bannerUrl: rows[0]?.banner_url ?? null };
}

function extensionForMime(mime: string) {
  if (mime === "image/gif") return "gif";
  if (mime === "image/png") return "png";
  if (mime === "image/jpeg") return "jpg";
  return "webp";
}

export function validForumImage(mime: string, body: Buffer) {
  if (!Buffer.isBuffer(body) || body.length < 16) return false;
  if (mime === "image/gif") return ["GIF87a", "GIF89a"].includes(body.subarray(0, 6).toString("ascii"));
  if (mime === "image/png") return body.subarray(0, 8).equals(Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]));
  if (mime === "image/jpeg") return body[0] === 0xff && body[1] === 0xd8 && body[2] === 0xff;
  if (mime === "image/webp") return body.subarray(0, 4).toString("ascii") === "RIFF" && body.subarray(8, 12).toString("ascii") === "WEBP";
  return false;
}

export async function saveForumAsset(channelId: string, kind: "icon" | "banner", body: Buffer, mime: string) {
  await ensureForumAppearanceStorage();
  const etag = createHash("sha256").update(body).digest("hex").slice(0, 32);
  const extension = extensionForMime(mime);
  const url = `/api/channels/${encodeURIComponent(channelId)}/forum/${kind}/${etag}.${extension}`;
  const prefix = kind === "icon" ? "icon" : "banner";
  await prisma.$executeRawUnsafe(
    `INSERT INTO "GingaForumAppearance" (channel_id,${prefix}_url,${prefix}_blob,${prefix}_mime,${prefix}_etag,updated_at)
     VALUES ($1,$2,$3,$4,$5,NOW())
     ON CONFLICT (channel_id) DO UPDATE SET ${prefix}_url=$2,${prefix}_blob=$3,${prefix}_mime=$4,${prefix}_etag=$5,updated_at=NOW()`,
    channelId,
    url,
    body,
    mime,
    etag
  );
  return { url, etag, mime };
}

export async function removeForumAsset(channelId: string, kind: "icon" | "banner") {
  await ensureForumAppearanceStorage();
  const prefix = kind === "icon" ? "icon" : "banner";
  await prisma.$executeRawUnsafe(
    `UPDATE "GingaForumAppearance" SET ${prefix}_url=NULL,${prefix}_blob=NULL,${prefix}_mime=NULL,${prefix}_etag=NULL,updated_at=NOW() WHERE channel_id=$1`,
    channelId
  );
}

export async function forumAssetBlob(channelId: string, kind: "icon" | "banner", etag: string) {
  await ensureForumAppearanceStorage();
  const prefix = kind === "icon" ? "icon" : "banner";
  const rows = await prisma.$queryRawUnsafe<ForumAppearanceRow[]>(
    `SELECT channel_id,${prefix}_blob,${prefix}_mime,${prefix}_etag FROM "GingaForumAppearance" WHERE channel_id=$1 LIMIT 1`,
    channelId
  );
  const row = rows[0];
  const rowEtag = kind === "icon" ? row?.icon_etag : row?.banner_etag;
  const blob = kind === "icon" ? row?.icon_blob : row?.banner_blob;
  const mime = kind === "icon" ? row?.icon_mime : row?.banner_mime;
  if (!blob || rowEtag !== etag) return null;
  return { blob, mime: mime || "application/octet-stream" };
}
