import { Prisma } from "@prisma/client";
import { Router, type Request } from "express";
import { z } from "zod";
import { writeAudit } from "../audit.js";
import { prisma } from "../db.js";
import { asyncHandler, HttpError } from "../errors.js";
import { requireAuth } from "../middleware.js";
import { effectiveGuildPermissionsForUser, requireGuildCapability, requireGuildMember, type GuildCapability } from "../permissions.js";
import { routeParam } from "../utils.js";

export const rolesRouter = Router();

const permissionValues = [
  "manageChannels", "manageMessages", "manageMembers", "manageServer", "manageRoles", "kickMembers", "moveMembers", "muteMembers", "deafenMembers", "manageNicknames", "banMembers",
  "viewAuditLog", "createInvites", "manageInvites", "manageWebhooks", "manageBots", "manageEvents", "manageForums",
  "manageAutoMod", "pinMessages", "scheduleMessages", "mentionEveryone", "shareScreen", "useVideo"
] as const;

const roleSchema = z.object({
  name: z.string().trim().min(1).max(48),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).default("#8b93a7"),
  icon: z.string().trim().max(16).default(""),
  description: z.string().trim().max(160).default(""),
  permissions: z.array(z.enum(permissionValues)).max(permissionValues.length).default([]),
  hoist: z.boolean().default(false),
  mentionable: z.boolean().default(false)
});
const rolePatchSchema = roleSchema.partial().refine((value) => Object.keys(value).length > 0);
const roleAssignSchema = z.object({ roleIds: z.array(z.string().min(1)).max(50) });
const reorderSchema = z.object({ items: z.array(z.object({ id: z.string().min(1), position: z.number().int().min(0).max(1000) })).min(1).max(100) });
const overrideSchema = z.object({
  canView: z.boolean().nullable(),
  canSendMessages: z.boolean().nullable(),
  canConnect: z.boolean().nullable()
});

const capabilityField: Record<GuildCapability, string> = {
  manageChannels: "canManageChannels", manageMessages: "canManageMessages", manageMembers: "canManageMembers", manageServer: "canManageServer",
  manageRoles: "canManageRoles", kickMembers: "canKickMembers", moveMembers: "canMoveMembers", muteMembers: "canMuteMembers", deafenMembers: "canDeafenMembers", manageNicknames: "canManageNicknames", banMembers: "canBanMembers", viewAuditLog: "canViewAuditLog",
  createInvites: "canCreateInvites", manageInvites: "canManageInvites", manageWebhooks: "canManageWebhooks", manageBots: "canManageBots",
  manageEvents: "canManageEvents", manageForums: "canManageForums", manageAutoMod: "canManageAutoMod", pinMessages: "canPinMessages",
  scheduleMessages: "canScheduleMessages", mentionEveryone: "canMentionEveryone", shareScreen: "canShareScreen", useVideo: "canUseVideo"
};

async function assertRolePermissionsSubset(userId: string, guildId: string, requested: readonly GuildCapability[]) {
  const { membership, permissions } = await effectiveGuildPermissionsForUser(userId, guildId);
  if (membership.role === "OWNER" || membership.role === "ADMIN") return;
  const denied = requested.filter((key) => !(permissions as unknown as Record<string, boolean>)[capabilityField[key]]);
  if (denied.length) throw new HttpError(403, `Voce nao pode conceder permissoes que nao possui: ${denied.join(", ")}`);
}

const fixedRoleRank = { OWNER: 4, ADMIN: 3, MODERATOR: 2, MEMBER: 1 } as const;

async function highestCustomRolePosition(userId: string, guildId: string) {
  const role = await prisma.guildCustomRole.findFirst({
    where: { guildId, assignments: { some: { userId } } },
    orderBy: [{ position: "desc" }, { createdAt: "asc" }],
    select: { position: true }
  });
  return role?.position ?? -1;
}

async function assertRoleManageableByActor(userId: string, guildId: string, role: { permissions: string[]; position: number }) {
  await assertRolePermissionsSubset(userId, guildId, role.permissions as GuildCapability[]);
  const membership = await requireGuildMember(userId, guildId);
  if (membership.role !== "MEMBER") return;
  const actorPosition = await highestCustomRolePosition(userId, guildId);
  if (actorPosition <= role.position) throw new HttpError(403, "Voce nao pode gerenciar um cargo igual ou superior ao seu");
}

