import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db.js";
import { asyncHandler, HttpError } from "../errors.js";
import { requireAuth } from "../middleware.js";
import { requirePlatformAdmin } from "../platformAccess.js";
import { routeParam } from "../utils.js";
import { GINGA_VERSION } from "../version.js";
import { listAuthSessions, revokeAllAuthSessions, revokeAuthSession } from "../authSessions.js";
import { isUserOnlineNow } from "../socket.js";

export const platformRouter = Router();

const announcementSchema = z.object({
  title: z.string().trim().min(2).max(120),
  body: z.string().trim().min(1).max(8000),
  severity: z.enum(["INFO", "UPDATE", "WARNING", "CRITICAL"]).default("INFO"),
  published: z.boolean().default(true)
});

const roleSchema = z.object({ systemRole: z.enum(["USER", "DEVELOPER", "PLATFORM_ADMIN"]) });
const userSearchSchema = z.object({ q: z.string().trim().max(80).default("") });
const auditQuerySchema = z.object({ limit: z.coerce.number().int().min(1).max(200).default(100) });
const adminDeleteUserSchema = z.object({ confirmUsername: z.string().trim().min(3).max(24) });
const adminAccountStateSchema = z.object({ disabled: z.boolean(), reason: z.string().trim().max(300).default("") });

platformRouter.get("/platform/admin/announcements", requireAuth, asyncHandler(async (req, res) => {
  await requirePlatformAdmin(req.auth!.sub);
  const announcements = await prisma.platformAnnouncement.findMany({
    orderBy: { createdAt: "desc" },
    take: 100,
    include: { createdBy: { select: { id: true, username: true, displayName: true, avatarColor: true, systemRole: true, platformOwner: true, accountType: true } } }
  });
  res.json({ announcements });
}));

platformRouter.get("/platform/announcements", requireAuth, asyncHandler(async (_req, res) => {
  const announcements = await prisma.platformAnnouncement.findMany({
    where: { published: true },
    orderBy: { createdAt: "desc" },
    take: 50,
    include: { createdBy: { select: { id: true, username: true, displayName: true, avatarColor: true, systemRole: true, platformOwner: true, accountType: true } } }
  });
  res.json({ announcements });
}));

platformRouter.get("/platform/admin/overview", requireAuth, asyncHandler(async (req, res) => {
  await requirePlatformAdmin(req.auth!.sub);
  const [users, humans, bots, guilds, messages, directMessages, webhooks, applications] = await Promise.all([
    prisma.user.count(),
    prisma.user.count({ where: { accountType: "HUMAN" } }),
    prisma.user.count({ where: { accountType: "BOT" } }),
    prisma.guild.count(),
    prisma.message.count(),
    prisma.directMessage.count(),
    prisma.webhook.count(),
    prisma.developerApplication.count()
  ]);
  res.json({ users, humans, bots, guilds, messages, directMessages, webhooks, applications, version: GINGA_VERSION });
}));

platformRouter.get("/platform/admin/users", requireAuth, asyncHandler(async (req, res) => {
  await requirePlatformAdmin(req.auth!.sub);
  const { q } = userSearchSchema.parse(req.query);
  const users = await prisma.user.findMany({
    where: {
      accountType: "HUMAN",
      ...(q ? { OR: [
        { username: { contains: q, mode: "insensitive" } },
        { displayName: { contains: q, mode: "insensitive" } },
        { email: { contains: q, mode: "insensitive" } }
      ] } : {})
    },
    orderBy: { createdAt: "asc" },
    take: 200,
    select: {
      id: true, email: true, username: true, displayName: true, avatarColor: true,
      systemRole: true, platformOwner: true, accountType: true, createdAt: true, lastLoginAt: true,
      accountDisabled: true, accountDisabledAt: true, accountDisabledReason: true
    }
  });
  const twoFactorRows = users.length ? await prisma.$queryRawUnsafe<Array<{ userId: string }>>(
    `SELECT user_id AS "userId" FROM "GingaTwoFactor" WHERE enabled_at IS NOT NULL AND user_id IN (${users.map((_, index) => `$${index + 1}`).join(",")})`,
    ...users.map((user) => user.id)
  ) : [];
  const twoFactorEnabled = new Set(twoFactorRows.map((row) => row.userId));
  res.json({ users: users.map((user) => ({ ...user, online: isUserOnlineNow(user.id), twoFactorEnabled: twoFactorEnabled.has(user.id) })) });
}));

