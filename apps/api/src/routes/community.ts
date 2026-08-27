import { Router } from "express";
import { z } from "zod";
import { writeAudit } from "../audit.js";
import { prisma } from "../db.js";
import { postGuildMemberSystemMessage } from "../guildSystemMessages.js";
import { config } from "../config.js";
import { asyncHandler, HttpError } from "../errors.js";
import { requireAuth } from "../middleware.js";
import {
  defaultGuildRolePermissionData,
  requireChannelCapability,
  requireAnyGuildCapability,
  requireGuildCapability,
  requireGuildMember,
  requireGuildOwner
} from "../permissions.js";
import { randomColor, routeParam } from "../utils.js";
import { SECURITY_POLICY_VERSION } from "../security.js";
import { guildBannerUrlMap, guildIconUrlMap } from "../guildAppearance.js";
import { onlineUserCountForIds } from "../socket.js";

export const communityRouter = Router();

const communityDiscoveryQuery = z.object({
  q: z.string().trim().max(80).default(""),
  category: z.string().trim().max(32).default(""),
  limit: z.coerce.number().int().min(1).max(60).default(30)
});

communityRouter.get("/communities", requireAuth, asyncHandler(async (req, res) => {
  const query = communityDiscoveryQuery.parse(req.query);
  const guilds = await prisma.guild.findMany({
    where: {
      communityEnabled: true,
      ...(query.category ? { communityCategory: query.category } : {}),
      ...(query.q ? { OR: [
        { name: { contains: query.q, mode: "insensitive" } },
        { description: { contains: query.q, mode: "insensitive" } },
        { communityTags: { has: query.q } }
      ] } : {})
    },
    orderBy: [{ updatedAt: "desc" }],
    take: query.limit,
    select: { id: true, name: true, iconColor: true, description: true, rules: true, communityTags: true, communityCategory: true, members: { select: { userId: true } }, _count: { select: { members: true } } }
  });
  const memberships = await prisma.guildMember.findMany({ where: { userId: req.auth!.sub, guildId: { in: guilds.map((guild) => guild.id) } }, select: { guildId: true } });
  const joined = new Set(memberships.map((item) => item.guildId));
  const [iconUrls, bannerUrls] = await Promise.all([guildIconUrlMap(guilds.map((guild) => guild.id)), guildBannerUrlMap(guilds.map((guild) => guild.id))]);
  const categories = await prisma.guild.findMany({ where: { communityEnabled: true }, distinct: ["communityCategory"], select: { communityCategory: true }, orderBy: { communityCategory: "asc" } });
  res.json({
    communities: guilds.map((guild) => ({
      id: guild.id, name: guild.name, iconColor: guild.iconColor, iconUrl: iconUrls.get(guild.id) ?? null, bannerUrl: bannerUrls.get(guild.id) ?? null, description: guild.description, rules: guild.rules,
      communityTags: guild.communityTags, communityCategory: guild.communityCategory, memberCount: guild._count.members,
      onlineCount: onlineUserCountForIds(guild.members.map((member) => member.userId)), joined: joined.has(guild.id)
    })),
    categories: categories.map((item) => item.communityCategory).filter(Boolean)
  });
}));

communityRouter.post("/communities/:guildId/join", requireAuth, asyncHandler(async (req, res) => {
  const guildId = routeParam(req.params.guildId, "guildId");
  const guild = await prisma.guild.findUnique({ where: { id: guildId }, select: { id: true, communityEnabled: true, name: true, lockdownEnabled: true, welcomeChannelId: true } });
  if (!guild?.communityEnabled) throw new HttpError(404, "Comunidade nao encontrada ou nao esta publica");
  if (guild.lockdownEnabled) throw new HttpError(423, "Comunidade em modo de contencao. Novas entradas estao pausadas temporariamente.");
  await prisma.guildBan.deleteMany({ where: { guildId, userId: req.auth!.sub, expiresAt: { lte: new Date() } } });
  const banned = await prisma.guildBan.findUnique({ where: { guildId_userId: { guildId, userId: req.auth!.sub } } });
  if (banned && (!banned.expiresAt || banned.expiresAt > new Date())) throw new HttpError(403, "Voce nao pode entrar nesta comunidade");
  const existingMembership = await prisma.guildMember.findUnique({ where: { guildId_userId: { guildId, userId: req.auth!.sub } }, select: { userId: true } });
  await prisma.guildMember.upsert({ where: { guildId_userId: { guildId, userId: req.auth!.sub } }, update: {}, create: { guildId, userId: req.auth!.sub, role: "MEMBER" } });
  await writeAudit({ guildId, actorId: req.auth!.sub, action: "COMMUNITY_JOIN", targetType: "USER", targetId: req.auth!.sub, targetUserId: req.auth!.sub, request: req });
  if (!existingMembership) await postGuildMemberSystemMessage(req.app.get("io"), guildId, req.auth!.sub, "JOIN").catch((error) => console.warn("Mensagem de entrada no servidor falhou", error));
  res.status(201).json({ guildId, name: guild.name, welcomeChannelId: guild.welcomeChannelId });
}));