async function assertCanAssignRolesToTarget(actorUserId: string, guildId: string, targetUserId: string) {
  const { membership: actor } = await effectiveGuildPermissionsForUser(actorUserId, guildId);
  const target = await prisma.guildMember.findUnique({ where: { guildId_userId: { guildId, userId: targetUserId } } });
  if (!target) throw new HttpError(404, "Membro nao encontrado");
  // Quem possui manageRoles pode gerenciar os proprios cargos personalizados.
  // As validacoes de cada cargo continuam sendo feitas em assertRoleManageableByActor,
  // evitando que um membro comum conceda a si mesmo permissoes acima das que possui.
  if (actorUserId === targetUserId) return target;
  if (actor.role === "OWNER") return target;

  const actorRank = fixedRoleRank[actor.role];
  const targetRank = fixedRoleRank[target.role];
  if (actorRank < targetRank) throw new HttpError(403, "Voce nao pode alterar cargos de um membro com funcao superior a sua");
  if (actorRank === targetRank) {
    if (actor.role !== "MEMBER" || target.role !== "MEMBER") {
      throw new HttpError(403, "Voce nao pode alterar cargos de um membro com funcao igual a sua");
    }
    const [actorPosition, targetPosition] = await Promise.all([
      highestCustomRolePosition(actorUserId, guildId),
      highestCustomRolePosition(targetUserId, guildId)
    ]);
    if (actorPosition <= targetPosition) throw new HttpError(403, "Voce nao pode alterar cargos de um membro com cargo personalizado igual ou superior ao seu");
  }
  return target;
}

async function assertCanManageUserOverride(actorUserId: string, guildId: string, targetUserId: string) {
  const { membership: actor } = await requireGuildCapability(actorUserId, guildId, "manageRoles");
  const target = await prisma.guildMember.findUnique({ where: { guildId_userId: { guildId, userId: targetUserId } } });
  if (!target) throw new HttpError(404, "Membro nao encontrado");
  if (actorUserId === targetUserId) throw new HttpError(403, "Voce nao pode criar uma excecao de permissao para si mesmo");
  if (actor.role === "OWNER") return target;
  if (fixedRoleRank[actor.role] <= fixedRoleRank[target.role]) throw new HttpError(403, "Voce nao pode alterar permissoes individuais de um membro com funcao igual ou superior a sua");
  return target;
}
function overrideIsEmpty(data: z.infer<typeof overrideSchema>) { return data.canView == null && data.canSendMessages == null && data.canConnect == null; }

function emitGuildStructure(req: Request, guildId: string) {
  req.app.get("io")?.to?.(`guild:${guildId}`)?.emit?.("guild:structure:changed", { guildId, at: new Date().toISOString() });
}

rolesRouter.get("/guilds/:guildId/custom-roles", requireAuth, asyncHandler(async (req, res) => {
  const guildId = routeParam(req.params.guildId, "guildId");
  await requireGuildMember(req.auth!.sub, guildId);
  const roles = await prisma.guildCustomRole.findMany({ where: { guildId }, orderBy: [{ position: "desc" }, { createdAt: "asc" }] });
  res.json({ roles });
}));

rolesRouter.post("/guilds/:guildId/custom-roles", requireAuth, asyncHandler(async (req, res) => {
  const guildId = routeParam(req.params.guildId, "guildId");
  const data = roleSchema.parse(req.body);
  const { membership } = await requireGuildCapability(req.auth!.sub, guildId, "manageRoles");
  await assertRolePermissionsSubset(req.auth!.sub, guildId, data.permissions);
  const role = await (async () => {
    try {
      const max = await prisma.guildCustomRole.aggregate({ where: { guildId }, _max: { position: true } });
      const position = membership.role === "OWNER" || membership.role === "ADMIN"
        ? (max._max.position ?? -1) + 1
        : (await highestCustomRolePosition(req.auth!.sub, guildId)) - 1;
      return await prisma.guildCustomRole.create({ data: { guildId, ...data, position } });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") throw new HttpError(409, "Ja existe um cargo com esse nome");
      if (error instanceof Prisma.PrismaClientKnownRequestError && ["P2021", "P2022"].includes(error.code)) {
        throw new HttpError(503, "A estrutura de cargos ainda nao foi atualizada no banco. Reinicie a API do Ginga e tente novamente.");
      }
      throw error;
    }
  })();
  await writeAudit({ guildId, actorId: req.auth!.sub, action: "CUSTOM_ROLE_CREATE", targetType: "ROLE", targetId: role.id, metadata: { name: role.name, permissions: role.permissions }, request: req });
  emitGuildStructure(req, guildId);
  res.status(201).json({ role });
}));

