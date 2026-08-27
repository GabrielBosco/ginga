import { randomUUID } from "node:crypto";
import { Router, type Request, type Response } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { writeAudit } from "../audit.js";
import { config } from "../config.js";
import { prisma } from "../db.js";
import { asyncHandler, HttpError } from "../errors.js";
import { requireAuth, requireBotAuth } from "../middleware.js";
import { requireDeveloperAccess } from "../platformAccess.js";
import { requireChannelCapability, requireGuildCapability, requireGuildMember } from "../permissions.js";
import { hashSecret, secretMatches, secureToken, tokenPrefix } from "../secretTokens.js";
import { randomColor, routeParam } from "../utils.js";

export const developerRouter = Router();
export const botApiRouter = Router();
export const webhookIngressRouter = Router();

const applicationSchema = z.object({
  name: z.string().trim().min(2).max(64),
  description: z.string().trim().max(240).default(""),
  iconColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).default("#7667f5"),
  publicBot: z.boolean().default(false),
  messageContentIntent: z.boolean().default(false)
});
const applicationPatchSchema = applicationSchema.partial().refine((value) => Object.keys(value).length > 0);
const commandSchema = z.object({
  name: z.string().trim().toLowerCase().min(1).max(32).regex(/^[a-z0-9_-]+$/),
  description: z.string().trim().min(1).max(100)
});
const botPermissionValues = [
  "VIEW_CHANNELS", "SEND_MESSAGES", "READ_HISTORY", "MANAGE_MESSAGES", "EMBED_LINKS", "ATTACH_FILES",
  "ADD_REACTIONS", "MANAGE_EVENTS", "MANAGE_FORUMS", "CONNECT", "SPEAK", "USE_VIDEO", "SHARE_SCREEN"
] as const;
const botInstallSchema = z.object({
  guildId: z.string().min(1),
  permissions: z.array(z.enum(botPermissionValues)).max(botPermissionValues.length).default(["VIEW_CHANNELS", "SEND_MESSAGES", "READ_HISTORY"])
});
const webhookSchema = z.object({
  guildId: z.string().min(1, "Selecione o servidor onde o webhook sera criado"),
  channelId: z.string().min(1, "Escolha o canal que vai receber as mensagens"),
  name: z.string().trim()
    .min(2, "Digite um nome com pelo menos 2 caracteres")
    .max(64, "O nome do webhook pode ter no maximo 64 caracteres")
});
const webhookMessageSchema = z.object({
  content: z.string().trim().min(1).max(4000),
  username: z.string().trim().min(1).max(64).optional(),
  avatarColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional()
});
const botMessageSchema = z.object({
  content: z.string().trim().min(1).max(4000),
  replyToId: z.string().min(1).optional()
});

const ingressLimiter = rateLimit({
  windowMs: 60_000,
  limit: 60,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Webhook excedeu o limite de requisicoes" }
});

const botReadLimiter = rateLimit({
  windowMs: 60_000,
  limit: 180,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  keyGenerator: (req) => `bot:${req.botAuth?.applicationId ?? "unauthenticated"}`,
  message: { error: "Bot excedeu o limite de leitura. Aguarde antes de tentar novamente." }
});

const botWriteLimiter = rateLimit({
  windowMs: 60_000,
  limit: 90,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  keyGenerator: (req) => `bot:${req.botAuth?.applicationId ?? "unauthenticated"}`,
  message: { error: "Bot excedeu o limite de acoes. Aguarde antes de tentar novamente." }
});

function publicApplication<T extends {
  id: string; clientId: string; ownerId: string; name: string; description: string; iconColor: string;
  publicBot: boolean; messageContentIntent: boolean; botUserId: string | null; botTokenPrefix: string | null; createdAt: Date; updatedAt: Date;
}>(application: T) {
  return {
    id: application.id,
    clientId: application.clientId,
    ownerId: application.ownerId,
    name: application.name,
    description: application.description,
    iconColor: application.iconColor,
    publicBot: application.publicBot,
    messageContentIntent: application.messageContentIntent,
    runtime: "PYTHON" as const,
    sdk: "ginga-bot",
    botUserId: application.botUserId,
    tokenPrefix: application.botTokenPrefix,
    createdAt: application.createdAt,
    updatedAt: application.updatedAt
  };
}

