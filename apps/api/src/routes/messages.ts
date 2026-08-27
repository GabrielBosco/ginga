import { Prisma } from "@prisma/client";
import { Router } from "express";
import { z } from "zod";
import { writeAudit } from "../audit.js";
import { enforceAutoMod } from "../automod.js";
import { prisma } from "../db.js";
import { asyncHandler, HttpError } from "../errors.js";
import { requireAuth } from "../middleware.js";
import { requireChannelCapability, requireGuildCapability, requireGuildMember } from "../permissions.js";
import { validateGuildMentions } from "../mentions.js";
import { routeParam } from "../utils.js";

export const messagesRouter = Router();

const editSchema = z.object({ content: z.string().trim().min(1).max(4000) });
const reactionSchema = z.object({ emoji: z.string().trim().min(1).max(64) });
const forwardSchema = z.object({ targetChannelId: z.string().min(1) });
const bookmarkSchema = z.object({ note: z.string().trim().max(160).default("") });
const taskSchema = z.object({
  title: z.string().trim().min(1).max(240).optional(),
  dueAt: z.string().datetime().nullable().optional()
});
const taskPatchSchema = z.object({
  title: z.string().trim().min(1).max(240).optional(),
  completed: z.boolean().optional(),
  dueAt: z.string().datetime().nullable().optional()
}).refine((value) => Object.keys(value).length > 0);
const scheduleSchema = z.object({
  content: z.string().trim().min(1).max(4000),
  scheduledFor: z.string().datetime()
}).refine((value) => new Date(value.scheduledFor).getTime() > Date.now() + 30_000, { message: "Agende para pelo menos 30 segundos no futuro" });
const searchSchema = z.object({
  q: z.string().trim().min(2).max(100),
  channelId: z.string().min(1).optional(),
  authorId: z.string().min(1).optional(),
  has: z.enum(["attachments", "links"]).optional(),
  after: z.string().datetime().optional(),
  before: z.string().datetime().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50)
}).refine((value) => !value.after || !value.before || new Date(value.after).getTime() <= new Date(value.before).getTime(), { message: "Intervalo de datas invalido" });

const messageInclude = {
  author: { select: { id: true, username: true, displayName: true, avatarColor: true, systemRole: true, platformOwner: true, accountType: true } },
  attachments: { orderBy: { createdAt: "asc" as const } },
  reactions: { include: { user: { select: { id: true, username: true, displayName: true } } }, orderBy: { createdAt: "asc" as const } },
  replyTo: { include: { author: { select: { id: true, username: true, displayName: true, avatarColor: true, systemRole: true, platformOwner: true, accountType: true } } } }
};

async function accessibleChannelIds(userId: string, channelIds: string[]) {
  const unique = Array.from(new Set(channelIds.filter(Boolean)));
  const allowed = new Set<string>();
  await Promise.all(unique.map(async (channelId) => {
    try {
      await requireChannelCapability(userId, channelId, "view");
      allowed.add(channelId);
    } catch {
      // Itens pessoais nao podem manter acesso a conteudo perdido/privado.
    }
  }));
  return allowed;
}


messagesRouter.get("/messages/:messageId", requireAuth, asyncHandler(async (req, res) => {
  const messageId = routeParam(req.params.messageId, "messageId");
  const message = await prisma.message.findUnique({ where: { id: messageId }, include: messageInclude });
  if (!message) throw new HttpError(404, "Mensagem nao encontrada");
  await requireChannelCapability(req.auth!.sub, message.channelId, "view");
  res.json({ message });
}));