platformRouter.patch("/platform/admin/users/:userId/system-role", requireAuth, asyncHandler(async (req, res) => {
  await requirePlatformAdmin(req.auth!.sub);
  const userId = routeParam(req.params.userId, "userId");
  const { systemRole } = roleSchema.parse(req.body);
  const target = await prisma.user.findUnique({ where: { id: userId } });
  if (!target || target.accountType !== "HUMAN") throw new HttpError(404, "Usuario nao encontrado");

  if (target.platformOwner && systemRole !== "PLATFORM_ADMIN") throw new HttpError(409, "A conta proprietaria global do Ginga nao pode perder o cargo administrativo");

  if (target.systemRole === "PLATFORM_ADMIN" && systemRole !== "PLATFORM_ADMIN") {
    const admins = await prisma.user.count({ where: { accountType: "HUMAN", systemRole: "PLATFORM_ADMIN" } });
    if (admins <= 1) throw new HttpError(409, "O Ginga precisa manter pelo menos um administrador da plataforma");
  }

  const user = await prisma.user.update({ where: { id: userId }, data: { systemRole } });
  await prisma.platformAuditLog.create({
    data: {
      actorId: req.auth!.sub,
      action: "SYSTEM_ROLE_UPDATE",
      targetType: "USER",
      targetId: userId,
      metadata: { from: target.systemRole, to: systemRole }
    }
  });
  res.json({ user: { id: user.id, username: user.username, displayName: user.displayName, systemRole: user.systemRole } });
}));


platformRouter.post("/platform/admin/users/:userId/reset-password", requireAuth, asyncHandler(async (req, res) => {
  await requirePlatformAdmin(req.auth!.sub);
  // Mantido apenas para clientes antigos. Administradores nao podem escolher a senha de outra conta.
  // O fluxo suportado e o link de redefinicao enviado ao proprio e-mail do usuario.
  res.status(410).json({ error: "A redefinicao direta por administrador foi removida. Envie um link seguro de recuperacao para o e-mail da conta." });
}));

platformRouter.post("/platform/admin/users/:userId/revoke-sessions", requireAuth, asyncHandler(async (req, res) => {
  await requirePlatformAdmin(req.auth!.sub);
  const userId = routeParam(req.params.userId, "userId");
  if (userId === req.auth!.sub) throw new HttpError(409, "Use Sair de todos os dispositivos nas configuracoes da sua propria conta");
  const target = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, username: true, accountType: true, platformOwner: true } });
  if (!target || target.accountType !== "HUMAN") throw new HttpError(404, "Usuario nao encontrado");
  if (target.platformOwner) throw new HttpError(403, "As sessoes da conta proprietaria global nao podem ser revogadas por outro administrador");

  await prisma.user.update({ where: { id: userId }, data: { tokenVersion: { increment: 1 } } });
  await revokeAllAuthSessions(userId);
  await prisma.platformAuditLog.create({
    data: { actorId: req.auth!.sub, action: "USER_SESSIONS_REVOKED", targetType: "USER", targetId: userId, metadata: { username: target.username } }
  });
  req.app.get("io")?.in?.(`user:${userId}`)?.disconnectSockets?.(true);
  res.status(204).end();
}));

