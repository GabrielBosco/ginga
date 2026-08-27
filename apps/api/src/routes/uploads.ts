import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { mkdirSync } from "node:fs";
import { unlink } from "node:fs/promises";
import { extname, join } from "node:path";
import { Router } from "express";
import rateLimit from "express-rate-limit";
import multer from "multer";
import { config } from "../config.js";
import { prisma } from "../db.js";
import { asyncHandler, HttpError } from "../errors.js";
import { assertUploadedFileSignature } from "../fileValidation.js";
import { requireAuth } from "../middleware.js";
import { routeParam, safeFileName } from "../utils.js";

mkdirSync(config.UPLOAD_DIR, { recursive: true, mode: 0o750 });

const allowedExtensionsByMime = new Map<string, Set<string>>([
  ["image/jpeg", new Set([".jpg", ".jpeg"])],
  ["image/png", new Set([".png"])],
  ["image/gif", new Set([".gif"])],
  ["image/webp", new Set([".webp"])],
  ["image/avif", new Set([".avif"])],
  ["video/mp4", new Set([".mp4"])],
  ["video/webm", new Set([".webm"])],
  ["video/quicktime", new Set([".mov"])],
  ["audio/mpeg", new Set([".mp3"])],
  ["audio/ogg", new Set([".ogg", ".oga"])],
  ["audio/wav", new Set([".wav"])],
  ["audio/webm", new Set([".webm"])],
  ["audio/mp4", new Set([".m4a", ".mp4"])],
  ["audio/aac", new Set([".aac"])],
  ["audio/flac", new Set([".flac"])],
  ["application/pdf", new Set([".pdf"])],
  ["application/zip", new Set([".zip"])],
  ["application/x-7z-compressed", new Set([".7z"])],
  ["application/vnd.rar", new Set([".rar"])],
  ["application/x-rar-compressed", new Set([".rar"])],
  ["text/plain", new Set([".txt", ".log", ".md"])],
]);

const storage = multer.diskStorage({
  destination: (_req, _file, callback) => callback(null, config.UPLOAD_DIR),
  filename: (_req, file, callback) => {
    const extension = extname(file.originalname).toLowerCase();
    callback(null, `${randomUUID()}${extension}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: config.maxUploadBytes, files: 1, fields: 4, parts: 5 },
  fileFilter: (_req, file, callback) => {
    const extension = extname(file.originalname).toLowerCase();
    const allowedExtensions = allowedExtensionsByMime.get(file.mimetype);
    if (!allowedExtensions || !allowedExtensions.has(extension)) {
      callback(new HttpError(415, "Tipo ou extensao de arquivo nao permitido"));
      return;
    }
    callback(null, true);
  }
});

const uploadLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: config.UPLOAD_RATE_LIMIT_HOUR,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Limite de uploads atingido. Tente novamente mais tarde." }
});

export const uploadsRouter = Router();

uploadsRouter.post("/api/uploads", requireAuth, uploadLimiter, upload.single("file"), asyncHandler(async (req, res) => {
  if (!req.file) throw new HttpError(400, "Nenhum arquivo enviado");

  try {
    await assertUploadedFileSignature(join(config.UPLOAD_DIR, req.file.filename), req.file.mimetype);

    const usage = await prisma.attachment.aggregate({
      where: { uploaderId: req.auth!.sub },
      _sum: { size: true }
    });
    if ((usage._sum.size ?? 0) + req.file.size > config.maxUserStorageBytes) {
      throw new HttpError(413, "Sua cota de armazenamento foi atingida");
    }

    const accessKey = randomBytes(32).toString("base64url");
    const url = `/uploads/${req.file.filename}?key=${accessKey}`;
    const attachment = await prisma.attachment.create({
      data: {
        uploaderId: req.auth!.sub,
        originalName: safeFileName(req.file.originalname),
        storedName: req.file.filename,
        accessKey,
        mimeType: req.file.mimetype,
        size: req.file.size,
        url
      }
    });

    res.status(201).json({ attachment });
  } catch (error) {
    await unlink(join(config.UPLOAD_DIR, req.file.filename)).catch(() => undefined);
    throw error;
  }
}));

uploadsRouter.delete("/api/uploads/:attachmentId", requireAuth, asyncHandler(async (req, res) => {
  const attachmentId = routeParam(req.params.attachmentId, "attachmentId");
  const attachment = await prisma.attachment.findFirst({
    where: {
      id: attachmentId,
      uploaderId: req.auth!.sub,
      messageId: null,
      directMessageId: null
    }
  });

  if (!attachment) throw new HttpError(404, "Anexo pendente nao encontrado");

  await prisma.attachment.delete({ where: { id: attachment.id } });
  await unlink(join(config.UPLOAD_DIR, attachment.storedName)).catch(() => undefined);
  res.status(204).end();
}));

uploadsRouter.get("/uploads/:storedName", asyncHandler(async (req, res) => {
  const storedName = routeParam(req.params.storedName, "storedName");
  if (!/^[0-9a-f-]{36}\.[a-z0-9]{1,8}$/i.test(storedName)) throw new HttpError(404, "Arquivo nao encontrado");

  const key = typeof req.query.key === "string" ? req.query.key : "";
  const attachment = await prisma.attachment.findUnique({ where: { storedName } });
  const providedKey = Buffer.from(key);
  const expectedKey = Buffer.from(attachment?.accessKey ?? "");
  const validKey = Boolean(attachment && key.length >= 32 && providedKey.length === expectedKey.length && timingSafeEqual(providedKey, expectedKey));
  if (!validKey || !attachment) {
    throw new HttpError(404, "Arquivo nao encontrado");
  }

  const inline = /^(image|video|audio)\//.test(attachment.mimeType) || attachment.mimeType === "application/pdf";
  const encodedName = encodeURIComponent(attachment.originalName);

  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Cache-Control", "private, max-age=900, no-transform");
  res.setHeader("Content-Security-Policy", "default-src 'none'; sandbox");
  res.setHeader("Content-Disposition", `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodedName}`);
  res.type(attachment.mimeType);
  res.sendFile(attachment.storedName, { root: config.UPLOAD_DIR, dotfiles: "deny", acceptRanges: true });
}));