messagesRouter.get("/messages/:messageId/thread", requireAuth, asyncHandler(async (req, res) => {
  const messageId = routeParam(req.params.messageId, "messageId");
  const initialRoot = await prisma.message.findUnique({ where: { id: messageId }, include: messageInclude });
  if (!initialRoot) throw new HttpError(404, "Mensagem nao encontrada");

  const channelId = initialRoot.channelId;
  await requireChannelCapability(req.auth!.sub, channelId, "view");

  type ThreadMessage = NonNullable<typeof initialRoot>;
  let root: ThreadMessage = initialRoot;
  const visited = new Set<string>([root.id]);
  for (let depth = 0; depth < 20; depth += 1) {
    const replyToId = root.replyToId;
    if (!replyToId || visited.has(replyToId)) break;
    visited.add(replyToId);

    const parent: ThreadMessage | null = await prisma.message.findUnique({ where: { id: replyToId }, include: messageInclude });
    if (!parent || parent.channelId !== channelId) break;
    root = parent;
  }

  const replies = await prisma.message.findMany({
    where: { channelId, replyToId: root.id },
    include: messageInclude,
    orderBy: { createdAt: "asc" },
    take: 300
  });
  res.json({ root, replies, replyCount: replies.length });
}));

messagesRouter.patch("/messages/:messageId", requireAuth, asyncHandler(async (req, res) => {
  const messageId = routeParam(req.params.messageId, "messageId");
  const data = editSchema.parse(req.body);
  const message = await prisma.message.findUnique({ where: { id: messageId }, include: { channel: true } });
  if (!message) throw new HttpError(404, "Mensagem nao encontrada");
  await requireChannelCapability(req.auth!.sub, message.channelId, "view");
  if (message.authorId !== req.auth!.sub) throw new HttpError(403, "Voce so pode editar suas proprias mensagens");
  const mentions = await validateGuildMentions(message.channel.guildId, data.content);
  if (mentions.mentionEveryone) await requireGuildCapability(req.auth!.sub, message.channel.guildId, "mentionEveryone");
  await enforceAutoMod({ guildId: message.channel.guildId, channelId: message.channelId, userId: req.auth!.sub, content: data.content });
  const updated = await prisma.message.update({ where: { id: messageId }, data: { content: data.content, editedAt: new Date() }, include: messageInclude });
  req.app.get("io")?.to?.(`channel:${message.channelId}`)?.emit?.("message:updated", updated);
  res.json({ message: updated });
}));

messagesRouter.delete("/messages/:messageId", requireAuth, asyncHandler(async (req, res) => {
  const messageId = routeParam(req.params.messageId, "messageId");
  const message = await prisma.message.findUnique({ where: { id: messageId }, include: { channel: true } });
  if (!message) throw new HttpError(404, "Mensagem nao encontrada");
  await requireChannelCapability(req.auth!.sub, message.channelId, "view");
  if (message.authorId !== req.auth!.sub) await requireGuildCapability(req.auth!.sub, message.channel.guildId, "manageMessages");
  await prisma.message.delete({ where: { id: messageId } });
  if (message.authorId !== req.auth!.sub) await writeAudit({ guildId: message.channel.guildId, actorId: req.auth!.sub, action: "MESSAGE_DELETE", targetType: "MESSAGE", targetId: messageId, targetUserId: message.authorId, request: req });
  req.app.get("io")?.to?.(`channel:${message.channelId}`)?.emit?.("message:deleted", { id: messageId, channelId: message.channelId });
  res.status(204).end();
}));