rolesRouter.patch("/guilds/:guildId/custom-roles/:roleId", requireAuth, asyncHandler(async (req, res) => {
  const guildId = routeParam(req.params.guildId, "guildId");
  const roleId = routeParam(req.params.roleId, "roleId");
  const data = rolePatchSchema.parse(req.body);
  await requireGuildCapability(req.auth!.sub, guildId, "manageRoles");
  const role = await prisma.guildCustomRole.findUnique({ where: { id: roleId } });
  if (!role || role.guildId !== guildId) throw new HttpError(404, "Cargo nao encontrado");
  if (role.managed) throw new HttpError(409, "Este cargo e gerenciado por uma integracao e nao pode ser editado manualmente");
  await assertRoleManageableByActor(req.auth!.sub, guildId, role);
  if (data.permissions) await assertRolePermissionsSubset(req.auth!.sub, guildId, data.permissions);
  const updated = await prisma.guildCustomRole.update({ where: { id: roleId }, data });
  await writeAudit({ guildId, actorId: req.auth!.sub, action: "CUSTOM_ROLE_UPDATE", targetType: "ROLE", targetId: roleId, metadata: data, request: req });
  emitGuildStructure(req, guildId);
  res.json({ role: updated });
}));

rolesRouter.delete("/guilds/:guildId/custom-roles/:roleId", requireAuth, asyncHandler(async (req, res) => {
  const guildId = routeParam(req.params.guildId, "guildId");
  const roleId = routeParam(req.params.roleId, "roleId");
  await requireGuildCapability(req.auth!.sub, guildId, "manageRoles");
  const role = await prisma.guildCustomRole.findUnique({ where: { id: roleId } });
  if (!role || role.guildId !== guildId) throw new HttpError(404, "Cargo nao encontrado");
  if (role.managed) throw new HttpError(409, "Cargo gerenciado por integracao nao pode ser excluido manualmente");
  await assertRoleManageableByActor(req.auth!.sub, guildId, role);
  await prisma.guildCustomRole.delete({ where: { id: roleId } });
  await writeAudit({ guildId, actorId: req.auth!.sub, action: "CUSTOM_ROLE_DELETE", targetType: "ROLE", targetId: roleId, metadata: { name: role.name }, request: req });
  emitGuildStructure(req, guildId);
  res.status(204).end();
}));

rolesRouter.put("/guilds/:guildId/custom-roles/reorder", requireAuth, asyncHandler(async (req, res) => {
  const guildId = routeParam(req.params.guildId, "guildId");
  const data = reorderSchema.parse(req.body);
  const membership = await requireGuildMember(req.auth!.sub, guildId);
  if (membership.role !== "OWNER" && membership.role !== "ADMIN") throw new HttpError(403, "Somente proprietario ou administrador pode reordenar a hierarquia completa de cargos");
  const count = await prisma.guildCustomRole.count({ where: { guildId, id: { in: data.items.map((item) => item.id) } } });
  if (count !== data.items.length) throw new HttpError(400, "Um ou mais cargos nao pertencem ao espaco");
  await prisma.$transaction(data.items.map((item) => prisma.guildCustomRole.update({ where: { id: item.id }, data: { position: item.position } })));
  await writeAudit({ guildId, actorId: req.auth!.sub, action: "CUSTOM_ROLE_REORDER", targetType: "ROLE", metadata: { count: data.items.length }, request: req });
  emitGuildStructure(req, guildId);
  res.status(204).end();
}));

rolesRouter.put("/guilds/:guildId/members/:userId/custom-roles", requireAuth, asyncHandler(async (req, res) => {
  const guildId = routeParam(req.params.guildId, "guildId");
  const userId = routeParam(req.params.userId, "userId");
  const { roleIds } = roleAssignSchema.parse(req.body);
  await requireGuildCapability(req.auth!.sub, guildId, "manageRoles");
  const target = await assertCanAssignRolesToTarget(req.auth!.sub, guildId, userId);
  if (target.role === "OWNER" && userId !== req.auth!.sub) throw new HttpError(403, "O proprietario nao pode ter seus cargos alterados por outro usuario");
  const roles = roleIds.length ? await prisma.guildCustomRole.findMany({ where: { guildId, id: { in: roleIds } } }) : [];
  if (roles.length !== new Set(roleIds).size) throw new HttpError(400, "Um ou mais cargos sao invalidos");
  if (roles.some((role) => role.managed)) throw new HttpError(409, "Cargos gerenciados por integracoes nao podem ser atribuidos manualmente");
  for (const role of roles) await assertRoleManageableByActor(req.auth!.sub, guildId, role);
  await prisma.$transaction(async (tx) => {
    await tx.guildMemberCustomRole.deleteMany({ where: { guildId, userId, role: { managed: false } } });
    if (roles.length) await tx.guildMemberCustomRole.createMany({ data: roles.map((role) => ({ guildId, userId, roleId: role.id })), skipDuplicates: true });
  });
  await writeAudit({ guildId, actorId: req.auth!.sub, action: "MEMBER_CUSTOM_ROLES_UPDATE", targetType: "USER", targetId: userId, targetUserId: userId, metadata: { roleIds }, request: req });
  emitGuildStructure(req, guildId);
  res.status(204).end();
}));