async function createBotToken(applicationId: string) {
  const raw = secureToken("nxb");
  const prefix = tokenPrefix(raw);
  await prisma.developerApplication.update({
    where: { id: applicationId },
    data: { botTokenHash: hashSecret(raw), botTokenPrefix: prefix }
  });
  return { token: raw, tokenPrefix: prefix };
}

async function findOwnedApplication(userId: string, applicationId: string) {
  const application = await prisma.developerApplication.findUnique({ where: { id: applicationId } });
  if (!application) throw new HttpError(404, "Aplicacao nao encontrada");
  const actor = await prisma.user.findUnique({ where: { id: userId }, select: { systemRole: true } });
  if (application.ownerId !== userId && actor?.systemRole !== "PLATFORM_ADMIN") throw new HttpError(403, "Voce nao gerencia esta aplicacao");
  return application;
}

developerRouter.get("/developers/applications", requireAuth, asyncHandler(async (req, res) => {
  await requireDeveloperAccess(req.auth!.sub);
  const actor = await prisma.user.findUniqueOrThrow({ where: { id: req.auth!.sub }, select: { systemRole: true } });
  const applications = await prisma.developerApplication.findMany({
    where: actor.systemRole === "PLATFORM_ADMIN" ? {} : { ownerId: req.auth!.sub },
    orderBy: { createdAt: "desc" },
    include: {
      botUser: { select: { id: true, username: true, displayName: true, avatarColor: true, accountType: true, systemRole: true, platformOwner: true } },
      commands: { orderBy: { name: "asc" } },
      _count: { select: { installs: true } }
    }
  });
  res.json({ applications: applications.map((application) => ({ ...publicApplication(application), botUser: application.botUser, commands: application.commands, installCount: application._count.installs })) });
}));

developerRouter.post("/developers/applications", requireAuth, asyncHandler(async (req, res) => {
  await requireDeveloperAccess(req.auth!.sub);
  const data = applicationSchema.parse(req.body);
  const result = await prisma.$transaction(async (tx) => {
    const application = await tx.developerApplication.create({ data: { ownerId: req.auth!.sub, ...data } });
    const botUser = await tx.user.create({
      data: {
        email: `${application.id}@bots.ginga.local`,
        username: `bot_${application.id.slice(-12)}`,
        displayName: application.name,
        passwordHash: "BOT_ACCOUNT_LOGIN_DISABLED",
        avatarColor: application.iconColor,
        accountType: "BOT",
        systemRole: "USER",
        allowFriendRequests: false,
        allowDirectMessages: false
      }
    });
    const updated = await tx.developerApplication.update({ where: { id: application.id }, data: { botUserId: botUser.id } });
    return { application: updated, botUser };
  });
  const secret = await createBotToken(result.application.id);
  res.status(201).json({ application: publicApplication({ ...result.application, botTokenPrefix: secret.tokenPrefix }), botUser: result.botUser, token: secret.token });
}));

developerRouter.patch("/developers/applications/:applicationId", requireAuth, asyncHandler(async (req, res) => {
  await requireDeveloperAccess(req.auth!.sub);
  const applicationId = routeParam(req.params.applicationId, "applicationId");
  const current = await findOwnedApplication(req.auth!.sub, applicationId);
  const data = applicationPatchSchema.parse(req.body);
  const application = await prisma.$transaction(async (tx) => {
    const updated = await tx.developerApplication.update({ where: { id: applicationId }, data });
    if (current.botUserId && (data.name || data.iconColor)) {
      await tx.user.update({
        where: { id: current.botUserId },
        data: { ...(data.name ? { displayName: data.name } : {}), ...(data.iconColor ? { avatarColor: data.iconColor } : {}) }
      });
    }
    return updated;
  });
  res.json({ application: publicApplication(application) });
}));