messagesRouter.post("/messages/:messageId/forward", requireAuth, asyncHandler(async (req, res) => {
  const messageId = routeParam(req.params.messageId, "messageId");
  const { targetChannelId } = forwardSchema.parse(req.body);
  const source = await prisma.message.findUnique({
    where: { id: messageId },
    include: {
      channel: { select: { id: true, guildId: true, name: true, type: true } },
      author: { select: { id: true, username: true, displayName: true } },
      attachments: { select: { id: true, originalName: true } }
    }
  });
  if (!source) throw new HttpError(404, "Mensagem nao encontrada");
  await requireChannelCapability(req.auth!.sub, source.channelId, "view");
  const { channel: target } = await requireChannelCapability(req.auth!.sub, targetChannelId, "sendMessages");
  if (!["TEXT", "ANNOUNCEMENT"].includes(target.type)) throw new HttpError(400, "Escolha um canal de texto para encaminhar");
  if (target.guildId !== source.channel.guildId) throw new HttpError(403, "Por seguranca, encaminhe mensagens apenas dentro do mesmo servidor");

  const sourceText = source.content.trim();
  const attachmentNote = source.attachments.length > 0
    ? `[${source.attachments.length} anexo${source.attachments.length === 1 ? "" : "s"} na mensagem original]`
    : "";
  const body = [
    `Encaminhada de ${source.author.displayName} · #${source.channel.name}`,
    sourceText,
    attachmentNote
  ].filter(Boolean).join("\n");
  const content = body.slice(0, 4000);
  await enforceAutoMod({ guildId: target.guildId, channelId: target.id, userId: req.auth!.sub, content });

  const created = await prisma.message.create({
    data: { channelId: target.id, authorId: req.auth!.sub, content },
    include: messageInclude
  });
  const io = req.app.get("io");
  io?.to?.(`channel:${target.id}`)?.emit?.("message:new", created);
  const guildMessageEvent = {
    messageId: created.id,
    channelId: target.id,
    channelName: target.name,
    guildId: target.guildId,
    authorId: created.authorId,
    author: created.author,
    content: created.content,
    hasAttachments: created.attachments.length > 0,
    createdAt: created.createdAt
  };
  io?.to?.(`guild:${target.guildId}`)?.emit?.("guild:message:new", guildMessageEvent);
  io?.to?.(`botguild:${target.guildId}`)?.emit?.("guild:message:new", guildMessageEvent);
  res.status(201).json({ message: created });
}));

messagesRouter.post("/messages/:messageId/reactions", requireAuth, asyncHandler(async (req, res) => {
  const messageId = routeParam(req.params.messageId, "messageId");
  const { emoji } = reactionSchema.parse(req.body);
  const message = await prisma.message.findUnique({ where: { id: messageId }, select: { channelId: true } });
  if (!message) throw new HttpError(404, "Mensagem nao encontrada");
  await requireChannelCapability(req.auth!.sub, message.channelId, "view");
  await prisma.messageReaction.upsert({
    where: { messageId_userId_emoji: { messageId, userId: req.auth!.sub, emoji } },
    update: {}, create: { messageId, userId: req.auth!.sub, emoji }
  });
  const reactions = await prisma.messageReaction.findMany({ where: { messageId }, include: { user: { select: { id: true, username: true, displayName: true } } }, orderBy: { createdAt: "asc" } });
  req.app.get("io")?.to?.(`channel:${message.channelId}`)?.emit?.("message:reactions", { messageId, reactions });
  res.json({ reactions });
}));

messagesRouter.delete("/messages/:messageId/reactions", requireAuth, asyncHandler(async (req, res) => {
  const messageId = routeParam(req.params.messageId, "messageId");
  const { emoji } = reactionSchema.parse(req.body);
  const message = await prisma.message.findUnique({ where: { id: messageId }, select: { channelId: true } });
  if (!message) throw new HttpError(404, "Mensagem nao encontrada");
  await requireChannelCapability(req.auth!.sub, message.channelId, "view");
  await prisma.messageReaction.deleteMany({ where: { messageId, userId: req.auth!.sub, emoji } });
  const reactions = await prisma.messageReaction.findMany({ where: { messageId }, include: { user: { select: { id: true, username: true, displayName: true } } }, orderBy: { createdAt: "asc" } });
  req.app.get("io")?.to?.(`channel:${message.channelId}`)?.emit?.("message:reactions", { messageId, reactions });
  res.json({ reactions });
}));

messagesRouter.put("/messages/:messageId/pin", requireAuth, asyncHandler(async (req, res) => {
  const messageId = routeParam(req.params.messageId, "messageId");
  const message = await prisma.message.findUnique({ where: { id: messageId }, include: { channel: true } });
  if (!message) throw new HttpError(404, "Mensagem nao encontrada");
  await requireGuildCapability(req.auth!.sub, message.channel.guildId, "pinMessages");
  const updated = await prisma.message.update({ where: { id: messageId }, data: { isPinned: true, pinnedAt: new Date(), pinnedById: req.auth!.sub }, include: messageInclude });
  await writeAudit({ guildId: message.channel.guildId, actorId: req.auth!.sub, action: "MESSAGE_PIN", targetType: "MESSAGE", targetId: messageId, request: req });
  req.app.get("io")?.to?.(`channel:${message.channelId}`)?.emit?.("message:updated", updated);
  res.json({ message: updated });
}));

