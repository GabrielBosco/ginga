import { readdir, stat, unlink } from "node:fs/promises";
import { join } from "node:path";
import { config } from "./config.js";
import { prisma } from "./db.js";

const PENDING_UPLOAD_TTL_MS = 24 * 60 * 60 * 1000;
const CLEANUP_INTERVAL_MS = 6 * 60 * 60 * 1000;

const ORPHAN_GRACE_MS = 60 * 60 * 1000;

async function cleanupOrphanFiles() {
  const [entries, attachments] = await Promise.all([
    readdir(config.UPLOAD_DIR, { withFileTypes: true }).catch(() => []),
    prisma.attachment.findMany({ select: { storedName: true } })
  ]);
  const referenced = new Set(attachments.map((item) => item.storedName));
  let removed = 0;
  for (const entry of entries) {
    if (!entry.isFile() || referenced.has(entry.name)) continue;
    const fullPath = join(config.UPLOAD_DIR, entry.name);
    const info = await stat(fullPath).catch(() => null);
    if (!info || Date.now() - info.mtimeMs < ORPHAN_GRACE_MS) continue;
    await unlink(fullPath).then(() => { removed += 1; }).catch(() => undefined);
  }
  if (removed > 0) console.log(`Limpeza de uploads: ${removed} arquivo(s) orfao(s) removido(s).`);
}

async function cleanupStaleUploads() {
  const stale = await prisma.attachment.findMany({
    where: {
      messageId: null,
      directMessageId: null,
      createdAt: { lt: new Date(Date.now() - PENDING_UPLOAD_TTL_MS) }
    },
    select: { id: true, storedName: true }
  });

  if (stale.length === 0) return;

  let removed = 0;
  for (const attachment of stale) {
    const result = await prisma.attachment.deleteMany({
      where: { id: attachment.id, messageId: null, directMessageId: null }
    });
    if (result.count !== 1) continue;
    removed += 1;
    await unlink(join(config.UPLOAD_DIR, attachment.storedName)).catch(() => undefined);
  }

  if (removed > 0) {
    console.log(`Limpeza de uploads: ${removed} anexo(s) pendente(s) removido(s).`);
  }
}

export function scheduleStaleUploadCleanup() {
  void cleanupStaleUploads().catch((error) => console.error("Falha na limpeza inicial de uploads", error));
  void cleanupOrphanFiles().catch((error) => console.error("Falha na limpeza inicial de arquivos orfaos", error));
  const timer = setInterval(() => {
    void cleanupStaleUploads().catch((error) => console.error("Falha na limpeza periodica de uploads", error));
    void cleanupOrphanFiles().catch((error) => console.error("Falha na limpeza periodica de arquivos orfaos", error));
  }, CLEANUP_INTERVAL_MS);
  timer.unref();
}
