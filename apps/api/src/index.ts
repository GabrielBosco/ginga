import { randomUUID } from "node:crypto";
import { ensureAuthSessionStorage } from "./authSessions.js";
import { ensureTwoFactorStorage } from "./twoFactor.js";
import { createServer } from "node:http";
import cors from "cors";
import express from "express";
import rateLimit from "express-rate-limit";
import helmet from "helmet";
import { scheduleStaleUploadCleanup } from "./cleanup.js";
import { config } from "./config.js";
import { prisma } from "./db.js";
import { errorHandler, HttpError, notFoundHandler } from "./errors.js";
import { requireAuth } from "./middleware.js";
import { authRouter } from "./routes/auth.js";
import { registrationVerificationRouter } from "./routes/registrationVerification.js";
import { channelsRouter } from "./routes/channels.js";
import { guildsRouter } from "./routes/guilds.js";
import { communityRouter } from "./routes/community.js";
import { developerRouter, botApiRouter, webhookIngressRouter } from "./routes/developer.js";
import { messagesRouter } from "./routes/messages.js";
import { platformRouter } from "./routes/platform.js";
import { rolesRouter } from "./routes/roles.js";
import { livekitRouter } from "./routes/livekit.js";
import { socialRouter, ensureSocialSafetyStorage } from "./routes/social.js";
import { directCallsRouter, ensureDirectCallStorage, scheduleDirectCallMaintenance } from "./routes/directCalls.js";
import { gamingProfileRouter, ensureGamingProfileStorage } from "./routes/gamingProfile.js";
import { uploadsRouter } from "./routes/uploads.js";
import { v090Router } from "./routes/v090.js";
import { musicRouter } from "./routes/music.js";
import { setupSocket } from "./socket.js";
import { scheduleBackgroundJobs } from "./scheduler.js";
import { applySecurityPolicyMigrations } from "./security.js";
import { ensureInitialDatabaseSchema } from "./schemaBootstrap.js";
import { GINGA_VERSION } from "./version.js";
import { requirePlatformAdmin } from "./platformAccess.js";
import { ensureV090Storage, expireCustomStatuses } from "./v090Storage.js";

const app = express();
app.disable("x-powered-by");
app.set("trust proxy", "loopback, linklocal, uniquelocal");

app.use((req, res, next) => {
  const incomingRequestId = req.header("x-request-id")?.trim() ?? "";
  const requestId = /^[A-Za-z0-9._:-]{1,80}$/.test(incomingRequestId) ? incomingRequestId : randomUUID();
  res.setHeader("X-Request-Id", requestId);
  res.setHeader("Cache-Control", req.path === "/api/health" ? "no-store" : "private, no-store");
  next();
});

app.use(helmet({
  crossOriginResourcePolicy: { policy: "cross-origin" },
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'none'"],
      frameAncestors: ["'none'"],
      baseUri: ["'none'"],
      formAction: ["'none'"]
    }
  },
  strictTransportSecurity: false
}));

function normalizeOrigin(value: string) {
  const trimmed = value.trim();
  try {
    return new URL(trimmed).origin.toLowerCase();
  } catch {
    return trimmed.replace(/\/+$/, "").toLowerCase();
  }
}

const allowedAppOrigins = new Set(config.appOrigins.map(normalizeOrigin));

app.use(cors({
  origin(origin, callback) {
    if (!origin) return callback(null, true);
    const normalizedOrigin = normalizeOrigin(origin);
    if (allowedAppOrigins.has(normalizedOrigin)) return callback(null, true);
    console.warn(`[CORS] origem recusada: ${JSON.stringify(origin)} | normalizada: ${JSON.stringify(normalizedOrigin)} | permitidas: ${JSON.stringify([...allowedAppOrigins])}`);
    return callback(new HttpError(403, "Origem nao permitida"));
  },
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "X-Request-Id", "X-Ginga-Webhook-Token"],
  exposedHeaders: ["X-Request-Id", "RateLimit", "RateLimit-Policy"],
  maxAge: 600
}));

const apiLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  limit: config.API_RATE_LIMIT_5M,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  skip: (req) => req.path === "/api/health",
  message: { error: "Muitas requisicoes. Aguarde um pouco e tente novamente." }
});
app.use(apiLimiter);

app.use(express.json({ limit: "512kb", strict: true }));
app.use(express.urlencoded({ extended: false, limit: "128kb" }));

app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", service: "ginga-api", version: GINGA_VERSION });
});