messagesRouter.delete("/messages/:messageId/pin", requireAuth, asyncHandler(async (req, res) => {
  const messageId = routeParam(req.params.messageId, "messageId");
  const message = await prisma.message.findUnique({ where: { id: messageId }, include: { channel: true } });
  if (!message) throw new HttpError(404, "Mensagem nao encontrada");
  await requireGuildCapability(req.auth!.sub, message.channel.guildId, "pinMessages");
  const updated = await prisma.message.update({ where: { id: messageId }, data: { isPinned: false, pinnedAt: null, pinnedById: null }, include: messageInclude });
  req.app.get("io")?.to?.(`channel:${message.channelId}`)?.emit?.("message:updated", updated);
  res.json({ message: updated });
}));

messagesRouter.get("/channels/:channelId/pins", requireAuth, asyncHandler(async (req, res) => {
  const channelId = routeParam(req.params.channelId, "channelId");
  await requireChannelCapability(req.auth!.sub, channelId, "view");
  const messages = await prisma.message.findMany({ where: { channelId, isPinned: true }, orderBy: { pinnedAt: "desc" }, take: 100, include: messageInclude });
  res.json({ messages });
}));

messagesRouter.put("/messages/:messageId/bookmark", requireAuth, asyncHandler(async (req, res) => {
  const messageId = routeParam(req.params.messageId, "messageId");
  const { note } = bookmarkSchema.parse(req.body ?? {});
  const message = await prisma.message.findUnique({ where: { id: messageId }, select: { channelId: true } });
  if (!message) throw new HttpError(404, "Mensagem nao encontrada");
  await requireChannelCapability(req.auth!.sub, message.channelId, "view");
  const bookmark = await prisma.messageBookmark.upsert({
    where: { messageId_userId: { messageId, userId: req.auth!.sub } }, update: { note }, create: { messageId, userId: req.auth!.sub, note }
  });
  res.json({ bookmark });
}));

messagesRouter.delete("/messages/:messageId/bookmark", requireAuth, asyncHandler(async (req, res) => {
  const messageId = routeParam(req.params.messageId, "messageId");
  await prisma.messageBookmark.deleteMany({ where: { messageId, userId: req.auth!.sub } });
  res.status(204).end();
}));

messagesRouter.get("/bookmarks", requireAuth, asyncHandler(async (req, res) => {
  const bookmarks = await prisma.messageBookmark.findMany({
    where: { userId: req.auth!.sub }, orderBy: { createdAt: "desc" }, take: 200,
    include: { message: { include: { ...messageInclude, channel: { select: { id: true, name: true, guildId: true, type: true }, }, } } }
  });
  const allowed = await accessibleChannelIds(req.auth!.sub, bookmarks.map((item) => item.message.channelId));
  res.json({ bookmarks: bookmarks.filter((item) => allowed.has(item.message.channelId)) });
}));

messagesRouter.put("/messages/:messageId/archive", requireAuth, asyncHandler(async (req, res) => {
  const messageId = routeParam(req.params.messageId, "messageId");
  const message = await prisma.message.findUnique({ where: { id: messageId }, select: { channelId: true } });
  if (!message) throw new HttpError(404, "Mensagem nao encontrada");
  await requireChannelCapability(req.auth!.sub, message.channelId, "view");
  const archived = await prisma.messageArchive.upsert({
    where: { messageId_userId: { messageId, userId: req.auth!.sub } },
    update: {},
    create: { messageId, userId: req.auth!.sub }
  });
  res.json({ archived });
}));

messagesRouter.delete("/messages/:messageId/archive", requireAuth, asyncHandler(async (req, res) => {
  const messageId = routeParam(req.params.messageId, "messageId");
  await prisma.messageArchive.deleteMany({ where: { messageId, userId: req.auth!.sub } });
  res.status(204).end();
}));