developerRouter.post("/developers/applications/:applicationId/token/reset", requireAuth, asyncHandler(async (req, res) => {
  await requireDeveloperAccess(req.auth!.sub);
  const applicationId = routeParam(req.params.applicationId, "applicationId");
  await findOwnedApplication(req.auth!.sub, applicationId);
  const secret = await createBotToken(applicationId);
  res.json(secret);
}));

developerRouter.delete("/developers/applications/:applicationId", requireAuth, asyncHandler(async (req, res) => {
  await requireDeveloperAccess(req.auth!.sub);
  const applicationId = routeParam(req.params.applicationId, "applicationId");
  const application = await findOwnedApplication(req.auth!.sub, applicationId);
  await prisma.$transaction(async (tx) => {
    await tx.developerApplication.delete({ where: { id: applicationId } });
    if (application.botUserId) await tx.user.deleteMany({ where: { id: application.botUserId, accountType: "BOT" } });
  });
  res.status(204).end();
}));

developerRouter.put("/developers/applications/:applicationId/commands/:name", requireAuth, asyncHandler(async (req, res) => {
  await requireDeveloperAccess(req.auth!.sub);
  const applicationId = routeParam(req.params.applicationId, "applicationId");
  await findOwnedApplication(req.auth!.sub, applicationId);
  const data = commandSchema.parse({ ...req.body, name: routeParam(req.params.name, "name") });
  const command = await prisma.applicationCommand.upsert({
    where: { applicationId_name: { applicationId, name: data.name } },
    update: { description: data.description },
    create: { applicationId, ...data }
  });
  res.json({ command });
}));

developerRouter.delete("/developers/applications/:applicationId/commands/:name", requireAuth, asyncHandler(async (req, res) => {
  await requireDeveloperAccess(req.auth!.sub);
  const applicationId = routeParam(req.params.applicationId, "applicationId");
  await findOwnedApplication(req.auth!.sub, applicationId);
  const name = routeParam(req.params.name, "name").toLowerCase();
  await prisma.applicationCommand.deleteMany({ where: { applicationId, name } });
  res.status(204).end();
}));

developerRouter.get("/oauth/applications/:clientId", requireAuth, asyncHandler(async (req, res) => {
  const clientId = routeParam(req.params.clientId, "clientId");
  const application = await prisma.developerApplication.findUnique({
    where: { clientId },
    include: { botUser: { select: { id: true, displayName: true, username: true, avatarColor: true, accountType: true, systemRole: true, platformOwner: true } } }
  });
  if (!application?.botUserId) throw new HttpError(404, "Aplicacao ou bot nao encontrado");
  if (!application.publicBot && application.ownerId !== req.auth!.sub) throw new HttpError(403, "Este bot e privado");
  const memberships = await prisma.guildMember.findMany({ where: { userId: req.auth!.sub }, include: { guild: true } });
  const guilds = [];
  for (const membership of memberships) {
    try {
      await requireGuildCapability(req.auth!.sub, membership.guildId, "manageBots");
      guilds.push({ id: membership.guild.id, name: membership.guild.name, iconColor: membership.guild.iconColor });
    } catch {
      // O usuario pode participar do espaco sem poder instalar bots.
    }
  }
  res.json({ application: { ...publicApplication(application), botUser: application.botUser }, guilds, permissions: botPermissionValues });
}));