rolesRouter.put("/channels/:channelId/custom-role-permissions/:roleId", requireAuth, asyncHandler(async (req, res) => {
  const channelId = routeParam(req.params.channelId, "channelId");
  const roleId = routeParam(req.params.roleId, "roleId");
  const data = overrideSchema.parse(req.body);
  const [channel, role] = await Promise.all([prisma.channel.findUnique({ where: { id: channelId } }), prisma.guildCustomRole.findUnique({ where: { id: roleId } })]);
  if (!channel || !role || channel.guildId !== role.guildId) throw new HttpError(404, "Canal ou cargo nao encontrado");
  await requireGuildCapability(req.auth!.sub, channel.guildId, "manageRoles");
  await assertRoleManageableByActor(req.auth!.sub, channel.guildId, role);
  const permission = await prisma.channelCustomRolePermission.upsert({
    where: { channelId_roleId: { channelId, roleId } }, update: data, create: { channelId, roleId, ...data }
  });
  await writeAudit({ guildId: channel.guildId, actorId: req.auth!.sub, action: "CHANNEL_CUSTOM_ROLE_PERMISSION_UPDATE", targetType: "CHANNEL", targetId: channelId, metadata: { roleId, ...data }, request: req });
  emitGuildStructure(req, channel.guildId);
  res.json({ permission });
}));

rolesRouter.put("/categories/:categoryId/custom-role-permissions/:roleId", requireAuth, asyncHandler(async (req, res) => {
  const categoryId = routeParam(req.params.categoryId, "categoryId");
  const roleId = routeParam(req.params.roleId, "roleId");
  const data = overrideSchema.parse(req.body);
  const [category, role] = await Promise.all([prisma.channelCategory.findUnique({ where: { id: categoryId } }), prisma.guildCustomRole.findUnique({ where: { id: roleId } })]);
  if (!category || !role || category.guildId !== role.guildId) throw new HttpError(404, "Categoria ou cargo nao encontrado");
  await requireGuildCapability(req.auth!.sub, category.guildId, "manageRoles");
  await assertRoleManageableByActor(req.auth!.sub, category.guildId, role);
  const permission = await prisma.categoryCustomRolePermission.upsert({
    where: { categoryId_roleId: { categoryId, roleId } }, update: data, create: { categoryId, roleId, ...data }
  });
  await writeAudit({ guildId: category.guildId, actorId: req.auth!.sub, action: "CATEGORY_CUSTOM_ROLE_PERMISSION_UPDATE", targetType: "CATEGORY", targetId: categoryId, metadata: { roleId, ...data }, request: req });
  emitGuildStructure(req, category.guildId);
  res.json({ permission });
}));