messagesRouter.get("/archives", requireAuth, asyncHandler(async (req, res) => {
  const archives = await prisma.messageArchive.findMany({
    where: { userId: req.auth!.sub }, orderBy: { createdAt: "desc" }, take: 300,
    include: { message: { include: { ...messageInclude, channel: { select: { id: true, name: true, guildId: true, type: true } } } } }
  });
  const allowed = await accessibleChannelIds(req.auth!.sub, archives.map((item) => item.message.channelId));
  res.json({ archives: archives.filter((item) => allowed.has(item.message.channelId)) });
}));

messagesRouter.post("/messages/:messageId/task", requireAuth, asyncHandler(async (req, res) => {
  const messageId = routeParam(req.params.messageId, "messageId");
  const data = taskSchema.parse(req.body ?? {});
  const message = await prisma.message.findUnique({ where: { id: messageId }, select: { channelId: true, content: true } });
  if (!message) throw new HttpError(404, "Mensagem nao encontrada");
  await requireChannelCapability(req.auth!.sub, message.channelId, "view");
  const fallbackTitle = message.content.trim().slice(0, 240) || "Revisar mensagem";
  const task = await prisma.personalTask.create({
    data: {
      userId: req.auth!.sub,
      sourceMessageId: messageId,
      title: data.title?.trim() || fallbackTitle,
      dueAt: data.dueAt ? new Date(data.dueAt) : null
    }
  });
  res.status(201).json({ task });
}));

messagesRouter.get("/tasks", requireAuth, asyncHandler(async (req, res) => {
  const tasks = await prisma.personalTask.findMany({
    where: { userId: req.auth!.sub },
    orderBy: [{ completed: "asc" }, { createdAt: "desc" }],
    take: 300,
    include: { sourceMessage: { include: { channel: { select: { id: true, name: true, guildId: true, type: true } } } } }
  });
  const channelIds = tasks.flatMap((item) => item.sourceMessage?.channelId ? [item.sourceMessage.channelId] : []);
  const allowed = await accessibleChannelIds(req.auth!.sub, channelIds);
  res.json({ tasks: tasks.filter((item) => !item.sourceMessage || allowed.has(item.sourceMessage.channelId)) });
}));

messagesRouter.patch("/tasks/:taskId", requireAuth, asyncHandler(async (req, res) => {
  const taskId = routeParam(req.params.taskId, "taskId");
  const data = taskPatchSchema.parse(req.body);
  const current = await prisma.personalTask.findUnique({ where: { id: taskId } });
  if (!current || current.userId !== req.auth!.sub) throw new HttpError(404, "Tarefa nao encontrada");
  const task = await prisma.personalTask.update({
    where: { id: taskId },
    data: { ...data, ...(data.dueAt !== undefined ? { dueAt: data.dueAt ? new Date(data.dueAt) : null } : {}) }
  });
  res.json({ task });
}));

messagesRouter.delete("/tasks/:taskId", requireAuth, asyncHandler(async (req, res) => {
  const taskId = routeParam(req.params.taskId, "taskId");
  const task = await prisma.personalTask.findUnique({ where: { id: taskId } });
  if (!task || task.userId !== req.auth!.sub) throw new HttpError(404, "Tarefa nao encontrada");
  await prisma.personalTask.delete({ where: { id: taskId } });
  res.status(204).end();
}));

messagesRouter.post("/channels/:channelId/scheduled-messages", requireAuth, asyncHandler(async (req, res) => {
  const channelId = routeParam(req.params.channelId, "channelId");
  const data = scheduleSchema.parse(req.body);
  const { channel } = await requireChannelCapability(req.auth!.sub, channelId, "sendMessages");
  await requireGuildCapability(req.auth!.sub, channel.guildId, "scheduleMessages");
  const mentions = await validateGuildMentions(channel.guildId, data.content);
  if (mentions.mentionEveryone) await requireGuildCapability(req.auth!.sub, channel.guildId, "mentionEveryone");
  const scheduled = await prisma.scheduledMessage.create({ data: { channelId, authorId: req.auth!.sub, content: data.content, scheduledFor: new Date(data.scheduledFor) } });
  res.status(201).json({ scheduled });
}));