app.get("/api/system/network", requireAuth, async (req, res) => {
  await requirePlatformAdmin(req.auth!.sub);
  const isLoopbackOrigin = (origin: string) => /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin);
  const insecureAppOrigins = config.appOrigins.filter((origin) => origin.startsWith("http://") && !isLoopbackOrigin(origin));
  const livekitLocal = /^ws:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(config.PUBLIC_LIVEKIT_URL);
  const livekitSecure = config.PUBLIC_LIVEKIT_URL.startsWith("wss://") || livekitLocal;
  const secureTransport = insecureAppOrigins.length === 0 && livekitSecure;

  res.json({
    appOrigins: config.appOrigins,
    livekitUrl: config.PUBLIC_LIVEKIT_URL,
    insecureAppOrigins,
    secureTransport,
    livekitSecure,
    registrationOpen: config.allowRegistration,
    emailVerificationRequired: config.emailVerificationRequired,
    legacyWebhookTokensEnabled: config.allowLegacyWebhookUrlTokens,
    version: GINGA_VERSION
  });
});

app.use("/api/auth", registrationVerificationRouter);
app.use("/api/auth", authRouter);
app.use("/api", guildsRouter);
app.use("/api", channelsRouter);
app.use("/api", livekitRouter);
app.use("/api", musicRouter);
app.use("/api", socialRouter);
app.use("/api", directCallsRouter);
app.use("/api", gamingProfileRouter);
app.use("/api", platformRouter);
app.use("/api", developerRouter);
app.use("/api", botApiRouter);
app.use("/api", rolesRouter);
app.use("/api", messagesRouter);
app.use("/api", communityRouter);
app.use("/api", v090Router);
app.use(webhookIngressRouter);
app.use(uploadsRouter);

app.use(notFoundHandler);
app.use(errorHandler);

const server = createServer(app);
server.requestTimeout = 30_000;
server.headersTimeout = 35_000;
server.keepAliveTimeout = 5_000;

const io = setupSocket(server);
app.set("io", io);

const RELEASE_VERSION = GINGA_VERSION;

async function ensureReleaseAnnouncement() {
  if (process.env.AUTO_PUBLISH_RELEASE_NEWS === "false") return;

  const title = `Ginga ${RELEASE_VERSION} - Atualizacao disponivel`;
  const existing = await prisma.platformAnnouncement.findFirst({ where: { title } });
  if (existing) return;

  let author = await prisma.user.findFirst({
    where: { accountType: "HUMAN", platformOwner: true },
    orderBy: { createdAt: "asc" },
    select: { id: true }
  });
  if (!author) author = await prisma.user.findFirst({
    where: { accountType: "HUMAN", systemRole: "PLATFORM_ADMIN" },
    orderBy: { createdAt: "asc" },
    select: { id: true }
  });
  if (!author) {
    console.warn("Ginga News: nenhum administrador disponivel para publicar o release automaticamente");
    return;
  }

  const configuredNotes = process.env.GINGA_RELEASE_NOTES?.trim();
  const defaultNotes = `A versao ${RELEASE_VERSION} do Ginga foi publicada. Abra Novidades do Ginga para ver os destaques deste release e reinicie o Desktop quando a atualizacao estiver pronta.`;
  const body = (configuredNotes || defaultNotes).slice(0, 8000);
  const announcement = await prisma.platformAnnouncement.create({
    data: { title, body, severity: "UPDATE", published: true, createdById: author.id },
    include: { createdBy: { select: { id: true, username: true, displayName: true, avatarColor: true, systemRole: true, platformOwner: true, accountType: true } } }
  });
  await prisma.platformAuditLog.create({
    data: { actorId: author.id, action: "RELEASE_ANNOUNCEMENT_AUTO", targetType: "ANNOUNCEMENT", targetId: announcement.id, metadata: { version: RELEASE_VERSION, automatic: true } }
  });
  io.emit("platform:announcement", announcement);
}

async function bootstrap() {
  await ensureInitialDatabaseSchema();
  await ensureAuthSessionStorage();
  await ensureTwoFactorStorage();
  await applySecurityPolicyMigrations();
  scheduleStaleUploadCleanup();
  await ensureDirectCallStorage();
  await ensureGamingProfileStorage();
  await ensureSocialSafetyStorage();
  await ensureV090Storage();
  setInterval(() => { void expireCustomStatuses().catch((error) => console.warn("Status temporario: falha na limpeza", error)); }, 60_000).unref();
  scheduleDirectCallMaintenance(io);
  scheduleBackgroundJobs(io);
  await ensureReleaseAnnouncement().catch((error) => console.warn("Ginga News: falha ao publicar release", error));
  server.listen(config.PORT, "0.0.0.0", () => {
    console.log(`Ginga API ouvindo em 0.0.0.0:${config.PORT}`);
  });
}

void bootstrap().catch(async (error) => {
  console.error("Falha ao iniciar o Ginga API", error);
  await prisma.$disconnect().catch(() => undefined);
  process.exit(1);
});

async function shutdown(signal: string) {
  console.log(`Recebido ${signal}; encerrando...`);
  server.close(async () => {
    await prisma.$disconnect();
    process.exit(0);
  });

  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