developerRouter.post("/oauth/applications/:clientId/authorize", requireAuth, asyncHandler(async (req, res) => {
  const clientId = routeParam(req.params.clientId, "clientId");
  const data = botInstallSchema.parse(req.body);
  await requireGuildCapability(req.auth!.sub, data.guildId, "manageBots");
  const application = await prisma.developerApplication.findUnique({ where: { clientId } });
  if (!application?.botUserId) throw new HttpError(404, "Aplicacao ou bot nao encontrado");
  if (!application.publicBot && application.ownerId !== req.auth!.sub) throw new HttpError(403, "Este bot e privado");

  const installed = await prisma.$transaction(async (tx) => {
    await tx.guildMember.upsert({
      where: { guildId_userId: { guildId: data.guildId, userId: application.botUserId! } },
      update: {},
      create: { guildId: data.guildId, userId: application.botUserId!, role: "MEMBER" }
    });
    return tx.botInstall.upsert({
      where: { guildId_applicationId: { guildId: data.guildId, applicationId: application.id } },
      update: { installedById: req.auth!.sub, permissions: data.permissions, scopes: ["bot", "commands"] },
      create: { guildId: data.guildId, applicationId: application.id, installedById: req.auth!.sub, permissions: data.permissions, scopes: ["bot", "commands"] }
    });
  });
  await writeAudit({ guildId: data.guildId, actorId: req.auth!.sub, action: "BOT_INSTALL", targetType: "APPLICATION", targetId: application.id, metadata: { clientId, permissions: data.permissions }, request: req });
  req.app.get("io")?.to?.(`guild:${data.guildId}`)?.emit?.("guild:structure:changed", { guildId: data.guildId, at: new Date().toISOString() });
  res.status(201).json({ installed });
}));

developerRouter.get("/guilds/:guildId/bots", requireAuth, asyncHandler(async (req, res) => {
  const guildId = routeParam(req.params.guildId, "guildId");
  await requireGuildMember(req.auth!.sub, guildId);
  const installs = await prisma.botInstall.findMany({
    where: { guildId },
    orderBy: { createdAt: "asc" },
    include: {
      application: { include: { botUser: { select: { id: true, username: true, displayName: true, avatarColor: true, accountType: true, systemRole: true, platformOwner: true } }, commands: true } },
      installedBy: { select: { id: true, username: true, displayName: true } }
    }
  });
  res.json({ installs: installs.map((install) => ({ ...install, application: { ...publicApplication(install.application), botUser: install.application.botUser, commands: install.application.commands } })) });
}));

developerRouter.delete("/guilds/:guildId/bots/:applicationId", requireAuth, asyncHandler(async (req, res) => {
  const guildId = routeParam(req.params.guildId, "guildId");
  const applicationId = routeParam(req.params.applicationId, "applicationId");
  await requireGuildCapability(req.auth!.sub, guildId, "manageBots");
  const install = await prisma.botInstall.findUnique({ where: { guildId_applicationId: { guildId, applicationId } }, include: { application: true } });
  if (!install) throw new HttpError(404, "Bot nao esta instalado neste espaco");
  await prisma.$transaction(async (tx) => {
    await tx.botInstall.delete({ where: { id: install.id } });
    if (install.application.botUserId) await tx.guildMember.deleteMany({ where: { guildId, userId: install.application.botUserId } });
  });
  await writeAudit({ guildId, actorId: req.auth!.sub, action: "BOT_REMOVE", targetType: "APPLICATION", targetId: applicationId, request: req });
  res.status(204).end();
}));

developerRouter.get("/developers/guilds/:guildId/webhooks", requireAuth, asyncHandler(async (req, res) => {
  const guildId = routeParam(req.params.guildId, "guildId");
  await requireGuildCapability(req.auth!.sub, guildId, "manageWebhooks");
  const webhooks = await prisma.webhook.findMany({
    where: { guildId },
    orderBy: { createdAt: "desc" },
    include: { channel: { select: { id: true, name: true, type: true } }, createdBy: { select: { id: true, username: true, displayName: true } } }
  });
  res.json({ webhooks: webhooks.map(({ tokenHash: _tokenHash, ...webhook }) => webhook) });
}));