messagesRouter.get("/scheduled-messages", requireAuth, asyncHandler(async (req, res) => {
  const scheduled = await prisma.scheduledMessage.findMany({
    where: { authorId: req.auth!.sub, status: "PENDING" }, orderBy: { scheduledFor: "asc" },
    include: { channel: { select: { id: true, name: true, guildId: true, type: true } } }
  });
  res.json({ scheduled });
}));

messagesRouter.delete("/scheduled-messages/:scheduledId", requireAuth, asyncHandler(async (req, res) => {
  const scheduledId = routeParam(req.params.scheduledId, "scheduledId");
  const scheduled = await prisma.scheduledMessage.findUnique({ where: { id: scheduledId } });
  if (!scheduled || scheduled.authorId !== req.auth!.sub) throw new HttpError(404, "Mensagem agendada nao encontrada");
  await prisma.scheduledMessage.update({ where: { id: scheduledId }, data: { status: "CANCELLED" } });
  res.status(204).end();
}));

messagesRouter.get("/guilds/:guildId/search", requireAuth, asyncHandler(async (req, res) => {
  const guildId = routeParam(req.params.guildId, "guildId");
  const query = searchSchema.parse(req.query);
  await requireGuildMember(req.auth!.sub, guildId);
  const channels = await prisma.channel.findMany({ where: { guildId, ...(query.channelId ? { id: query.channelId } : {}) }, select: { id: true, name: true, type: true } });
  const visibleIds: string[] = [];
  for (const channel of channels) {
    try { await requireChannelCapability(req.auth!.sub, channel.id, "view"); visibleIds.push(channel.id); } catch { /* hidden channel */ }
  }
  const where: Prisma.MessageWhereInput = {
    channelId: { in: visibleIds },
    ...(query.authorId ? { authorId: query.authorId } : {}),
    ...(query.after || query.before ? { createdAt: { ...(query.after ? { gte: new Date(query.after) } : {}), ...(query.before ? { lte: new Date(query.before) } : {}) } } : {}),
    ...(query.has === "attachments" ? { attachments: { some: {} } } : {}),
    AND: [
      { OR: [
        { content: { contains: query.q, mode: "insensitive" } },
        { author: { is: { displayName: { contains: query.q, mode: "insensitive" } } } },
        { author: { is: { username: { contains: query.q, mode: "insensitive" } } } },
        { attachments: { some: { originalName: { contains: query.q, mode: "insensitive" } } } }
      ] },
      ...(query.has === "links" ? [{ OR: [
        { content: { contains: "https://", mode: "insensitive" } },
        { content: { contains: "http://", mode: "insensitive" } }
      ] } satisfies Prisma.MessageWhereInput] : [])
    ]
  };
  const messages = await prisma.message.findMany({
    where,
    orderBy: { createdAt: "desc" }, take: query.limit, include: { ...messageInclude, channel: { select: { id: true, name: true, type: true, guildId: true } } }
  });
  res.json({ messages });
}));

messagesRouter.get("/channels/:channelId/application-commands", requireAuth, asyncHandler(async (req, res) => {
  const channelId = routeParam(req.params.channelId, "channelId");
  const { channel } = await requireChannelCapability(req.auth!.sub, channelId, "view");
  const installs = await prisma.botInstall.findMany({
    where: { guildId: channel.guildId, permissions: { has: "VIEW_CHANNELS" } },
    include: { application: { include: { commands: true, botUser: { select: { id: true, displayName: true, avatarColor: true } } } } }
  });
  const commands = [];
  for (const install of installs) {
    const bot = install.application.botUser;
    if (!bot) continue;
    try {
      await requireChannelCapability(bot.id, channelId, "view");
      commands.push(...install.application.commands.map((command) => ({ ...command, applicationId: install.applicationId, bot })));
    } catch {
      // Comandos de bots sem acesso efetivo ao canal nao devem ser sugeridos.
    }
  }
  res.json({ commands });
}));