rolesRouter.get("/channels/:channelId/user-permissions/:targetUserId", requireAuth, asyncHandler(async (req, res) => {
  const channelId = routeParam(req.params.channelId, "channelId"), targetUserId = routeParam(req.params.targetUserId, "targetUserId");
  const channel = await prisma.channel.findUnique({ where: { id: channelId } }); if (!channel) throw new HttpError(404, "Canal nao encontrado");
  await requireGuildCapability(req.auth!.sub, channel.guildId, "manageRoles"); await requireGuildMember(targetUserId, channel.guildId);
  res.json({ permission: await prisma.channelUserPermission.findUnique({ where: { channelId_userId: { channelId, userId: targetUserId } } }) });
}));
rolesRouter.put("/channels/:channelId/user-permissions/:targetUserId", requireAuth, asyncHandler(async (req, res) => {
  const channelId = routeParam(req.params.channelId, "channelId"), targetUserId = routeParam(req.params.targetUserId, "targetUserId"), data = overrideSchema.parse(req.body);
  const channel = await prisma.channel.findUnique({ where: { id: channelId } }); if (!channel) throw new HttpError(404, "Canal nao encontrado"); await assertCanManageUserOverride(req.auth!.sub, channel.guildId, targetUserId);
  if (overrideIsEmpty(data)) { await prisma.channelUserPermission.deleteMany({ where: { channelId, userId: targetUserId } }); await writeAudit({ guildId: channel.guildId, actorId:req.auth!.sub, action:"CHANNEL_USER_PERMISSION_CLEAR", targetType:"CHANNEL", targetId:channelId, targetUserId, request:req }); emitGuildStructure(req, channel.guildId); return res.json({permission:null}); }
  const permission=await prisma.channelUserPermission.upsert({where:{channelId_userId:{channelId,userId:targetUserId}},update:data,create:{channelId,userId:targetUserId,...data}}); await writeAudit({guildId:channel.guildId,actorId:req.auth!.sub,action:"CHANNEL_USER_PERMISSION_UPDATE",targetType:"CHANNEL",targetId:channelId,targetUserId,metadata:data,request:req}); emitGuildStructure(req, channel.guildId); res.json({permission});
}));
rolesRouter.get("/categories/:categoryId/user-permissions/:targetUserId", requireAuth, asyncHandler(async (req,res)=>{const categoryId=routeParam(req.params.categoryId,"categoryId"),targetUserId=routeParam(req.params.targetUserId,"targetUserId");const category=await prisma.channelCategory.findUnique({where:{id:categoryId}});if(!category)throw new HttpError(404,"Categoria nao encontrada");await requireGuildCapability(req.auth!.sub,category.guildId,"manageRoles");await requireGuildMember(targetUserId,category.guildId);res.json({permission:await prisma.categoryUserPermission.findUnique({where:{categoryId_userId:{categoryId,userId:targetUserId}}})});}));
rolesRouter.put("/categories/:categoryId/user-permissions/:targetUserId", requireAuth, asyncHandler(async (req,res)=>{const categoryId=routeParam(req.params.categoryId,"categoryId"),targetUserId=routeParam(req.params.targetUserId,"targetUserId"),data=overrideSchema.parse(req.body);const category=await prisma.channelCategory.findUnique({where:{id:categoryId}});if(!category)throw new HttpError(404,"Categoria nao encontrada");await assertCanManageUserOverride(req.auth!.sub,category.guildId,targetUserId);if(overrideIsEmpty(data)){await prisma.categoryUserPermission.deleteMany({where:{categoryId,userId:targetUserId}});await writeAudit({guildId:category.guildId,actorId:req.auth!.sub,action:"CATEGORY_USER_PERMISSION_CLEAR",targetType:"CATEGORY",targetId:categoryId,targetUserId,request:req});emitGuildStructure(req, category.guildId);return res.json({permission:null});}const permission=await prisma.categoryUserPermission.upsert({where:{categoryId_userId:{categoryId,userId:targetUserId}},update:data,create:{categoryId,userId:targetUserId,...data}});await writeAudit({guildId:category.guildId,actorId:req.auth!.sub,action:"CATEGORY_USER_PERMISSION_UPDATE",targetType:"CATEGORY",targetId:categoryId,targetUserId,metadata:data,request:req});emitGuildStructure(req, category.guildId);res.json({permission});}));

rolesRouter.get("/guilds/:guildId/permission-preview/:userId", requireAuth, asyncHandler(async (req, res) => {
  const guildId = routeParam(req.params.guildId, "guildId");
  const userId = routeParam(req.params.userId, "userId");
  await requireGuildCapability(req.auth!.sub, guildId, "manageRoles");
  const { membership, permissions } = await effectiveGuildPermissionsForUser(userId, guildId);
  const channels = await prisma.channel.findMany({ where: { guildId }, select: { id: true, name: true, type: true } });
  const visibleChannels: typeof channels = [];
  for (const channel of channels) {
    try {
      const { requireChannelCapability } = await import("../permissions.js");
      await requireChannelCapability(userId, channel.id, "view");
      visibleChannels.push(channel);
    } catch {
      // O preview precisa mostrar apenas o que seria visivel para o membro.
    }
  }
  const customRoles = await prisma.guildMemberCustomRole.findMany({ where: { guildId, userId }, include: { role: true } });
  res.json({ membership, permissions, customRoles: customRoles.map((item) => item.role), visibleChannels });
}));