developerRouter.post("/developers/webhooks", requireAuth, asyncHandler(async (req, res) => {
  const data = webhookSchema.parse(req.body);
  await requireGuildCapability(req.auth!.sub, data.guildId, "manageWebhooks");
  const { channel } = await requireChannelCapability(req.auth!.sub, data.channelId, "view");
  if (channel.guildId !== data.guildId) {
    throw new HttpError(400, "O canal escolhido nao pertence a este servidor", { field: "channelId" });
  }
  if (!["TEXT", "ANNOUNCEMENT"].includes(channel.type)) {
    throw new HttpError(400, "Escolha um canal de texto ou anuncios para receber o webhook", { field: "channelId" });
  }
  const webhookCount = await prisma.webhook.count({ where: { guildId: data.guildId } });
  if (webhookCount >= 50) {
    throw new HttpError(409, "Este servidor atingiu o limite de 50 webhooks. Remova um webhook antigo antes de criar outro.");
  }
  const token = secureToken("nxw");
  const prefix = tokenPrefix(token);
  const webhook = await prisma.$transaction(async (tx) => {
    const id = randomUUID();
    const identity = await tx.user.create({
      data: {
        email: `${id}@webhooks.ginga.local`,
        username: `wh_${id.replaceAll("-", "").slice(0, 16)}`,
        displayName: data.name,
        passwordHash: "WEBHOOK_ACCOUNT_LOGIN_DISABLED",
        avatarColor: randomColor(),
        accountType: "WEBHOOK",
        allowFriendRequests: false,
        allowDirectMessages: false
      }
    });
    return tx.webhook.create({
      data: {
        guildId: data.guildId,
        channelId: data.channelId,
        createdById: req.auth!.sub,
        userId: identity.id,
        name: data.name,
        tokenHash: hashSecret(token),
        tokenPrefix: prefix
      },
      include: { channel: { select: { id: true, name: true, type: true } } }
    });
  });
  await writeAudit({ guildId: data.guildId, actorId: req.auth!.sub, action: "WEBHOOK_CREATE", targetType: "WEBHOOK", targetId: webhook.id, metadata: { channelId: data.channelId }, request: req });
  res.status(201).json({ webhook: { ...webhook, tokenHash: undefined }, token });
}));

developerRouter.post("/developers/webhooks/:webhookId/token/reset", requireAuth, asyncHandler(async (req, res) => {
  const webhookId = routeParam(req.params.webhookId, "webhookId");
  const webhook = await prisma.webhook.findUnique({ where: { id: webhookId } });
  if (!webhook) throw new HttpError(404, "Webhook nao encontrado");
  await requireGuildCapability(req.auth!.sub, webhook.guildId, "manageWebhooks");
  const token = secureToken("nxw");
  const prefix = tokenPrefix(token);
  await prisma.webhook.update({ where: { id: webhookId }, data: { tokenHash: hashSecret(token), tokenPrefix: prefix } });
  res.json({ token, tokenPrefix: prefix });
}));

developerRouter.delete("/developers/webhooks/:webhookId", requireAuth, asyncHandler(async (req, res) => {
  const webhookId = routeParam(req.params.webhookId, "webhookId");
  const webhook = await prisma.webhook.findUnique({ where: { id: webhookId } });
  if (!webhook) throw new HttpError(404, "Webhook nao encontrado");
  await requireGuildCapability(req.auth!.sub, webhook.guildId, "manageWebhooks");
  await prisma.$transaction(async (tx) => {
    await tx.webhook.delete({ where: { id: webhookId } });
    await tx.user.deleteMany({ where: { id: webhook.userId, accountType: "WEBHOOK" } });
  });
  await writeAudit({ guildId: webhook.guildId, actorId: req.auth!.sub, action: "WEBHOOK_DELETE", targetType: "WEBHOOK", targetId: webhookId, request: req });
  res.status(204).end();
}));