const tagSchema = z.object({ name: z.string().trim().min(1).max(32), color: z.string().regex(/^#[0-9a-fA-F]{6}$/).default("#8b93a7") });
const forumPostSchema = z.object({ title: z.string().trim().min(2).max(120), content: z.string().trim().min(1).max(12000), tagIds: z.array(z.string()).max(5).default([]) });
const forumCommentSchema = z.object({ content: z.string().trim().min(1).max(6000) });
const forumPatchSchema = z.object({ status: z.enum(["OPEN", "CLOSED"]).optional(), pinned: z.boolean().optional(), title: z.string().trim().min(2).max(120).optional() }).refine((value) => Object.keys(value).length > 0);
const forumQuerySchema = z.object({ q: z.string().trim().max(100).default(""), tagId: z.string().optional(), includeClosed: z.coerce.boolean().default(false) });

const eventBaseSchema = z.object({
  title: z.string().trim().min(2).max(120),
  description: z.string().trim().max(1000).default(""),
  location: z.string().trim().max(240).default(""),
  channelId: z.string().min(1).nullable().optional(),
  startsAt: z.string().datetime(),
  endsAt: z.string().datetime().nullable().optional(),
  capacity: z.number().int().min(1).max(100000).nullable().optional()
});
const eventSchema = eventBaseSchema.refine(
  (value) => !value.endsAt || new Date(value.endsAt).getTime() > new Date(value.startsAt).getTime(),
  { message: "O termino precisa ser depois do inicio", path: ["endsAt"] }
);
const eventPatchSchema = eventBaseSchema.partial().refine((value) => Object.keys(value).length > 0);
const rsvpSchema = z.object({ status: z.enum(["INTERESTED", "GOING", "NOT_GOING"]) });

const automodSchema = z.object({
  name: z.string().trim().min(2).max(64),
  type: z.enum(["KEYWORDS", "MENTION_SPAM", "INVITE_SPAM", "REPETITION"]),
  enabled: z.boolean().default(true),
  blockedTerms: z.array(z.string().trim().min(1).max(80)).max(200).default([]),
  mentionLimit: z.number().int().min(1).max(50).nullable().optional(),
  repetitionLimit: z.number().int().min(2).max(20).nullable().optional(),
  blockMessage: z.boolean().default(true),
  alertChannelId: z.string().min(1).nullable().optional(),
  exemptRoleIds: z.array(z.string().min(1)).max(100).default([]),
  exemptChannelIds: z.array(z.string().min(1)).max(100).default([])
});
const automodPatchSchema = automodSchema.partial().refine((value) => Object.keys(value).length > 0);

const snapshotSchema = z.object({
  name: z.string().trim().min(2).max(64).optional(),
  guild: z.object({ description: z.string().max(240).default(""), welcomeMessage: z.string().max(240).default(""), rules: z.string().max(8000).default(""), welcomeChannelSourceId: z.string().nullable().default(null), iconColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).default("#7667f5") }),
  categories: z.array(z.object({ sourceId: z.string(), name: z.string().min(1).max(48), position: z.number().int().min(0) })).max(100),
  channels: z.array(z.object({ sourceId: z.string(), categorySourceId: z.string().nullable(), name: z.string().min(1).max(48), type: z.enum(["TEXT", "VOICE", "ANNOUNCEMENT", "FORUM", "EVENT"]), topic: z.string().max(1024).default(""), slowModeSeconds: z.number().int().min(0).max(21600).default(0), position: z.number().int().min(0) })).max(300),
  customRoles: z.array(z.object({ name: z.string().min(1).max(48), color: z.string().regex(/^#[0-9a-fA-F]{6}$/), position: z.number().int().min(0), permissions: z.array(z.string()).max(50), hoist: z.boolean(), mentionable: z.boolean() })).max(100),
  automodRules: z.array(automodSchema.omit({ alertChannelId: true, exemptRoleIds: true, exemptChannelIds: true }).extend({ alertChannelId: z.null(), exemptRoleIds: z.array(z.string()).default([]), exemptChannelIds: z.array(z.string()).default([]) })).max(100).default([])
});

async function forumChannel(userId: string, channelId: string, capability: "view" | "sendMessages" = "view") {
  const { channel } = await requireChannelCapability(userId, channelId, capability);
  if (channel.type !== "FORUM") throw new HttpError(400, "Este canal nao e um forum");
  return channel;
}

communityRouter.get("/channels/:channelId/forum", requireAuth, asyncHandler(async (req, res) => {
  const channelId = routeParam(req.params.channelId, "channelId");
  await forumChannel(req.auth!.sub, channelId, "view");
  const query = forumQuerySchema.parse(req.query);
  const [tags, posts] = await Promise.all([
    prisma.forumTag.findMany({ where: { channelId }, orderBy: { name: "asc" } }),
    prisma.forumPost.findMany({
      where: {
        channelId,
        ...(!query.includeClosed ? { status: "OPEN" } : {}),
        ...(query.q ? { OR: [{ title: { contains: query.q, mode: "insensitive" } }, { content: { contains: query.q, mode: "insensitive" } }] } : {}),
        ...(query.tagId ? { tags: { some: { tagId: query.tagId } } } : {})
      },
      orderBy: [{ pinned: "desc" }, { lastActivityAt: "desc" }],
      take: 100,
      include: {
        author: { select: { id: true, username: true, displayName: true, avatarColor: true, systemRole: true, platformOwner: true, accountType: true } },
        tags: { include: { tag: true } },
        _count: { select: { comments: true } }
      }
    })
  ]);
  res.json({ tags, posts: posts.map((post) => ({ ...post, tags: post.tags.map((item) => item.tag), commentCount: post._count.comments })) });
}));

communityRouter.post("/channels/:channelId/forum/tags", requireAuth, asyncHandler(async (req, res) => {
  const channelId = routeParam(req.params.channelId, "channelId");
  const channel = await forumChannel(req.auth!.sub, channelId, "view");
  await requireGuildCapability(req.auth!.sub, channel.guildId, "manageForums");
  const data = tagSchema.parse(req.body);
  const tag = await prisma.forumTag.create({ data: { guildId: channel.guildId, channelId, ...data } });
  res.status(201).json({ tag });
}));

communityRouter.delete("/forum/tags/:tagId", requireAuth, asyncHandler(async (req, res) => {
  const tagId = routeParam(req.params.tagId, "tagId");
  const tag = await prisma.forumTag.findUnique({ where: { id: tagId } });
  if (!tag) throw new HttpError(404, "Tag nao encontrada");
  await requireGuildCapability(req.auth!.sub, tag.guildId, "manageForums");
  await prisma.forumTag.delete({ where: { id: tagId } });
  res.status(204).end();
}));

communityRouter.post("/channels/:channelId/forum/posts", requireAuth, asyncHandler(async (req, res) => {
  const channelId = routeParam(req.params.channelId, "channelId");
  const channel = await forumChannel(req.auth!.sub, channelId, "sendMessages");
  const data = forumPostSchema.parse(req.body);
  const tags = data.tagIds.length ? await prisma.forumTag.findMany({ where: { channelId, id: { in: data.tagIds } }, select: { id: true } }) : [];
  if (tags.length !== new Set(data.tagIds).size) throw new HttpError(400, "Uma ou mais tags nao pertencem a este forum");
  const post = await prisma.forumPost.create({
    data: { guildId: channel.guildId, channelId, authorId: req.auth!.sub, title: data.title, content: data.content, tags: { create: tags.map((tag) => ({ tagId: tag.id })) } },
    include: { author: { select: { id: true, username: true, displayName: true, avatarColor: true, systemRole: true, platformOwner: true, accountType: true } }, tags: { include: { tag: true } }, _count: { select: { comments: true } } }
  });
  req.app.get("io")?.to?.(`guild:${channel.guildId}`)?.emit?.("forum:changed", { channelId, postId: post.id });
  res.status(201).json({ post: { ...post, tags: post.tags.map((item) => item.tag), commentCount: post._count.comments } });
}));

communityRouter.get("/forum/posts/:postId", requireAuth, asyncHandler(async (req, res) => {
  const postId = routeParam(req.params.postId, "postId");
  const post = await prisma.forumPost.findUnique({
    where: { id: postId },
    include: {
      author: { select: { id: true, username: true, displayName: true, avatarColor: true, systemRole: true, platformOwner: true, accountType: true } },
      tags: { include: { tag: true } },
      comments: { orderBy: { createdAt: "asc" }, include: { author: { select: { id: true, username: true, displayName: true, avatarColor: true, systemRole: true, platformOwner: true, accountType: true } } } }
    }
  });
  if (!post) throw new HttpError(404, "Topico nao encontrado");
  await forumChannel(req.auth!.sub, post.channelId, "view");
  res.json({ post: { ...post, tags: post.tags.map((item) => item.tag) } });
}));

communityRouter.post("/forum/posts/:postId/comments", requireAuth, asyncHandler(async (req, res) => {
  const postId = routeParam(req.params.postId, "postId");
  const { content } = forumCommentSchema.parse(req.body);
  const post = await prisma.forumPost.findUnique({ where: { id: postId } });
  if (!post) throw new HttpError(404, "Topico nao encontrado");
  await forumChannel(req.auth!.sub, post.channelId, "sendMessages");
  if (post.status === "CLOSED") throw new HttpError(409, "Este topico esta fechado");
  const comment = await prisma.$transaction(async (tx) => {
    const created = await tx.forumComment.create({ data: { postId, authorId: req.auth!.sub, content }, include: { author: { select: { id: true, username: true, displayName: true, avatarColor: true, systemRole: true, platformOwner: true, accountType: true } } } });
    await tx.forumPost.update({ where: { id: postId }, data: { lastActivityAt: new Date() } });
    return created;
  });
  req.app.get("io")?.to?.(`guild:${post.guildId}`)?.emit?.("forum:comment:new", { postId, comment });
  res.status(201).json({ comment });
}));

communityRouter.patch("/forum/posts/:postId", requireAuth, asyncHandler(async (req, res) => {
  const postId = routeParam(req.params.postId, "postId");
  const data = forumPatchSchema.parse(req.body);
  const post = await prisma.forumPost.findUnique({ where: { id: postId } });
  if (!post) throw new HttpError(404, "Topico nao encontrado");
  await forumChannel(req.auth!.sub, post.channelId, "view");
  const isAuthor = post.authorId === req.auth!.sub;
  if (data.pinned !== undefined || (!isAuthor && (data.status !== undefined || data.title !== undefined))) await requireGuildCapability(req.auth!.sub, post.guildId, "manageForums");
  const updated = await prisma.forumPost.update({ where: { id: postId }, data });
  req.app.get("io")?.to?.(`guild:${post.guildId}`)?.emit?.("forum:changed", { channelId: post.channelId, postId });
  res.json({ post: updated });
}));

communityRouter.get("/guilds/:guildId/events", requireAuth, asyncHandler(async (req, res) => {
  const guildId = routeParam(req.params.guildId, "guildId");
  await requireGuildMember(req.auth!.sub, guildId);
  const events = await prisma.guildEvent.findMany({
    where: { guildId, startsAt: { gte: new Date(Date.now() - 6 * 60 * 60 * 1000) } },
    orderBy: { startsAt: "asc" }, take: 100,
    include: {
      createdBy: { select: { id: true, username: true, displayName: true, avatarColor: true, systemRole: true, platformOwner: true, accountType: true } },
      channel: { select: { id: true, name: true, type: true } },
      rsvps: { include: { user: { select: { id: true, username: true, displayName: true, avatarColor: true, systemRole: true, platformOwner: true, accountType: true } } } }
    }
  });
  res.json({ events });
}));

communityRouter.post("/guilds/:guildId/events", requireAuth, asyncHandler(async (req, res) => {
  const guildId = routeParam(req.params.guildId, "guildId");
  const data = eventSchema.parse(req.body);
  await requireGuildCapability(req.auth!.sub, guildId, "manageEvents");
  if (data.channelId) {
    const channel = await prisma.channel.findUnique({ where: { id: data.channelId } });
    if (!channel || channel.guildId !== guildId) throw new HttpError(400, "Canal do evento invalido");
  }
  const event = await prisma.guildEvent.create({ data: { guildId, createdById: req.auth!.sub, title: data.title, description: data.description, location: data.location, channelId: data.channelId ?? null, startsAt: new Date(data.startsAt), endsAt: data.endsAt ? new Date(data.endsAt) : null, capacity: data.capacity ?? null } });
  await writeAudit({ guildId, actorId: req.auth!.sub, action: "EVENT_CREATE", targetType: "EVENT", targetId: event.id, metadata: { title: event.title, startsAt: event.startsAt.toISOString() }, request: req });
  req.app.get("io")?.to?.(`guild:${guildId}`)?.emit?.("event:changed", { guildId, eventId: event.id });
  res.status(201).json({ event });
}));

communityRouter.patch("/events/:eventId", requireAuth, asyncHandler(async (req, res) => {
  const eventId = routeParam(req.params.eventId, "eventId");
  const data = eventPatchSchema.parse(req.body);
  const current = await prisma.guildEvent.findUnique({ where: { id: eventId } });
  if (!current) throw new HttpError(404, "Evento nao encontrado");
  await requireGuildCapability(req.auth!.sub, current.guildId, "manageEvents");

  const nextStartsAt = data.startsAt ? new Date(data.startsAt) : current.startsAt;
  const nextEndsAt = data.endsAt !== undefined ? (data.endsAt ? new Date(data.endsAt) : null) : current.endsAt;
  if (nextEndsAt && nextEndsAt.getTime() <= nextStartsAt.getTime()) {
    throw new HttpError(400, "O termino precisa ser depois do inicio");
  }

  const event = await prisma.guildEvent.update({
    where: { id: eventId },
    data: {
      ...data,
      ...(data.startsAt ? { startsAt: new Date(data.startsAt) } : {}),
      ...(data.endsAt !== undefined ? { endsAt: data.endsAt ? new Date(data.endsAt) : null } : {})
    }
  });
  req.app.get("io")?.to?.(`guild:${current.guildId}`)?.emit?.("event:changed", { guildId: current.guildId, eventId });
  res.json({ event });
}));

communityRouter.post("/events/:eventId/rsvp", requireAuth, asyncHandler(async (req, res) => {
  const eventId = routeParam(req.params.eventId, "eventId");
  const { status } = rsvpSchema.parse(req.body);
  const event = await prisma.guildEvent.findUnique({ where: { id: eventId } });
  if (!event) throw new HttpError(404, "Evento nao encontrado");
  await requireGuildMember(req.auth!.sub, event.guildId);
  if (status === "GOING" && event.capacity) {
    const going = await prisma.guildEventRsvp.count({ where: { eventId, status: "GOING", userId: { not: req.auth!.sub } } });
    if (going >= event.capacity) throw new HttpError(409, "O evento atingiu a capacidade maxima");
  }
  const rsvp = await prisma.guildEventRsvp.upsert({ where: { eventId_userId: { eventId, userId: req.auth!.sub } }, update: { status }, create: { eventId, userId: req.auth!.sub, status } });
  req.app.get("io")?.to?.(`guild:${event.guildId}`)?.emit?.("event:rsvp", { eventId, userId: req.auth!.sub, status });
  res.json({ rsvp });
}));

communityRouter.delete("/events/:eventId", requireAuth, asyncHandler(async (req, res) => {
  const eventId = routeParam(req.params.eventId, "eventId");
  const event = await prisma.guildEvent.findUnique({ where: { id: eventId } });
  if (!event) throw new HttpError(404, "Evento nao encontrado");
  await requireGuildCapability(req.auth!.sub, event.guildId, "manageEvents");
  await prisma.guildEvent.delete({ where: { id: eventId } });
  await writeAudit({ guildId: event.guildId, actorId: req.auth!.sub, action: "EVENT_DELETE", targetType: "EVENT", targetId: eventId, request: req });
  req.app.get("io")?.to?.(`guild:${event.guildId}`)?.emit?.("event:changed", { guildId: event.guildId, eventId, deleted: true });
  res.status(204).end();
}));

communityRouter.get("/events/:eventId/calendar.ics", requireAuth, asyncHandler(async (req, res) => {
  const eventId = routeParam(req.params.eventId, "eventId");
  const event = await prisma.guildEvent.findUnique({ where: { id: eventId }, include: { guild: { select: { name: true } } } });
  if (!event) throw new HttpError(404, "Evento nao encontrado");
  await requireGuildMember(req.auth!.sub, event.guildId);
  const stamp = (date: Date) => date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  const escape = (value: string) => value.replace(/\\/g, "\\\\").replace(/\r\n|\r|\n/g, "\\n").replace(/,/g, "\\,").replace(/;/g, "\\;");
  const body = [
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Ginga//Events//PT-BR", "BEGIN:VEVENT",
    `UID:${event.id}@ginga`, `DTSTAMP:${stamp(new Date())}`, `DTSTART:${stamp(event.startsAt)}`,
    ...(event.endsAt ? [`DTEND:${stamp(event.endsAt)}`] : []),
    `SUMMARY:${escape(event.title)}`, `DESCRIPTION:${escape(event.description)}`, `LOCATION:${escape(event.location || event.guild.name)}`,
    "END:VEVENT", "END:VCALENDAR"
  ].join("\r\n");
  res.type("text/calendar").setHeader("Content-Disposition", `attachment; filename="ginga-event-${event.id}.ics"`).send(body);
}));

communityRouter.get("/guilds/:guildId/automod", requireAuth, asyncHandler(async (req, res) => {
  const guildId = routeParam(req.params.guildId, "guildId");
  await requireGuildCapability(req.auth!.sub, guildId, "manageAutoMod");
  const rules = await prisma.autoModRule.findMany({ where: { guildId }, orderBy: { createdAt: "asc" } });
  res.json({ rules });
}));

communityRouter.post("/guilds/:guildId/automod", requireAuth, asyncHandler(async (req, res) => {
  const guildId = routeParam(req.params.guildId, "guildId");
  const data = automodSchema.parse(req.body);
  await requireGuildCapability(req.auth!.sub, guildId, "manageAutoMod");
  if (data.alertChannelId) {
    const channel = await prisma.channel.findUnique({ where: { id: data.alertChannelId } });
    if (!channel || channel.guildId !== guildId) throw new HttpError(400, "Canal de alerta invalido");
  }
  const rule = await prisma.autoModRule.create({ data: { guildId, ...data } });
  await writeAudit({ guildId, actorId: req.auth!.sub, action: "AUTOMOD_RULE_CREATE", targetType: "AUTOMOD", targetId: rule.id, metadata: { name: rule.name, type: rule.type }, request: req });
  res.status(201).json({ rule });
}));

communityRouter.patch("/automod/:ruleId", requireAuth, asyncHandler(async (req, res) => {
  const ruleId = routeParam(req.params.ruleId, "ruleId");
  const data = automodPatchSchema.parse(req.body);
  const current = await prisma.autoModRule.findUnique({ where: { id: ruleId } });
  if (!current) throw new HttpError(404, "Regra nao encontrada");
  await requireGuildCapability(req.auth!.sub, current.guildId, "manageAutoMod");
  const rule = await prisma.autoModRule.update({ where: { id: ruleId }, data });
  res.json({ rule });
}));

communityRouter.delete("/automod/:ruleId", requireAuth, asyncHandler(async (req, res) => {
  const ruleId = routeParam(req.params.ruleId, "ruleId");
  const rule = await prisma.autoModRule.findUnique({ where: { id: ruleId } });
  if (!rule) throw new HttpError(404, "Regra nao encontrada");
  await requireGuildCapability(req.auth!.sub, rule.guildId, "manageAutoMod");
  await prisma.autoModRule.delete({ where: { id: ruleId } });
  res.status(204).end();
}));

communityRouter.get("/guilds/:guildId/insights", requireAuth, asyncHandler(async (req, res) => {
  const guildId = routeParam(req.params.guildId, "guildId");
  await requireGuildCapability(req.auth!.sub, guildId, "viewAuditLog");
  const now = Date.now();
  const day = new Date(now - 24 * 60 * 60 * 1000);
  const week = new Date(now - 7 * 24 * 60 * 60 * 1000);
  const [members, channels, messages24h, messages7d, forumPosts7d, eventsUpcoming, bans, bots] = await Promise.all([
    prisma.guildMember.count({ where: { guildId } }),
    prisma.channel.count({ where: { guildId } }),
    prisma.message.count({ where: { channel: { guildId }, createdAt: { gte: day } } }),
    prisma.message.count({ where: { channel: { guildId }, createdAt: { gte: week } } }),
    prisma.forumPost.count({ where: { guildId, createdAt: { gte: week } } }),
    prisma.guildEvent.count({ where: { guildId, startsAt: { gte: new Date() } } }),
    prisma.guildBan.count({ where: { guildId, OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] } }),
    prisma.botInstall.count({ where: { guildId } })
  ]);
  res.json({ members, channels, messages24h, messages7d, forumPosts7d, eventsUpcoming, bans, bots });
}));

communityRouter.get("/guilds/:guildId/security-overview", requireAuth, asyncHandler(async (req, res) => {
  const guildId = routeParam(req.params.guildId, "guildId");
  await requireAnyGuildCapability(req.auth!.sub, guildId, ["manageServer", "viewAuditLog", "manageAutoMod"]);

  const now = new Date();
  const [guild, memberCount, enabledAutoModRules, activeUnlimitedInvites, bots, webhooks, privilegedMembers] = await Promise.all([
    prisma.guild.findUnique({ where: { id: guildId }, select: { communityEnabled: true, lockdownEnabled: true, lockdownReason: true, lockdownUpdatedAt: true } }),
    prisma.guildMember.count({ where: { guildId } }),
    prisma.autoModRule.count({ where: { guildId, enabled: true } }),
    prisma.invite.count({ where: { guildId, OR: [{ expiresAt: null }, { expiresAt: { gt: now } }], maxUses: null } }),
    prisma.botInstall.count({ where: { guildId } }),
    prisma.webhook.count({ where: { guildId, enabled: true } }),
    prisma.guildMember.count({ where: { guildId, role: { in: ["OWNER", "ADMIN", "MODERATOR"] } } })
  ]);
  if (!guild) throw new HttpError(404, "Espaco nao encontrado");

  const checks: Array<{ id: string; status: "PASS" | "WARN" | "CRITICAL"; title: string; detail: string; action?: string }> = [];
  let score = 100;
  const add = (id: string, status: "PASS" | "WARN" | "CRITICAL", title: string, detail: string, penalty = 0, action?: string) => {
    score -= penalty;
    checks.push({ id, status, title, detail, ...(action ? { action } : {}) });
  };

  if (enabledAutoModRules > 0) add("automod", "PASS", "AutoMod ativo", `${enabledAutoModRules} regra(s) ajudam a reduzir spam e abuso automaticamente.`);
  else add("automod", guild.communityEnabled ? "CRITICAL" : "WARN", "AutoMod sem regras ativas", guild.communityEnabled ? "Este servidor aparece para a comunidade e ainda nao possui protecao automatica contra spam ou abuso." : "Nao ha regras automaticas para spam, repeticao ou mencoes excessivas.", guild.communityEnabled ? 22 : 12, "Ative pelo menos uma regra contra spam/repeticao e outra para mencoes excessivas.");

  if (activeUnlimitedInvites === 0) add("invites", "PASS", "Convites sob controle", "Nao ha convite permanente e ilimitado ativo neste momento.");
  else add("invites", "WARN", "Convites permanentes ativos", `${activeUnlimitedInvites} convite(s) podem continuar sendo usados sem expiracao ou limite.`, Math.min(18, 6 + activeUnlimitedInvites * 2), "Revogue convites antigos ou use expiracao/limite quando o link nao precisar ser permanente.");

  const privilegedRatio = memberCount > 0 ? privilegedMembers / memberCount : 0;
  if (privilegedMembers <= 4 || privilegedRatio <= 0.12) add("privileged", "PASS", "Equipe administrativa enxuta", `${privilegedMembers} membro(s) possuem permissao elevada.`);
  else add("privileged", "WARN", "Muita gente com permissao elevada", `${privilegedMembers} de ${memberCount} membros possuem cargo de moderacao ou administracao.`, 12, "Revise quem realmente precisa de acesso administrativo.");

  if (bots + webhooks === 0) add("integrations", "PASS", "Sem integracoes externas", "Nenhum bot ou webhook esta conectado ao servidor.");
  else add("integrations", "PASS", "Integracoes conectadas", `${bots} bot(s) e ${webhooks} webhook(s) estao ativos. Revise periodicamente o que ainda e necessario.`);

  if (guild.lockdownEnabled) add("lockdown", "PASS", "Contencao ativa", "O modo de contencao esta bloqueando mensagens e voz de membros comuns ate o incidente terminar.");
  else add("lockdown", "PASS", "Contencao disponivel", "Se houver raid ou spam coordenado, voce pode ativar a contencao imediatamente nesta tela.");

  score = Math.max(0, Math.min(100, score));
  const level = score >= 85 ? "FORTE" : score >= 65 ? "ATENCAO" : "RISCO";
  res.json({
    score,
    level,
    checks,
    metrics: { memberCount, enabledAutoModRules, activeUnlimitedInvites, bots, webhooks, privilegedMembers, communityEnabled: guild.communityEnabled, lockdownEnabled: guild.lockdownEnabled },
    lockdown: { enabled: guild.lockdownEnabled, reason: guild.lockdownReason, updatedAt: guild.lockdownUpdatedAt }
  });
}));

communityRouter.get("/guilds/:guildId/snapshot", requireAuth, asyncHandler(async (req, res) => {
  const guildId = routeParam(req.params.guildId, "guildId");
  await requireGuildCapability(req.auth!.sub, guildId, "manageServer");
  const guild = await prisma.guild.findUnique({
    where: { id: guildId },
    include: {
      categories: { orderBy: { position: "asc" } },
      channels: { orderBy: { position: "asc" } },
      customRoles: { where: { managed: false }, orderBy: { position: "asc" } },
      automodRules: true
    }
  });
  if (!guild) throw new HttpError(404, "Espaco nao encontrado");
  res.json({
    version: 1,
    name: guild.name,
    guild: { description: guild.description, welcomeMessage: guild.welcomeMessage, rules: guild.rules, welcomeChannelSourceId: guild.welcomeChannelId, iconColor: guild.iconColor },
    categories: guild.categories.map((category) => ({ sourceId: category.id, name: category.name, position: category.position })),
    channels: guild.channels.map((channel) => ({ sourceId: channel.id, categorySourceId: channel.categoryId, name: channel.name, type: channel.type, topic: channel.topic, slowModeSeconds: channel.slowModeSeconds, position: channel.position })),
    customRoles: guild.customRoles.map(({ name, color, position, permissions, hoist, mentionable }) => ({ name, color, position, permissions, hoist, mentionable })),
    automodRules: guild.automodRules.map(({ name, type, enabled, blockedTerms, mentionLimit, repetitionLimit, blockMessage }) => ({ name, type, enabled, blockedTerms, mentionLimit, repetitionLimit, blockMessage, alertChannelId: null, exemptRoleIds: [], exemptChannelIds: [] }))
  });
}));

communityRouter.post("/guilds/from-snapshot", requireAuth, asyncHandler(async (req, res) => {
  const snapshot = snapshotSchema.parse(req.body);
  const name = snapshot.name ?? `Copia ${new Date().toLocaleDateString("pt-BR")}`;
  const guild = await prisma.$transaction(async (tx) => {
    const created = await tx.guild.create({
      data: {
        name,
        iconColor: snapshot.guild.iconColor || randomColor(),
        description: snapshot.guild.description,
        welcomeMessage: snapshot.guild.welcomeMessage,
        rules: snapshot.guild.rules,
        ownerId: req.auth!.sub,
        securityPolicyVersion: SECURITY_POLICY_VERSION,
        members: { create: { userId: req.auth!.sub, role: "OWNER" } },
        rolePermissions: {
          create: [
            defaultGuildRolePermissionData("MODERATOR"),
            defaultGuildRolePermissionData("MEMBER")
          ]
        }
      }
    });
    const categoryMap = new Map<string, string>();
    for (const category of snapshot.categories.sort((a, b) => a.position - b.position)) {
      const next = await tx.channelCategory.create({ data: { guildId: created.id, name: category.name, position: category.position } });
      categoryMap.set(category.sourceId, next.id);
    }
    for (const channel of snapshot.channels.sort((a, b) => a.position - b.position)) {
      await tx.channel.create({ data: { guildId: created.id, categoryId: channel.categorySourceId ? categoryMap.get(channel.categorySourceId) ?? null : null, name: channel.name, type: channel.type, topic: channel.topic, slowModeSeconds: channel.slowModeSeconds, position: channel.position } });
    }
    for (const role of snapshot.customRoles.sort((a, b) => a.position - b.position)) {
      await tx.guildCustomRole.create({ data: { guildId: created.id, ...role } });
    }
    for (const rule of snapshot.automodRules) {
      await tx.autoModRule.create({ data: { guildId: created.id, ...rule } });
    }
    if (snapshot.channels.length === 0) await tx.channel.create({ data: { guildId: created.id, name: "geral", type: "TEXT", position: 0 } });
    return created;
  });
  res.status(201).json({ guild });
}));