platformRouter.get("/platform/admin/users/:userId/sessions", requireAuth, asyncHandler(async (req,res)=>{await requirePlatformAdmin(req.auth!.sub);const userId=routeParam(req.params.userId,"userId");const target=await prisma.user.findUnique({where:{id:userId},select:{id:true,accountType:true}});if(!target||target.accountType!=="HUMAN")throw new HttpError(404,"Usuario nao encontrado");res.json({sessions:await listAuthSessions(userId)});}));
platformRouter.delete("/platform/admin/users/:userId/sessions/:sessionId",requireAuth,asyncHandler(async(req,res)=>{await requirePlatformAdmin(req.auth!.sub);const userId=routeParam(req.params.userId,"userId"),sessionId=routeParam(req.params.sessionId,"sessionId");const target=await prisma.user.findUnique({where:{id:userId},select:{id:true,username:true,accountType:true,platformOwner:true}});if(!target||target.accountType!=="HUMAN")throw new HttpError(404,"Usuario nao encontrado");if(target.platformOwner&&userId!==req.auth!.sub)throw new HttpError(403,"Uma sessao da conta proprietaria global nao pode ser encerrada por outro administrador");if(!(await revokeAuthSession(userId,sessionId)))throw new HttpError(404,"Sessao ativa nao encontrada");await prisma.platformAuditLog.create({data:{actorId:req.auth!.sub,action:"USER_SESSION_REVOKED",targetType:"USER_SESSION",targetId:sessionId,metadata:{userId,username:target.username}}});res.status(204).end();}));
platformRouter.patch("/platform/admin/users/:userId/account-state",requireAuth,asyncHandler(async(req,res)=>{await requirePlatformAdmin(req.auth!.sub);const userId=routeParam(req.params.userId,"userId");if(userId===req.auth!.sub)throw new HttpError(409,"Sua propria conta nao pode ser desativada pelo Ginga Control");const {disabled,reason}=adminAccountStateSchema.parse(req.body);const target=await prisma.user.findUnique({where:{id:userId},select:{id:true,username:true,accountType:true,platformOwner:true}});if(!target||target.accountType!=="HUMAN")throw new HttpError(404,"Usuario nao encontrado");if(target.platformOwner&&disabled)throw new HttpError(403,"A conta proprietaria global do Ginga nao pode ser desativada");const user=await prisma.user.update({where:{id:userId},data:{accountDisabled:disabled,accountDisabledAt:disabled?new Date():null,accountDisabledReason:disabled?(reason||"Conta desativada por um administrador do Ginga"):"",...(disabled?{tokenVersion:{increment:1}}:{})},select:{id:true,username:true,accountDisabled:true,accountDisabledAt:true,accountDisabledReason:true}});if(disabled){await revokeAllAuthSessions(userId);req.app.get("io")?.in?.(`user:${userId}`)?.disconnectSockets?.(true);}await prisma.platformAuditLog.create({data:{actorId:req.auth!.sub,action:disabled?"USER_DISABLED":"USER_ENABLED",targetType:"USER",targetId:userId,metadata:{username:target.username,reason:disabled?user.accountDisabledReason:undefined}}});res.json({user});}));
platformRouter.get("/platform/admin/users/:userId/moderation-history",requireAuth,asyncHandler(async(req,res)=>{await requirePlatformAdmin(req.auth!.sub);const userId=routeParam(req.params.userId,"userId");const target=await prisma.user.findUnique({where:{id:userId},select:{id:true,accountType:true}});if(!target||target.accountType!=="HUMAN")throw new HttpError(404,"Usuario nao encontrado");const [logs,activeBans]=await Promise.all([prisma.guildAuditLog.findMany({where:{targetUserId:userId},orderBy:{createdAt:"desc"},take:120,include:{guild:{select:{id:true,name:true}}}}),prisma.guildBan.findMany({where:{userId,OR:[{expiresAt:null},{expiresAt:{gt:new Date()}}]},orderBy:{createdAt:"desc"},include:{guild:{select:{id:true,name:true}},bannedBy:{select:{id:true,username:true,displayName:true,avatarColor:true}}}})]);const actorIds=Array.from(new Set(logs.map(i=>i.actorId).filter((id):id is string=>Boolean(id))));const actors=actorIds.length?await prisma.user.findMany({where:{id:{in:actorIds}},select:{id:true,username:true,displayName:true,avatarColor:true}}):[];const map=new Map(actors.map(a=>[a.id,a]));res.json({logs:logs.map(i=>({...i,actor:i.actorId?map.get(i.actorId)??null:null})),activeBans});}));

platformRouter.delete("/platform/admin/users/:userId", requireAuth, asyncHandler(async (req, res) => {
  await requirePlatformAdmin(req.auth!.sub);
  const userId = routeParam(req.params.userId, "userId");
  if (userId === req.auth!.sub) throw new HttpError(409, "Sua propria conta nao pode ser excluida pelo Ginga Control");
  const { confirmUsername } = adminDeleteUserSchema.parse(req.body);
  const target = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, username: true, displayName: true, accountType: true, platformOwner: true } });
  if (!target || target.accountType !== "HUMAN") throw new HttpError(404, "Usuario nao encontrado");
  if (target.platformOwner) throw new HttpError(403, "A conta proprietaria global do Ginga nao pode ser excluida");
  if (confirmUsername.toLowerCase() !== target.username.toLowerCase()) throw new HttpError(400, `Digite @${target.username} para confirmar a exclusao`);

  const [ownedGuilds, bansIssued, botInstalls, webhooksCreated, announcementsCreated, eventsCreated] = await Promise.all([
    prisma.guild.count({ where: { ownerId: userId } }),
    prisma.guildBan.count({ where: { bannedById: userId } }),
    prisma.botInstall.count({ where: { installedById: userId } }),
    prisma.webhook.count({ where: { createdById: userId } }),
    prisma.platformAnnouncement.count({ where: { createdById: userId } }),
    prisma.guildEvent.count({ where: { createdById: userId } })
  ]);
  const blockers = [
    ownedGuilds ? `${ownedGuilds} servidor(es) em propriedade` : "",
    bansIssued ? `${bansIssued} banimento(s) emitido(s)` : "",
    botInstalls ? `${botInstalls} instalacao(oes) de bot` : "",
    webhooksCreated ? `${webhooksCreated} webhook(s) criado(s)` : "",
    announcementsCreated ? `${announcementsCreated} comunicado(s) publicado(s)` : "",
    eventsCreated ? `${eventsCreated} evento(s) criado(s)` : ""
  ].filter(Boolean);
  if (blockers.length) throw new HttpError(409, `A conta ainda possui vinculos administrativos: ${blockers.join(", ")}. Transfira ou remova esses vinculos antes de excluir.`);

  await prisma.platformAuditLog.create({
    data: { actorId: req.auth!.sub, action: "USER_DELETE", targetType: "USER", targetId: userId, metadata: { username: target.username, displayName: target.displayName } }
  });
  req.app.get("io")?.in?.(`user:${userId}`)?.disconnectSockets?.(true);
  await revokeAllAuthSessions(userId);
  await prisma.$executeRawUnsafe(`DELETE FROM "GingaAuthSession" WHERE user_id=$1`, userId);
  await prisma.$executeRawUnsafe(`DELETE FROM "GingaTwoFactorLoginChallenge" WHERE user_id=$1`, userId);
  await prisma.$executeRawUnsafe(`DELETE FROM "GingaTwoFactor" WHERE user_id=$1`, userId);
  await prisma.user.delete({ where: { id: userId } });
  res.status(204).end();
}));