async function executeIncomingWebhook(req: Request, res: Response, webhookId: string, token: string) {
  if (!token || token.length < 20) throw new HttpError(401, "Webhook invalido");
  const data = webhookMessageSchema.parse(req.body);
  const webhook = await prisma.webhook.findUnique({ where: { id: webhookId }, include: { channel: true } });
  if (!webhook || !webhook.enabled || !secretMatches(token, webhook.tokenHash)) throw new HttpError(401, "Webhook invalido");
  const guildState = await prisma.guild.findUnique({ where: { id: webhook.guildId }, select: { lockdownEnabled: true } });
  if (guildState?.lockdownEnabled) throw new HttpError(423, "Servidor em modo de contencao. Webhooks estao pausados temporariamente.");
  if (!["TEXT", "ANNOUNCEMENT"].includes(webhook.channel.type)) throw new HttpError(409, "Canal do webhook nao aceita mensagens");
  if (data.username || data.avatarColor) {
    await prisma.user.update({
      where: { id: webhook.userId },
      data: { ...(data.username ? { displayName: data.username } : {}), ...(data.avatarColor ? { avatarColor: data.avatarColor } : {}) }
    });
  }
  const message = await prisma.message.create({
    data: { channelId: webhook.channelId, authorId: webhook.userId, content: data.content },
    include: { author: { select: { id: true, username: true, displayName: true, avatarColor: true, systemRole: true, platformOwner: true, accountType: true } }, attachments: true, reactions: true, replyTo: { include: { author: { select: { id: true, username: true, displayName: true, avatarColor: true, systemRole: true, platformOwner: true, accountType: true } } } } }
  });
  req.app.get("io")?.to?.(`channel:${webhook.channelId}`)?.emit?.("message:new", message);
  res.status(201).json({ message });
}

webhookIngressRouter.post("/api/webhooks/:webhookId", ingressLimiter, asyncHandler(async (req, res) => {
  const webhookId = routeParam(req.params.webhookId, "webhookId");
  const authorization = req.header("authorization") || "";
  const bearer = authorization.match(/^Bearer\s+(.+)$/i)?.[1]?.trim() || "";
  const token = (req.header("x-ginga-webhook-token") || bearer).trim();
  await executeIncomingWebhook(req, res, webhookId, token);
}));

webhookIngressRouter.post("/api/webhooks/:webhookId/:token", ingressLimiter, asyncHandler(async (req, res) => {
  if (!config.allowLegacyWebhookUrlTokens) throw new HttpError(410, "Webhook com segredo na URL foi desativado. Use Authorization: Bearer <token>.");
  const webhookId = routeParam(req.params.webhookId, "webhookId");
  const token = routeParam(req.params.token, "token");
  await executeIncomingWebhook(req, res, webhookId, token);
}));

const builtinGuildRoles = [
  { key: "OWNER", name: "Proprietario", position: 400 },
  { key: "ADMIN", name: "Administrador", position: 300 },
  { key: "MODERATOR", name: "Moderador", position: 200 },
  { key: "MEMBER", name: "@everyone", position: 100 }
] as const;

type BuiltinGuildRoleKey = typeof builtinGuildRoles[number]["key"];

function builtinGuildRoleId(guildId: string, role: BuiltinGuildRoleKey) {
  return `grole:${guildId}:${role.toLowerCase()}`;
}

function publicBuiltinRole(guildId: string, role: typeof builtinGuildRoles[number]) {
  return {
    id: builtinGuildRoleId(guildId, role.key),
    guildId,
    key: role.key,
    name: role.name,
    color: null,
    position: role.position,
    permissions: [],
    builtin: true,
    managed: true
  };
}

function publicCustomRole(role: { id: string; guildId: string; name: string; color: string; position: number; permissions: string[]; managed: boolean }) {
  return {
    id: role.id,
    guildId: role.guildId,
    key: null,
    name: role.name,
    color: role.color,
    position: role.position,
    permissions: role.permissions,
    builtin: false,
    managed: role.managed
  };
}

async function requireBotInstall(applicationId: string, guildId: string) {
  const install = await prisma.botInstall.findUnique({ where: { guildId_applicationId: { guildId, applicationId } } });
  if (!install) throw new HttpError(403, "Bot nao esta instalado neste espaco");
  return install;
}