platformRouter.get("/platform/admin/guilds", requireAuth, asyncHandler(async (req, res) => {
  await requirePlatformAdmin(req.auth!.sub);
  const guilds = await prisma.guild.findMany({
    orderBy: { createdAt: "desc" },
    take: 200,
    include: {
      owner: { select: { id: true, username: true, displayName: true } },
      _count: { select: { members: true, channels: true, bans: true, botInstalls: true } }
    }
  });
  res.json({ guilds });
}));

platformRouter.get("/platform/admin/audit", requireAuth, asyncHandler(async (req, res) => {
  await requirePlatformAdmin(req.auth!.sub);
  const { limit } = auditQuerySchema.parse(req.query);
  const logs = await prisma.platformAuditLog.findMany({
    orderBy: { createdAt: "desc" },
    take: limit,
    include: { actor: { select: { id: true, username: true, displayName: true, avatarColor: true, systemRole: true, platformOwner: true, accountType: true } } }
  });
  res.json({ logs });
}));

platformRouter.post("/platform/admin/announcements", requireAuth, asyncHandler(async (req, res) => {
  await requirePlatformAdmin(req.auth!.sub);
  const data = announcementSchema.parse(req.body);
  const announcement = await prisma.platformAnnouncement.create({
    data: { ...data, createdById: req.auth!.sub },
    include: { createdBy: { select: { id: true, username: true, displayName: true, avatarColor: true, systemRole: true, platformOwner: true, accountType: true } } }
  });
  await prisma.platformAuditLog.create({
    data: { actorId: req.auth!.sub, action: "ANNOUNCEMENT_CREATE", targetType: "ANNOUNCEMENT", targetId: announcement.id }
  });
  req.app.get("io")?.emit?.("platform:announcement", announcement);
  res.status(201).json({ announcement });
}));

platformRouter.patch("/platform/admin/announcements/:announcementId", requireAuth, asyncHandler(async (req, res) => {
  await requirePlatformAdmin(req.auth!.sub);
  const announcementId = routeParam(req.params.announcementId, "announcementId");
  const data = announcementSchema.partial().refine((value) => Object.keys(value).length > 0).parse(req.body);
  const announcement = await prisma.platformAnnouncement.update({ where: { id: announcementId }, data });
  await prisma.platformAuditLog.create({
    data: { actorId: req.auth!.sub, action: "ANNOUNCEMENT_UPDATE", targetType: "ANNOUNCEMENT", targetId: announcementId, metadata: data }
  });
  res.json({ announcement });
}));

platformRouter.delete("/platform/admin/announcements/:announcementId", requireAuth, asyncHandler(async (req, res) => {
  await requirePlatformAdmin(req.auth!.sub);
  const announcementId = routeParam(req.params.announcementId, "announcementId");
  await prisma.platformAnnouncement.delete({ where: { id: announcementId } });
  await prisma.platformAuditLog.create({
    data: { actorId: req.auth!.sub, action: "ANNOUNCEMENT_DELETE", targetType: "ANNOUNCEMENT", targetId: announcementId }
  });
  res.status(204).end();
}));