botApiRouter.get("/bot/me", requireBotAuth, botReadLimiter, asyncHandler(async (req, res) => {
  const application = await prisma.developerApplication.findUnique({
    where: { id: req.botAuth!.applicationId },
    include: { botUser: { select: { id: true, username: true, displayName: true, avatarColor: true, accountType: true, systemRole: true, platformOwner: true } }, commands: true }
  });
  res.json({ application: application ? { ...publicApplication(application), botUser: application.botUser, commands: application.commands } : null });
}));

botApiRouter.get("/bot/guilds", requireBotAuth, botReadLimiter, asyncHandler(async (req, res) => {
  const installs = await prisma.botInstall.findMany({
    where: { applicationId: req.botAuth!.applicationId },
    include: { guild: { select: { id: true, name: true, iconColor: true, channels: { select: { id: true, guildId: true, name: true, type: true, categoryId: true } }, customRoles: { select: { id: true, guildId: true, name: true, color: true, position: true, permissions: true, managed: true } } } } }
  });
  const guilds = [];
  for (const install of installs) {
    const channels = [];
    if (install.permissions.includes("VIEW_CHANNELS")) {
      for (const channel of install.guild.channels) {
        try {
          await requireChannelCapability(req.botAuth!.botUserId, channel.id, "view");
          channels.push(channel);
        } catch {
          // O bot recebe somente canais visiveis pela ACL efetiva do membro-bot.
        }
      }
    }
    const roles = [
      ...builtinGuildRoles.map((role) => publicBuiltinRole(install.guild.id, role)),
      ...install.guild.customRoles.map(publicCustomRole)
    ];
    guilds.push({ id: install.guild.id, name: install.guild.name, iconColor: install.guild.iconColor, channels, roles, permissions: install.permissions });
  }
  res.json({ guilds });
}));

botApiRouter.get("/bot/channels/:channelId", requireBotAuth, botReadLimiter, asyncHandler(async (req, res) => {
  const channelId = routeParam(req.params.channelId, "channelId");
  const channel = await prisma.channel.findUnique({ where: { id: channelId }, select: { id: true, guildId: true, categoryId: true, name: true, type: true, topic: true, position: true } });
  if (!channel) throw new HttpError(404, "Canal nao encontrado");
  const install = await requireBotInstall(req.botAuth!.applicationId, channel.guildId);
  if (!install.permissions.includes("VIEW_CHANNELS")) throw new HttpError(403, "Bot nao possui permissao para visualizar canais");
  await requireChannelCapability(req.botAuth!.botUserId, channelId, "view");
  res.json({ channel });
}));

botApiRouter.get("/bot/guilds/:guildId/roles/:roleId", requireBotAuth, botReadLimiter, asyncHandler(async (req, res) => {
  const guildId = routeParam(req.params.guildId, "guildId");
  const roleId = routeParam(req.params.roleId, "roleId");
  await requireBotInstall(req.botAuth!.applicationId, guildId);
  const builtin = builtinGuildRoles.find((role) => builtinGuildRoleId(guildId, role.key) === roleId);
  if (builtin) return res.json({ role: publicBuiltinRole(guildId, builtin) });
  const role = await prisma.guildCustomRole.findUnique({ where: { id: roleId }, select: { id: true, guildId: true, name: true, color: true, position: true, permissions: true, managed: true } });
  if (!role || role.guildId !== guildId) throw new HttpError(404, "Cargo nao encontrado");
  res.json({ role: publicCustomRole(role) });
}));

botApiRouter.get("/bot/users/:userId", requireBotAuth, botReadLimiter, asyncHandler(async (req, res) => {
  const userId = routeParam(req.params.userId, "userId");
  const memberships = await prisma.guildMember.findMany({ where: { userId }, select: { guildId: true } });
  if (!memberships.length) throw new HttpError(404, "Usuario nao encontrado");
  const sharedInstall = await prisma.botInstall.findFirst({
    where: { applicationId: req.botAuth!.applicationId, guildId: { in: memberships.map((membership) => membership.guildId) } },
    select: { guildId: true }
  });
  if (!sharedInstall) throw new HttpError(404, "Usuario nao encontrado em um espaco compartilhado com este bot");
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, username: true, displayName: true, avatarColor: true, accountType: true, systemRole: true, platformOwner: true }
  });
  if (!user) throw new HttpError(404, "Usuario nao encontrado");
  res.json({ user });
}));

botApiRouter.get("/bot/guilds/:guildId/members/:userId", requireBotAuth, botReadLimiter, asyncHandler(async (req, res) => {
  const guildId = routeParam(req.params.guildId, "guildId");
  const userId = routeParam(req.params.userId, "userId");
  await requireBotInstall(req.botAuth!.applicationId, guildId);
  const [member, assignments] = await Promise.all([
    prisma.guildMember.findUnique({
      where: { guildId_userId: { guildId, userId } },
      include: { user: { select: { id: true, username: true, displayName: true, avatarColor: true, accountType: true, systemRole: true, platformOwner: true } } }
    }),
    prisma.guildMemberCustomRole.findMany({
      where: { guildId, userId },
      include: { role: { select: { id: true, guildId: true, name: true, color: true, position: true, permissions: true, managed: true } } }
    })
  ]);
  if (!member) throw new HttpError(404, "Membro nao encontrado");
  res.json({
    member: {
      user: member.user,
      joinedAt: member.joinedAt,
      baseRole: member.role,
      baseRoleId: builtinGuildRoleId(guildId, member.role),
      roles: assignments.map((assignment) => publicCustomRole(assignment.role))
    }
  });
}));

botApiRouter.put("/bot/commands/:name", requireBotAuth, botWriteLimiter, asyncHandler(async (req, res) => {
  const data = commandSchema.parse({ ...req.body, name: routeParam(req.params.name, "name") });
  const command = await prisma.applicationCommand.upsert({
    where: { applicationId_name: { applicationId: req.botAuth!.applicationId, name: data.name } },
    update: { description: data.description },
    create: { applicationId: req.botAuth!.applicationId, ...data }
  });
  res.json({ command });
}));

botApiRouter.post("/bot/channels/:channelId/messages", requireBotAuth, botWriteLimiter, asyncHandler(async (req, res) => {
  const channelId = routeParam(req.params.channelId, "channelId");
  const data = botMessageSchema.parse(req.body);
  const channel = await prisma.channel.findUnique({ where: { id: channelId } });
  if (!channel || !["TEXT", "ANNOUNCEMENT"].includes(channel.type)) throw new HttpError(404, "Canal de texto nao encontrado");
  const install = await prisma.botInstall.findUnique({ where: { guildId_applicationId: { guildId: channel.guildId, applicationId: req.botAuth!.applicationId } } });
  if (!install || !install.permissions.includes("SEND_MESSAGES")) throw new HttpError(403, "Bot nao possui permissao para enviar mensagens neste espaco");
  const member = await prisma.guildMember.findUnique({ where: { guildId_userId: { guildId: channel.guildId, userId: req.botAuth!.botUserId } } });
  if (!member) throw new HttpError(403, "Bot nao esta instalado neste espaco");
  await requireChannelCapability(req.botAuth!.botUserId, channelId, "sendMessages");
  if (data.replyToId) {
    const replied = await prisma.message.findUnique({ where: { id: data.replyToId }, select: { channelId: true } });
    if (!replied || replied.channelId !== channelId) throw new HttpError(400, "Mensagem de resposta invalida");
  }
  const message = await prisma.message.create({
    data: { channelId, authorId: req.botAuth!.botUserId, content: data.content, replyToId: data.replyToId ?? null },
    include: { author: { select: { id: true, username: true, displayName: true, avatarColor: true, systemRole: true, platformOwner: true, accountType: true } }, attachments: true, reactions: true, replyTo: { include: { author: { select: { id: true, username: true, displayName: true, avatarColor: true, systemRole: true, platformOwner: true, accountType: true } } } } }
  });
  req.app.get("io")?.to?.(`channel:${channelId}`)?.emit?.("message:new", message);
  res.status(201).json({ message });
}));
