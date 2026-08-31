import { Prisma, type GuildRole } from "@prisma/client";
import { Router, raw, type Request } from "express";
import { z } from "zod";
import { writeAudit } from "../audit.js";
import { prisma } from "../db.js";
import { asyncHandler, HttpError } from "../errors.js";
import { requireAuth } from "../middleware.js";
import { removeUserFromGuildMedia } from "../mediaAdmin.js";
import {
  defaultGuildRolePermissionData,
  effectiveGuildPermissions,
  effectiveGuildPermissionsForUser,
  requireAnyGuildCapability,
  requireGuildCapability,
  requireGuildManager,
  requireGuildMember,
  requireModerationTarget,
  requireModerationTargetAny,
  roleCanManageRole
} from "../permissions.js";
import { inviteCode, randomColor, routeParam } from "../utils.js";
import { SECURITY_POLICY_VERSION } from "../security.js";
import { getServerTemplate, publicServerTemplates } from "../serverTemplates.js";
import { DEFAULT_GUILD_APPEARANCE, guildAppearance, guildAppearanceMap, guildBannerBlob, guildBannerUrl, guildBannerUrlMap, guildIconBlob, guildIconUrl, guildIconUrlMap, removeGuildBanner, removeGuildIcon, saveGuildAppearance, saveGuildBanner, saveGuildIcon, type GuildImageMime } from "../guildAppearance.js";
import { postGuildMemberSystemMessage } from "../guildSystemMessages.js";
import { checkGuildJoinSecurity } from "../v090Security.js";
import { reasonableGifDimensions, signatureMatches } from "../fileValidation.js";

export const guildsRouter = Router();

const GUILD_IMAGE_MIMES = ["image/webp", "image/gif"] as const;

function guildImageMime(req: Request): GuildImageMime {
  const mime = String(req.headers["content-type"] || "").split(";", 1)[0]!.trim().toLowerCase();
  if (!(GUILD_IMAGE_MIMES as readonly string[]).includes(mime)) throw new HttpError(415, "Use WebP ou GIF para esta imagem");
  return mime as GuildImageMime;
}

const createGuildSchema = z.object({ name: z.string().trim().min(2).max(64), templateId: z.string().trim().max(32).optional().default("basic") });
const guildAppearanceSchema = z.object({
  accentColor: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  secondaryColor: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  sidebarStyle: z.enum(["SOLID", "TINTED", "GLASS"]),
  bannerPosition: z.number().int().min(0).max(100),
  channelDensity: z.enum(["COMPACT", "COZY"]),
  showBannerInSidebar: z.boolean()
}).strict();
const updateGuildSchema = z.object({
  name: z.string().trim().min(2).max(64).optional(),
  iconColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  description: z.string().trim().max(240).optional(),
  welcomeMessage: z.string().trim().max(240).optional(),
  rules: z.string().trim().max(8000).optional(),
  welcomeChannelId: z.string().min(1).nullable().optional(),
  memberJoinMessagesEnabled: z.boolean().optional(),
  memberLeaveMessagesEnabled: z.boolean().optional(),
  memberSystemMessageChannelId: z.string().min(1).nullable().optional(),
  afkEnabled: z.boolean().optional(),
  afkTimeoutMinutes: z.number().int().min(5).max(120).optional(),
  communityEnabled: z.boolean().optional(),
  communityTags: z.array(z.string().trim().min(1).max(24)).max(6).optional(),
  communityCategory: z.string().trim().min(1).max(32).optional()
}).refine((value) => Object.keys(value).length > 0, { message: "Nenhuma alteracao informada" });
const createChannelSchema = z.object({
  name: z.string().trim().min(1).max(48),
  type: z.enum(["TEXT", "VOICE", "ANNOUNCEMENT", "FORUM", "EVENT"]),
  categoryId: z.string().min(1).nullable().optional(),
  topic: z.string().trim().max(1024).default(""),
  slowModeSeconds: z.number().int().min(0).max(21600).default(0)
});
const updateChannelSchema = z.object({
  name: z.string().trim().min(1).max(48).optional(),
  position: z.number().int().min(0).max(10000).optional(),
  categoryId: z.string().min(1).nullable().optional(),
  syncPermissionsWithCategory: z.boolean().optional(),
  topic: z.string().trim().max(1024).optional(),
  slowModeSeconds: z.number().int().min(0).max(21600).optional()
}).refine((value) => Object.keys(value).length > 0, { message: "Nenhuma alteracao informada" });
const createCategorySchema = z.object({ name: z.string().trim().min(1).max(48) });
const updateCategorySchema = z.object({
  name: z.string().trim().min(1).max(48).optional(),
  position: z.number().int().min(0).max(10000).optional()
}).refine((value) => Object.keys(value).length > 0, { message: "Nenhuma alteracao informada" });
const reorderChannelsSchema = z.object({
  items: z.array(z.object({
    id: z.string().min(1),
    categoryId: z.string().min(1).nullable(),
    position: z.number().int().min(0).max(10000)
  })).min(1).max(300)
});
const reorderCategoriesSchema = z.object({
  items: z.array(z.object({ id: z.string().min(1), position: z.number().int().min(0).max(10000) })).min(1).max(100)
});
const inviteOptionsSchema = z.object({
  expiresInMinutes: z.number().int().min(30).max(60 * 24 * 30).nullable().optional(),
  expiresInHours: z.number().int().min(1).max(24 * 30).nullable().optional(),
  maxUses: z.number().int().min(1).max(10000).nullable().optional()
});
const memberRoleSchema = z.object({ role: z.enum(["ADMIN", "MODERATOR", "MEMBER"]) });
const channelPermissionSchema = z.object({
  canView: z.boolean(),
  canSendMessages: z.boolean(),
  canConnect: z.boolean()
});
const guildRolePermissionSchema = z.object({
  canManageChannels: z.boolean(),
  canManageMessages: z.boolean(),
  canManageMembers: z.boolean(),
  canManageServer: z.boolean(),
  canManageRoles: z.boolean(),
  canKickMembers: z.boolean(),
  canMoveMembers: z.boolean(),
  canMuteMembers: z.boolean(),
  canDeafenMembers: z.boolean(),
  canManageNicknames: z.boolean(),
  canBanMembers: z.boolean(),
  canViewAuditLog: z.boolean(),
  canCreateInvites: z.boolean(),
  canManageInvites: z.boolean(),
  canManageWebhooks: z.boolean(),
  canManageBots: z.boolean(),
  canManageEvents: z.boolean(),
  canManageForums: z.boolean(),
  canManageAutoMod: z.boolean(),
  canPinMessages: z.boolean(),
  canScheduleMessages: z.boolean(),
  canMentionEveryone: z.boolean(),
  canShareScreen: z.boolean(),
  canUseVideo: z.boolean()
});
const banSchema = z.object({
  duration: z.enum(["PERMANENT", "1H", "24H", "7D", "30D"]).default("PERMANENT"),
  reason: z.string().trim().max(500).default(""),
  deleteMessageMinutes: z.number().int().min(0).max(60 * 24 * 7).default(0)
});
const timeoutMemberSchema = z.object({
  durationMinutes: z.number().int().min(1).max(60 * 24 * 28),
  reason: z.string().trim().max(300).default("")
});
const kickMemberSchema = z.object({ reason: z.string().trim().max(500).default("") });
const nicknameSchema = z.object({ nickname: z.string().trim().max(32).default("") });
const voiceModerationSchema = z.object({
  muted: z.boolean().optional(),
  deafened: z.boolean().optional()
}).refine((value) => typeof value.muted === "boolean" || typeof value.deafened === "boolean", { message: "Informe mute ou ensurdecimento" });
const lockdownSchema = z.object({
  enabled: z.boolean(),
  reason: z.string().trim().max(160).default("")
});
const auditQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(80),
  before: z.string().datetime().optional(),
  action: z.string().trim().min(1).max(80).optional(),
  actorId: z.string().trim().min(1).optional(),
  targetUserId: z.string().trim().min(1).optional()
});
const permissionRoleSchema = z.enum(["MODERATOR", "MEMBER"]);
const deleteGuildSchema = z.object({ confirmation: z.literal("EXCLUIR") });

function emitGuildStructure(req: Request, guildId: string) {
  const io = req.app.get("io");
  io?.to?.(`guild:${guildId}`)?.emit?.("guild:structure:changed", { guildId, at: new Date().toISOString() });
}

function emitModeration(req: Request, guildId: string, userId: string, action: "KICK" | "BAN") {
  const io = req.app.get("io");
  io?.to?.(`user:${userId}`)?.emit?.("guild:moderation", { guildId, action, at: new Date().toISOString() });
}

function removeUserFromKnownGuildSocketRooms(req: Request, guildId: string, userId: string, channelIds: readonly string[]) {
  const io = req.app.get("io");
  if (!io?.in) return;
  const rooms = [`guild:${guildId}`, ...channelIds.map((channelId) => `channel:${channelId}`)];
  io.in(`user:${userId}`).socketsLeave?.(rooms);
}

async function removeUserFromGuildSocketRooms(req: Request, guildId: string, userId: string) {
  const channels = await prisma.channel.findMany({ where: { guildId }, select: { id: true } });
  removeUserFromKnownGuildSocketRooms(req, guildId, userId, channels.map((channel) => channel.id));
}

function removeUserFromLogicalGuildVoice(req: Request, guildId: string, userId: string, reason: string) {
  const io = req.app.get("io") as { gingaRemoveUserFromGuildVoice?: (guildId: string, userId: string, reason?: string) => boolean } | undefined;
  try { return Boolean(io?.gingaRemoveUserFromGuildVoice?.(guildId, userId, reason)); } catch { return false; }
}

function banExpiresAt(duration: "PERMANENT" | "1H" | "24H" | "7D" | "30D") {
  if (duration === "PERMANENT") return null;
  const hours = duration === "1H" ? 1 : duration === "24H" ? 24 : duration === "7D" ? 24 * 7 : 24 * 30;
  return new Date(Date.now() + hours * 60 * 60 * 1000);
}

function categoryPermissionForRole(category: { permissions: Array<{ role: GuildRole; canView: boolean }> } | null, role: GuildRole) {
  if (!category) return null;
  return category.permissions.find((permission) => permission.role === role) ?? null;
}

function customViewOverride(
  overrides: Array<{ roleId: string; canView: boolean | null }>,
  roleIds: Set<string>
) {
  const relevant = overrides.filter((override) => roleIds.has(override.roleId));
  // Ginga adota deny explicito como prioridade entre cargos personalizados.
  // Isso evita que um cargo permissivo reabra acidentalmente uma area sensivel.
  if (relevant.some((override) => override.canView === false)) return false;
  if (relevant.some((override) => override.canView === true)) return true;
  return null;
}

function channelVisibleToRole(channel: {
  syncPermissionsWithCategory: boolean;
  permissions: Array<{ role: GuildRole; canView: boolean }>;
  customRolePermissions: Array<{ roleId: string; canView: boolean | null }>;
  userPermissions: Array<{ userId: string; canView: boolean | null }>;
  category: null | {
    permissions: Array<{ role: GuildRole; canView: boolean }>;
    customRolePermissions: Array<{ roleId: string; canView: boolean | null }>;
    userPermissions: Array<{ userId: string; canView: boolean | null }>;
  };
}, role: GuildRole, roleIds: Set<string>, userId: string) {
  if (role === "OWNER" || role === "ADMIN") return true;
  const permission = channel.category && channel.syncPermissionsWithCategory
    ? categoryPermissionForRole(channel.category, role)
    : channel.permissions.find((item) => item.role === role) ?? null;
  let visible = permission?.canView ?? true;
  const customSource = channel.category && channel.syncPermissionsWithCategory
    ? channel.category.customRolePermissions
    : channel.customRolePermissions;
  const override = customViewOverride(customSource, roleIds);
  if (override !== null) visible = override;
  const individualSource = channel.category && channel.syncPermissionsWithCategory ? channel.category.userPermissions : channel.userPermissions;
  const individual = individualSource.find((item) => item.userId === userId);
  if (individual?.canView !== null && individual?.canView !== undefined) visible = individual.canView;
  return visible;
}

function categoryVisibleToRole(category: {
  permissions: Array<{ role: GuildRole; canView: boolean }>;
  customRolePermissions: Array<{ roleId: string; canView: boolean | null }>;
  userPermissions: Array<{ userId: string; canView: boolean | null }>;
}, role: GuildRole, roleIds: Set<string>, userId: string) {
  if (role === "OWNER" || role === "ADMIN") return true;
  let visible = category.permissions.find((permission) => permission.role === role)?.canView ?? true;
  const override = customViewOverride(category.customRolePermissions, roleIds);
  if (override !== null) visible = override;
  const individual = category.userPermissions.find((item) => item.userId === userId);
  if (individual?.canView !== null && individual?.canView !== undefined) visible = individual.canView;
  return visible;
}

async function ensureCategoryBelongsToGuild(guildId: string, categoryId: string | null | undefined) {
  if (!categoryId) return;
  const category = await prisma.channelCategory.findUnique({ where: { id: categoryId }, select: { guildId: true } });
  if (!category || category.guildId !== guildId) throw new HttpError(400, "Categoria invalida para este espaco");
}

guildsRouter.get("/guilds", requireAuth, asyncHandler(async (req, res) => {
  const memberships = await prisma.guildMember.findMany({
    where: { userId: req.auth!.sub },
    orderBy: { joinedAt: "asc" },
    include: {
      guild: {
        include: {
          rolePermissions: true,
          categories: {
            orderBy: [{ position: "asc" }, { createdAt: "asc" }],
            include: { permissions: true, customRolePermissions: true, userPermissions: true }
          },
          channels: {
            orderBy: [{ position: "asc" }, { createdAt: "asc" }],
            include: {
              permissions: true,
              customRolePermissions: true,
              userPermissions: true,
              category: { include: { permissions: true, customRolePermissions: true, userPermissions: true } }
            }
          },
          _count: { select: { members: true } }
        }
      }
    }
  });

  const assignments = await prisma.guildMemberCustomRole.findMany({
    where: { userId: req.auth!.sub },
    select: { guildId: true, roleId: true }
  });
  const guildIds = memberships.map((item) => item.guild.id);
  const [iconUrls, bannerUrls, appearances] = await Promise.all([guildIconUrlMap(guildIds), guildBannerUrlMap(guildIds), guildAppearanceMap(guildIds, new Map(memberships.map(({ guild }) => [guild.id, guild.iconColor])))]);
  const roleIdsByGuild = new Map<string, Set<string>>();
  for (const assignment of assignments) {
    const ids = roleIdsByGuild.get(assignment.guildId) ?? new Set<string>();
    ids.add(assignment.roleId);
    roleIdsByGuild.set(assignment.guildId, ids);
  }

  const guilds = await Promise.all(memberships.map(async ({ role, guild }) => {
    const roleIds = roleIdsByGuild.get(guild.id) ?? new Set<string>();
    return {
      id: guild.id,
      name: guild.name,
      iconColor: guild.iconColor,
      iconUrl: iconUrls.get(guild.id) ?? null,
      bannerUrl: bannerUrls.get(guild.id) ?? null,
      appearance: appearances.get(guild.id) ?? { ...DEFAULT_GUILD_APPEARANCE, accentColor: guild.iconColor },
      description: guild.description,
      welcomeMessage: guild.welcomeMessage,
      rules: guild.rules,
      welcomeChannelId: guild.welcomeChannelId,
      memberJoinMessagesEnabled: guild.memberJoinMessagesEnabled,
      memberLeaveMessagesEnabled: guild.memberLeaveMessagesEnabled,
      memberSystemMessageChannelId: guild.memberSystemMessageChannelId,
      afkEnabled: guild.afkEnabled,
      afkChannelId: guild.afkChannelId,
      afkTimeoutMinutes: guild.afkTimeoutMinutes,
      communityEnabled: guild.communityEnabled,
      communityTags: guild.communityTags,
      communityCategory: guild.communityCategory,
      musicEnabled: guild.musicEnabled,
      musicAllowMembers: guild.musicAllowMembers,
      musicDefaultVolume: guild.musicDefaultVolume,
      musicDefaultVoiceChannelId: guild.musicDefaultVoiceChannelId,
      ownerId: guild.ownerId,
      role,
      permissions: (await effectiveGuildPermissionsForUser(req.auth!.sub, guild.id)).permissions,
      memberCount: guild._count.members,
      categories: guild.categories
        .filter((category) => categoryVisibleToRole(category, role, roleIds, req.auth!.sub))
        .map(({ permissions: _permissions, customRolePermissions: _customRolePermissions, userPermissions: _userPermissions, ...category }) => category),
      channels: guild.channels
        .filter((channel) => channelVisibleToRole(channel, role, roleIds, req.auth!.sub))
        .map(({ permissions: _permissions, customRolePermissions: _customRolePermissions, userPermissions: _userPermissions, category: _category, ...channel }) => channel)
    };
  }));

  res.json({ guilds });
}));

guildsRouter.get("/guild-templates", requireAuth, asyncHandler(async (_req, res) => {
  res.json({ templates: publicServerTemplates() });
}));

guildsRouter.post("/guilds", requireAuth, asyncHandler(async (req, res) => {
  const { name, templateId } = createGuildSchema.parse(req.body);
  const userId = req.auth!.sub;
  const template = getServerTemplate(templateId);

  const guildId = await prisma.$transaction(async (tx) => {
    const guild = await tx.guild.create({
      data: {
        name,
        iconColor: template.accent || randomColor(),
        ownerId: userId,
        securityPolicyVersion: SECURITY_POLICY_VERSION,
        members: { create: { userId, role: "OWNER" } },
        rolePermissions: {
          create: [
            defaultGuildRolePermissionData("MODERATOR"),
            defaultGuildRolePermissionData("MEMBER")
          ]
        }
      }
    });

    const categoryMap = new Map<string, string>();
    for (const category of [...template.categories].sort((a, b) => a.position - b.position)) {
      const created = await tx.channelCategory.create({
        data: {
          guildId: guild.id,
          name: category.name,
          position: category.position,
          permissions: {
            create: [
              { role: "MODERATOR", canView: true, canSendMessages: true, canConnect: true },
              { role: "MEMBER", canView: true, canSendMessages: true, canConnect: true }
            ]
          }
        }
      });
      categoryMap.set(category.key, created.id);
    }

    for (const channel of [...template.channels].sort((a, b) => a.position - b.position)) {
      await tx.channel.create({
        data: {
          guildId: guild.id,
          categoryId: channel.categoryKey ? categoryMap.get(channel.categoryKey) ?? null : null,
          name: channel.name,
          type: channel.type,
          topic: channel.topic ?? "",
          position: channel.position
        }
      });
    }

    for (const role of [...template.roles].sort((a, b) => a.position - b.position)) {
      await tx.guildCustomRole.create({
        data: {
          guildId: guild.id,
          name: role.name,
          color: role.color,
          icon: role.icon ?? "",
          description: role.description ?? "",
          position: role.position,
          permissions: role.permissions,
          hoist: Boolean(role.hoist),
          mentionable: Boolean(role.mentionable)
        }
      });
    }

    if (template.channels.length === 0) {
      await tx.channel.create({ data: { guildId: guild.id, name: "geral", type: "TEXT", position: 0 } });
    }
    return guild.id;
  });

  const membership = await prisma.guildMember.findUniqueOrThrow({ where: { guildId_userId: { guildId, userId } } });
  const guild = await prisma.guild.findUniqueOrThrow({
    where: { id: guildId },
    include: {
      categories: { orderBy: { position: "asc" } },
      channels: { orderBy: { position: "asc" } },
      _count: { select: { members: true } }
    }
  });

  res.status(201).json({
    guild: {
      id: guild.id,
      name: guild.name,
      iconColor: guild.iconColor,
      iconUrl: await guildIconUrl(guild.id),
      bannerUrl: await guildBannerUrl(guild.id),
      appearance: await guildAppearance(guild.id, guild.iconColor),
      description: guild.description,
      welcomeMessage: guild.welcomeMessage,
      rules: guild.rules,
      welcomeChannelId: guild.welcomeChannelId,
      memberJoinMessagesEnabled: guild.memberJoinMessagesEnabled,
      memberLeaveMessagesEnabled: guild.memberLeaveMessagesEnabled,
      memberSystemMessageChannelId: guild.memberSystemMessageChannelId,
      afkEnabled: guild.afkEnabled,
      afkChannelId: guild.afkChannelId,
      afkTimeoutMinutes: guild.afkTimeoutMinutes,
      communityEnabled: guild.communityEnabled,
      communityTags: guild.communityTags,
      communityCategory: guild.communityCategory,
      ownerId: guild.ownerId,
      role: membership.role,
      permissions: (await effectiveGuildPermissionsForUser(userId, guild.id)).permissions,
      memberCount: guild._count.members,
      categories: guild.categories,
      channels: guild.channels
    }
  });
}));

guildsRouter.patch("/guilds/:guildId/appearance", requireAuth, asyncHandler(async (req, res) => {
  const guildId = routeParam(req.params.guildId, "guildId");
  const data = guildAppearanceSchema.parse(req.body);
  await requireGuildCapability(req.auth!.sub, guildId, "manageServer");
  const appearance = await saveGuildAppearance(guildId, data);
  await writeAudit({ guildId, actorId: req.auth!.sub, action: "GUILD_APPEARANCE_UPDATE", targetType: "GUILD", targetId: guildId, metadata: data, request: req });
  emitGuildStructure(req, guildId);
  res.json({ appearance });
}));

guildsRouter.get("/guilds/:guildId/icon/:etag", asyncHandler(async (req, res) => {
  const guildId = routeParam(req.params.guildId, "guildId");
  const etag = routeParam(req.params.etag, "etag").replace(/\.(?:webp|gif)$/i, "");
  const icon = await guildIconBlob(guildId, etag);
  if (!icon?.icon_blob) throw new HttpError(404, "Icone do servidor nao encontrado");
  res.setHeader("Content-Type", icon.icon_mime || "image/webp");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Content-Disposition", "inline");
  res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
  res.setHeader("ETag", `"${etag}"`);
  res.send(Buffer.from(icon.icon_blob));
}));

guildsRouter.post(
  "/guilds/:guildId/icon",
  requireAuth,
  raw({ type: ["image/webp", "image/gif"], limit: "8mb" }),
  asyncHandler(async (req, res) => {
    const guildId = routeParam(req.params.guildId, "guildId");
    await requireGuildManager(req.auth!.sub, guildId);
    const body = req.body;
    if (!Buffer.isBuffer(body) || body.length < 16) throw new HttpError(400, "Icone do servidor invalido");
    if (body.length > 8 * 1024 * 1024) throw new HttpError(413, "Icone muito grande. Limite: 8 MB");
    const mime = guildImageMime(req);
    if (!signatureMatches(mime, body)) throw new HttpError(415, "O conteudo do icone nao corresponde ao tipo informado");
    if (mime === "image/gif" && !reasonableGifDimensions(body)) throw new HttpError(415, "GIF invalido ou com resolucao grande demais");
    const icon = await saveGuildIcon(guildId, body, mime);
    await writeAudit({ guildId, actorId: req.auth!.sub, action: "GUILD_ICON_UPDATE", targetType: "GUILD", targetId: guildId, metadata: { mime, size: body.length }, request: req });
    emitGuildStructure(req, guildId);
    res.json(icon);
  })
);

guildsRouter.delete("/guilds/:guildId/icon", requireAuth, asyncHandler(async (req, res) => {
  const guildId = routeParam(req.params.guildId, "guildId");
  await requireGuildManager(req.auth!.sub, guildId);
  await removeGuildIcon(guildId);
  await writeAudit({ guildId, actorId: req.auth!.sub, action: "GUILD_ICON_REMOVE", targetType: "GUILD", targetId: guildId, request: req });
  emitGuildStructure(req, guildId);
  res.status(204).end();
}));

guildsRouter.get("/guilds/:guildId/banner/:etag", asyncHandler(async (req,res)=>{const guildId=routeParam(req.params.guildId,"guildId"),etag=routeParam(req.params.etag,"etag").replace(/\.(?:webp|gif)$/i,"");const banner=await guildBannerBlob(guildId,etag);if(!banner?.banner_blob)throw new HttpError(404,"Banner do servidor nao encontrado");res.setHeader("Content-Type",banner.banner_mime||"image/webp");res.setHeader("X-Content-Type-Options","nosniff");res.setHeader("Content-Disposition","inline");res.setHeader("Cache-Control","public, max-age=31536000, immutable");res.setHeader("ETag",`"${etag}"`);res.send(Buffer.from(banner.banner_blob));}));
guildsRouter.post("/guilds/:guildId/banner",requireAuth,raw({type:["image/webp","image/gif"],limit:"12mb"}),asyncHandler(async(req,res)=>{const guildId=routeParam(req.params.guildId,"guildId");await requireGuildManager(req.auth!.sub,guildId);const body=req.body;if(!Buffer.isBuffer(body)||body.length<16)throw new HttpError(400,"Banner do servidor invalido");if(body.length>12*1024*1024)throw new HttpError(413,"Banner muito grande. Limite: 12 MB");const mime=guildImageMime(req);if(!signatureMatches(mime,body))throw new HttpError(415,"O conteudo do banner nao corresponde ao tipo informado");if(mime==="image/gif"&&!reasonableGifDimensions(body))throw new HttpError(415,"GIF invalido ou com resolucao grande demais");const banner=await saveGuildBanner(guildId,body,mime);await writeAudit({guildId,actorId:req.auth!.sub,action:"GUILD_BANNER_UPDATE",targetType:"GUILD",targetId:guildId,metadata:{mime,size:body.length},request:req});emitGuildStructure(req,guildId);res.json(banner);}));
guildsRouter.delete("/guilds/:guildId/banner",requireAuth,asyncHandler(async(req,res)=>{const guildId=routeParam(req.params.guildId,"guildId");await requireGuildManager(req.auth!.sub,guildId);await removeGuildBanner(guildId);await writeAudit({guildId,actorId:req.auth!.sub,action:"GUILD_BANNER_REMOVE",targetType:"GUILD",targetId:guildId,request:req});emitGuildStructure(req,guildId);res.status(204).end();}));

guildsRouter.patch("/guilds/:guildId", requireAuth, asyncHandler(async (req, res) => {
  const guildId = routeParam(req.params.guildId, "guildId");
  const data = updateGuildSchema.parse(req.body);
  await requireGuildManager(req.auth!.sub, guildId);

  const updateData: Prisma.GuildUpdateInput = { ...data };
  if (data.welcomeChannelId) {
    const welcomeChannel = await prisma.channel.findUnique({ where: { id: data.welcomeChannelId }, select: { guildId: true, type: true } });
    if (!welcomeChannel || welcomeChannel.guildId !== guildId || !["TEXT", "ANNOUNCEMENT"].includes(welcomeChannel.type)) throw new HttpError(400, "Canal de boas-vindas invalido");
  }
  if (data.memberSystemMessageChannelId) {
    const systemChannel = await prisma.channel.findUnique({ where: { id: data.memberSystemMessageChannelId }, select: { guildId: true, type: true } });
    if (!systemChannel || systemChannel.guildId !== guildId || !["TEXT", "ANNOUNCEMENT"].includes(systemChannel.type)) throw new HttpError(400, "Canal de mensagens de entrada/saida invalido");
  }
  if (data.communityTags) updateData.communityTags = Array.from(new Set(data.communityTags.map((tag) => tag.trim()).filter(Boolean))).slice(0, 6);

  if (data.afkEnabled === true) {
    const current = await prisma.guild.findUnique({ where: { id: guildId }, select: { afkChannelId: true } });
    let afkChannelId = current?.afkChannelId ?? null;
    if (afkChannelId) {
      const channel = await prisma.channel.findUnique({ where: { id: afkChannelId }, select: { guildId: true, type: true } });
      if (!channel || channel.guildId !== guildId || channel.type !== "VOICE") afkChannelId = null;
    }
    if (!afkChannelId) {
      const existing = await prisma.channel.findFirst({ where: { guildId, type: "VOICE", name: { equals: "Ausente", mode: "insensitive" } }, select: { id: true } });
      if (existing) afkChannelId = existing.id;
      else {
        const max = await prisma.channel.aggregate({ where: { guildId }, _max: { position: true } });
        const created = await prisma.channel.create({ data: { guildId, name: "Ausente", type: "VOICE", position: (max._max.position ?? -1) + 1, topic: "Canal AFK automatico do Ginga" } });
        afkChannelId = created.id;
      }
    }
    updateData.afkChannelId = afkChannelId;
  }

  const guild = await prisma.guild.update({ where: { id: guildId }, data: updateData });
  await writeAudit({ guildId, actorId: req.auth!.sub, action: "GUILD_UPDATE", targetType: "GUILD", targetId: guildId, metadata: data, request: req });
  emitGuildStructure(req, guildId);
  res.json({ guild: { ...guild, iconUrl: await guildIconUrl(guildId), bannerUrl: await guildBannerUrl(guildId), appearance: await guildAppearance(guildId, guild.iconColor) } });
}));

guildsRouter.patch("/guilds/:guildId/lockdown", requireAuth, asyncHandler(async (req, res) => {
  const guildId = routeParam(req.params.guildId, "guildId");
  const data = lockdownSchema.parse(req.body ?? {});
  await requireGuildCapability(req.auth!.sub, guildId, "manageServer");

  const guild = await prisma.guild.update({
    where: { id: guildId },
    data: {
      lockdownEnabled: data.enabled,
      lockdownReason: data.enabled ? data.reason : "",
      lockdownUpdatedAt: new Date()
    },
    select: { id: true, lockdownEnabled: true, lockdownReason: true, lockdownUpdatedAt: true }
  });

  if (data.enabled) {
    const members = await prisma.guildMember.findMany({ where: { guildId, role: "MEMBER" }, select: { userId: true } });
    for (let index = 0; index < members.length; index += 25) {
      await Promise.allSettled(members.slice(index, index + 25).map((member) => removeUserFromGuildMedia(guildId, member.userId)));
    }
  }

  await writeAudit({
    guildId,
    actorId: req.auth!.sub,
    action: data.enabled ? "GUILD_LOCKDOWN_ENABLE" : "GUILD_LOCKDOWN_DISABLE",
    targetType: "GUILD",
    targetId: guildId,
    metadata: { enabled: data.enabled, reason: data.enabled ? data.reason : "" },
    request: req
  });
  req.app.get("io")?.to?.(`guild:${guildId}`)?.emit?.("guild:lockdown", guild);
  emitGuildStructure(req, guildId);
  res.json({ lockdown: guild });
}));

guildsRouter.delete("/guilds/:guildId", requireAuth, asyncHandler(async (req, res) => {
  const guildId = routeParam(req.params.guildId, "guildId");
  deleteGuildSchema.parse(req.body ?? {});
  const guild = await prisma.guild.findUnique({
    where: { id: guildId },
    select: {
      id: true,
      name: true,
      ownerId: true,
      members: { select: { userId: true } },
      channels: { select: { id: true } }
    }
  });
  if (!guild) throw new HttpError(404, "Espaco nao encontrado");
  if (guild.ownerId !== req.auth!.sub) throw new HttpError(403, "Somente o proprietario pode excluir este espaco");

  const channelIds = guild.channels.map((channel) => channel.id);
  for (const member of guild.members) {
    removeUserFromLogicalGuildVoice(req, guildId, member.userId, "GUILD_DELETED");
    await removeUserFromGuildMedia(guildId, member.userId).catch(() => undefined);
    removeUserFromKnownGuildSocketRooms(req, guildId, member.userId, channelIds);
  }
  await Promise.allSettled([removeGuildIcon(guildId), removeGuildBanner(guildId)]);
  await prisma.guild.delete({ where: { id: guildId } });
  const io = req.app.get("io");
  for (const member of guild.members) {
    io?.to?.(`user:${member.userId}`)?.emit?.("guild:deleted", { guildId, name: guild.name });
  }
  res.status(204).end();
}));

guildsRouter.post("/guilds/:guildId/leave", requireAuth, asyncHandler(async (req, res) => {
  const guildId = routeParam(req.params.guildId, "guildId");
  const userId = req.auth!.sub;
  const guild = await prisma.guild.findUnique({ where: { id: guildId }, select: { id: true, name: true, ownerId: true } });
  if (!guild) throw new HttpError(404, "Espaco nao encontrado");
  if (guild.ownerId === userId) throw new HttpError(409, "O proprietario nao pode sair do servidor. Exclua o servidor primeiro.");
  const membership = await prisma.guildMember.findUnique({ where: { guildId_userId: { guildId, userId } }, select: { userId: true } });
  if (!membership) throw new HttpError(404, "Voce nao faz parte deste servidor");

  await writeAudit({ guildId, actorId: userId, action: "MEMBER_LEAVE", targetType: "USER", targetId: userId, targetUserId: userId, request: req });
  await prisma.$transaction([
    prisma.guildMemberCustomRole.deleteMany({ where: { guildId, userId } }),
    prisma.guildMember.delete({ where: { guildId_userId: { guildId, userId } } })
  ]);
  await removeUserFromGuildMedia(guildId, userId).catch(() => undefined);
  await removeUserFromGuildSocketRooms(req, guildId, userId).catch(() => undefined);
  await postGuildMemberSystemMessage(req.app.get("io"), guildId, userId, "LEAVE").catch((error) => console.warn("Mensagem de saida do servidor falhou", error));
  req.app.get("io")?.to?.(`user:${userId}`)?.emit?.("guild:left", { guildId, name: guild.name });
  emitGuildStructure(req, guildId);
  res.status(204).end();
}));

guildsRouter.get("/guilds/:guildId/members", requireAuth, asyncHandler(async (req, res) => {
  const guildId = routeParam(req.params.guildId, "guildId");
  await requireGuildMember(req.auth!.sub, guildId);
  await prisma.guildMember.updateMany({
    where: { guildId, timeoutUntil: { lte: new Date() } },
    data: { timeoutUntil: null, timeoutReason: "" }
  });

  const [members, assignments] = await Promise.all([
    prisma.guildMember.findMany({
      where: { guildId },
      orderBy: [{ role: "asc" }, { joinedAt: "asc" }],
      include: { user: { select: { id: true, username: true, displayName: true, avatarColor: true, bio: true, statusMessage: true, systemRole: true, platformOwner: true, accountType: true } } }
    }),
    prisma.guildMemberCustomRole.findMany({
      where: { guildId },
      include: { role: { select: { id: true, name: true, color: true, icon: true, description: true, position: true, permissions: true, hoist: true, mentionable: true, managed: true } } }
    })
  ]);
  const rolesByUser = new Map<string, typeof assignments>();
  for (const assignment of assignments) {
    const list = rolesByUser.get(assignment.userId) ?? [];
    list.push(assignment);
    rolesByUser.set(assignment.userId, list);
  }

  res.json({ members: members.map((member) => ({
    role: member.role,
    joinedAt: member.joinedAt,
    timeoutUntil: member.timeoutUntil,
    timeoutReason: member.timeoutReason,
    nickname: member.nickname,
    serverMuted: member.serverMuted,
    serverDeafened: member.serverDeafened,
    user: member.user,
    customRoles: (rolesByUser.get(member.userId) ?? []).map((item) => item.role).sort((a, b) => b.position - a.position)
  })) });
}));

guildsRouter.patch("/guilds/:guildId/members/:userId", requireAuth, asyncHandler(async (req, res) => {
  const guildId = routeParam(req.params.guildId, "guildId");
  const targetUserId = routeParam(req.params.userId, "userId");
  const { role } = memberRoleSchema.parse(req.body);
  const { membership: actor } = await requireGuildCapability(req.auth!.sub, guildId, "manageRoles");
  const target = await prisma.guildMember.findUnique({ where: { guildId_userId: { guildId, userId: targetUserId } } });
  if (!target) throw new HttpError(404, "Membro nao encontrado");
  if (target.userId === req.auth!.sub) throw new HttpError(400, "Voce nao pode alterar sua propria funcao");
  if (!roleCanManageRole(actor.role, target.role, role)) throw new HttpError(403, "Voce nao pode alterar a funcao deste membro");

  const membership = await prisma.guildMember.update({ where: { guildId_userId: { guildId, userId: targetUserId } }, data: { role } });
  await writeAudit({ guildId, actorId: req.auth!.sub, action: "MEMBER_ROLE_UPDATE", targetType: "USER", targetId: targetUserId, targetUserId, metadata: { from: target.role, to: role }, request: req });
  emitGuildStructure(req, guildId);
  res.json({ membership });
}));

guildsRouter.patch("/guilds/:guildId/members/:userId/nickname", requireAuth, asyncHandler(async (req, res) => {
  const guildId = routeParam(req.params.guildId, "guildId");
  const targetUserId = routeParam(req.params.userId, "userId");
  const data = nicknameSchema.parse(req.body ?? {});
  if (targetUserId === req.auth!.sub) {
    await requireGuildMember(req.auth!.sub, guildId);
  } else {
    await requireModerationTarget(req.auth!.sub, guildId, targetUserId, "manageNicknames");
  }
  const membership = await prisma.guildMember.update({
    where: { guildId_userId: { guildId, userId: targetUserId } },
    data: { nickname: data.nickname }
  });
  await writeAudit({ guildId, actorId: req.auth!.sub, action: "MEMBER_NICKNAME_UPDATE", targetType: "USER", targetId: targetUserId, targetUserId, metadata: { nickname: data.nickname }, request: req });
  emitGuildStructure(req, guildId);
  res.json({ membership });
}));

guildsRouter.patch("/guilds/:guildId/members/:userId/voice-moderation", requireAuth, asyncHandler(async (req, res) => {
  const guildId = routeParam(req.params.guildId, "guildId");
  const targetUserId = routeParam(req.params.userId, "userId");
  const data = voiceModerationSchema.parse(req.body ?? {});
  if (typeof data.muted === "boolean") await requireModerationTarget(req.auth!.sub, guildId, targetUserId, "muteMembers");
  if (typeof data.deafened === "boolean") await requireModerationTarget(req.auth!.sub, guildId, targetUserId, "deafenMembers");
  const update: { serverMuted?: boolean; serverDeafened?: boolean } = {};
  if (typeof data.muted === "boolean") update.serverMuted = data.muted;
  if (typeof data.deafened === "boolean") update.serverDeafened = data.deafened;
  const membership = await prisma.guildMember.update({ where: { guildId_userId: { guildId, userId: targetUserId } }, data: update });
  const io = req.app.get("io") as { gingaSetUserVoiceModeration?: (guildId: string, userId: string, state: { muted?: boolean; deafened?: boolean }) => boolean; to?: (room: string) => { emit?: (event: string, payload: unknown) => void } } | undefined;
  try { io?.gingaSetUserVoiceModeration?.(guildId, targetUserId, data); } catch { /* estado sera reconciliado no proximo join */ }
  await removeUserFromGuildMedia(guildId, targetUserId).catch(() => undefined);
  if (typeof data.muted === "boolean") await writeAudit({ guildId, actorId: req.auth!.sub, action: data.muted ? "MEMBER_VOICE_MUTE" : "MEMBER_VOICE_UNMUTE", targetType: "USER", targetId: targetUserId, targetUserId, request: req });
  if (typeof data.deafened === "boolean") await writeAudit({ guildId, actorId: req.auth!.sub, action: data.deafened ? "MEMBER_VOICE_DEAFEN" : "MEMBER_VOICE_UNDEAFEN", targetType: "USER", targetId: targetUserId, targetUserId, request: req });
  io?.to?.(`user:${targetUserId}`)?.emit?.("voice:moderation-state", { guildId, muted: membership.serverMuted, deafened: membership.serverDeafened });
  emitGuildStructure(req, guildId);
  res.json({ membership });
}));

guildsRouter.delete("/guilds/:guildId/members/:userId", requireAuth, asyncHandler(async (req, res) => {
  const guildId = routeParam(req.params.guildId, "guildId");
  const targetUserId = routeParam(req.params.userId, "userId");
  const data = kickMemberSchema.parse(req.body ?? {});
  await requireModerationTarget(req.auth!.sub, guildId, targetUserId, "kickMembers");

  await prisma.$transaction([
    prisma.guildMemberCustomRole.deleteMany({ where: { guildId, userId: targetUserId } }),
    prisma.guildMember.delete({ where: { guildId_userId: { guildId, userId: targetUserId } } })
  ]);
  removeUserFromLogicalGuildVoice(req, guildId, targetUserId, "KICK");
  await removeUserFromGuildMedia(guildId, targetUserId);
  await removeUserFromGuildSocketRooms(req, guildId, targetUserId).catch(() => undefined);
  await postGuildMemberSystemMessage(req.app.get("io"), guildId, targetUserId, "LEAVE").catch((error) => console.warn("Mensagem de saida do servidor falhou", error));
  await writeAudit({ guildId, actorId: req.auth!.sub, action: "MEMBER_KICK", targetType: "USER", targetId: targetUserId, targetUserId, metadata: { reason: data.reason }, request: req });
  emitModeration(req, guildId, targetUserId, "KICK");
  emitGuildStructure(req, guildId);
  res.status(204).end();
}));

guildsRouter.post("/guilds/:guildId/members/:userId/kick", requireAuth, asyncHandler(async (req, res) => {
  const guildId = routeParam(req.params.guildId, "guildId");
  const targetUserId = routeParam(req.params.userId, "userId");
  const data = kickMemberSchema.parse(req.body ?? {});
  await requireModerationTarget(req.auth!.sub, guildId, targetUserId, "kickMembers");

  await prisma.$transaction([
    prisma.guildMemberCustomRole.deleteMany({ where: { guildId, userId: targetUserId } }),
    prisma.guildMember.delete({ where: { guildId_userId: { guildId, userId: targetUserId } } })
  ]);
  removeUserFromLogicalGuildVoice(req, guildId, targetUserId, "KICK");
  await removeUserFromGuildMedia(guildId, targetUserId);
  await removeUserFromGuildSocketRooms(req, guildId, targetUserId).catch(() => undefined);
  await postGuildMemberSystemMessage(req.app.get("io"), guildId, targetUserId, "LEAVE").catch((error) => console.warn("Mensagem de saida do servidor falhou", error));
  await writeAudit({ guildId, actorId: req.auth!.sub, action: "MEMBER_KICK", targetType: "USER", targetId: targetUserId, targetUserId, metadata: { reason: data.reason }, request: req });
  emitModeration(req, guildId, targetUserId, "KICK");
  emitGuildStructure(req, guildId);
  res.status(204).end();
}));

guildsRouter.post("/guilds/:guildId/members/:userId/timeout", requireAuth, asyncHandler(async (req, res) => {
  const guildId = routeParam(req.params.guildId, "guildId");
  const targetUserId = routeParam(req.params.userId, "userId");
  const data = timeoutMemberSchema.parse(req.body ?? {});
  await requireModerationTargetAny(req.auth!.sub, guildId, targetUserId, ["manageMembers", "kickMembers"]);

  const timeoutUntil = new Date(Date.now() + data.durationMinutes * 60_000);
  const membership = await prisma.guildMember.update({
    where: { guildId_userId: { guildId, userId: targetUserId } },
    data: { timeoutUntil, timeoutReason: data.reason }
  });
  removeUserFromLogicalGuildVoice(req, guildId, targetUserId, "TIMEOUT");
  await removeUserFromGuildMedia(guildId, targetUserId).catch(() => undefined);
  await writeAudit({
    guildId,
    actorId: req.auth!.sub,
    action: "MEMBER_TIMEOUT",
    targetType: "USER",
    targetId: targetUserId,
    targetUserId,
    metadata: { durationMinutes: data.durationMinutes, reason: data.reason, timeoutUntil: timeoutUntil.toISOString() },
    request: req
  });
  req.app.get("io")?.to?.(`user:${targetUserId}`)?.emit?.("guild:timeout", { guildId, timeoutUntil, reason: data.reason });
  emitGuildStructure(req, guildId);
  res.json({ membership });
}));

guildsRouter.delete("/guilds/:guildId/members/:userId/timeout", requireAuth, asyncHandler(async (req, res) => {
  const guildId = routeParam(req.params.guildId, "guildId");
  const targetUserId = routeParam(req.params.userId, "userId");
  await requireModerationTargetAny(req.auth!.sub, guildId, targetUserId, ["manageMembers", "kickMembers"]);

  await prisma.guildMember.update({
    where: { guildId_userId: { guildId, userId: targetUserId } },
    data: { timeoutUntil: null, timeoutReason: "" }
  });
  await writeAudit({ guildId, actorId: req.auth!.sub, action: "MEMBER_TIMEOUT_REMOVE", targetType: "USER", targetId: targetUserId, targetUserId, request: req });
  req.app.get("io")?.to?.(`user:${targetUserId}`)?.emit?.("guild:timeout:removed", { guildId });
  emitGuildStructure(req, guildId);
  res.status(204).end();
}));

guildsRouter.post("/guilds/:guildId/bans/:userId", requireAuth, asyncHandler(async (req, res) => {
  const guildId = routeParam(req.params.guildId, "guildId");
  const targetUserId = routeParam(req.params.userId, "userId");
  const data = banSchema.parse(req.body ?? {});
  await requireModerationTarget(req.auth!.sub, guildId, targetUserId, "banMembers");

  const expiresAt = banExpiresAt(data.duration);
  const { ban, deletedMessages } = await prisma.$transaction(async (tx) => {
    const result = await tx.guildBan.upsert({
      where: { guildId_userId: { guildId, userId: targetUserId } },
      update: { bannedById: req.auth!.sub, reason: data.reason, expiresAt },
      create: { guildId, userId: targetUserId, bannedById: req.auth!.sub, reason: data.reason, expiresAt }
    });
    let deletedMessages = 0;
    if (data.deleteMessageMinutes > 0) {
      const cutoff = new Date(Date.now() - data.deleteMessageMinutes * 60_000);
      const deleted = await tx.message.deleteMany({
        where: { authorId: targetUserId, createdAt: { gte: cutoff }, channel: { guildId } }
      });
      deletedMessages = deleted.count;
    }
    await tx.guildMemberCustomRole.deleteMany({ where: { guildId, userId: targetUserId } });
    await tx.guildMember.deleteMany({ where: { guildId, userId: targetUserId } });
    return { ban: result, deletedMessages };
  });

  removeUserFromLogicalGuildVoice(req, guildId, targetUserId, "BAN");
  await removeUserFromGuildMedia(guildId, targetUserId);
  await removeUserFromGuildSocketRooms(req, guildId, targetUserId).catch(() => undefined);
  await postGuildMemberSystemMessage(req.app.get("io"), guildId, targetUserId, "LEAVE").catch((error) => console.warn("Mensagem de saida do servidor falhou", error));
  await writeAudit({
    guildId,
    actorId: req.auth!.sub,
    action: "MEMBER_BAN",
    targetType: "USER",
    targetId: targetUserId,
    targetUserId,
    metadata: { duration: data.duration, reason: data.reason, expiresAt: expiresAt?.toISOString() ?? null, deleteMessageMinutes: data.deleteMessageMinutes, deletedMessages },
    request: req
  });
  emitModeration(req, guildId, targetUserId, "BAN");
  emitGuildStructure(req, guildId);
  res.status(201).json({ ban });
}));

guildsRouter.get("/guilds/:guildId/bans", requireAuth, asyncHandler(async (req, res) => {
  const guildId = routeParam(req.params.guildId, "guildId");
  await requireGuildCapability(req.auth!.sub, guildId, "banMembers");
  await prisma.guildBan.deleteMany({ where: { guildId, expiresAt: { lte: new Date() } } });
  const bans = await prisma.guildBan.findMany({
    where: { guildId },
    orderBy: { createdAt: "desc" },
    include: {
      user: { select: { id: true, username: true, displayName: true, avatarColor: true, systemRole: true, platformOwner: true, accountType: true } },
      bannedBy: { select: { id: true, username: true, displayName: true, avatarColor: true, systemRole: true, platformOwner: true, accountType: true } }
    }
  });
  res.json({ bans });
}));

guildsRouter.delete("/guilds/:guildId/bans/:userId", requireAuth, asyncHandler(async (req, res) => {
  const guildId = routeParam(req.params.guildId, "guildId");
  const targetUserId = routeParam(req.params.userId, "userId");
  await requireGuildCapability(req.auth!.sub, guildId, "banMembers");
  const deleted = await prisma.guildBan.deleteMany({ where: { guildId, userId: targetUserId } });
  if (!deleted.count) throw new HttpError(404, "Banimento nao encontrado");
  await writeAudit({ guildId, actorId: req.auth!.sub, action: "MEMBER_UNBAN", targetType: "USER", targetId: targetUserId, targetUserId, request: req });
  res.status(204).end();
}));

guildsRouter.get("/guilds/:guildId/audit", requireAuth, asyncHandler(async (req, res) => {
  const guildId = routeParam(req.params.guildId, "guildId");
  await requireGuildCapability(req.auth!.sub, guildId, "viewAuditLog");
  const query = auditQuerySchema.parse(req.query);
  const logs = await prisma.guildAuditLog.findMany({
    where: {
      guildId,
      ...(query.before ? { createdAt: { lt: new Date(query.before) } } : {}),
      ...(query.action ? { action: query.action } : {}),
      ...(query.actorId ? { actorId: query.actorId } : {}),
      ...(query.targetUserId ? { targetUserId: query.targetUserId } : {})
    },
    orderBy: { createdAt: "desc" },
    take: query.limit
  });
  const userIds = Array.from(new Set(logs.flatMap((item) => [item.actorId, item.targetUserId]).filter((id): id is string => Boolean(id))));
  const users = userIds.length ? await prisma.user.findMany({
    where: { id: { in: userIds } },
    select: { id: true, username: true, displayName: true, avatarColor: true, systemRole: true, platformOwner: true, accountType: true }
  }) : [];
  const userById = new Map(users.map((user) => [user.id, user]));
  res.json({ logs: logs.map((item) => ({
    ...item,
    actor: item.actorId ? userById.get(item.actorId) ?? null : null,
    targetUser: item.targetUserId ? userById.get(item.targetUserId) ?? null : null
  })) });
}));

guildsRouter.post("/guilds/:guildId/categories", requireAuth, asyncHandler(async (req, res) => {
  const guildId = routeParam(req.params.guildId, "guildId");
  const data = createCategorySchema.parse(req.body);
  await requireGuildCapability(req.auth!.sub, guildId, "manageChannels");
  const last = await prisma.channelCategory.aggregate({ where: { guildId }, _max: { position: true } });
  try {
    const category = await prisma.channelCategory.create({
      data: {
        guildId,
        name: data.name,
        position: (last._max?.position ?? -1) + 1,
        permissions: {
          create: [
            { role: "MODERATOR", canView: true, canSendMessages: true, canConnect: true },
            { role: "MEMBER", canView: true, canSendMessages: true, canConnect: true }
          ]
        }
      }
    });
    await writeAudit({ guildId, actorId: req.auth!.sub, action: "CATEGORY_CREATE", targetType: "CATEGORY", targetId: category.id, metadata: { name: category.name }, request: req });
    emitGuildStructure(req, guildId);
    res.status(201).json({ category });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") throw new HttpError(409, "Ja existe uma categoria com esse nome");
    throw error;
  }
}));

guildsRouter.patch("/categories/:categoryId", requireAuth, asyncHandler(async (req, res) => {
  const categoryId = routeParam(req.params.categoryId, "categoryId");
  const data = updateCategorySchema.parse(req.body);
  const category = await prisma.channelCategory.findUnique({ where: { id: categoryId } });
  if (!category) throw new HttpError(404, "Categoria nao encontrada");
  await requireGuildCapability(req.auth!.sub, category.guildId, "manageChannels");
  try {
    const updated = await prisma.channelCategory.update({ where: { id: categoryId }, data });
    await writeAudit({ guildId: category.guildId, actorId: req.auth!.sub, action: "CATEGORY_UPDATE", targetType: "CATEGORY", targetId: categoryId, metadata: data, request: req });
    emitGuildStructure(req, category.guildId);
    res.json({ category: updated });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") throw new HttpError(409, "Ja existe uma categoria com esse nome");
    throw error;
  }
}));

guildsRouter.delete("/categories/:categoryId", requireAuth, asyncHandler(async (req, res) => {
  const categoryId = routeParam(req.params.categoryId, "categoryId");
  const category = await prisma.channelCategory.findUnique({ where: { id: categoryId } });
  if (!category) throw new HttpError(404, "Categoria nao encontrada");
  await requireGuildCapability(req.auth!.sub, category.guildId, "manageChannels");
  await prisma.$transaction([
    prisma.channel.updateMany({ where: { categoryId }, data: { categoryId: null, syncPermissionsWithCategory: false } }),
    prisma.channelCategory.delete({ where: { id: categoryId } })
  ]);
  await writeAudit({ guildId: category.guildId, actorId: req.auth!.sub, action: "CATEGORY_DELETE", targetType: "CATEGORY", targetId: categoryId, metadata: { name: category.name }, request: req });
  emitGuildStructure(req, category.guildId);
  res.status(204).end();
}));

guildsRouter.put("/guilds/:guildId/categories/reorder", requireAuth, asyncHandler(async (req, res) => {
  const guildId = routeParam(req.params.guildId, "guildId");
  const { items } = reorderCategoriesSchema.parse(req.body);
  await requireGuildCapability(req.auth!.sub, guildId, "manageChannels");
  const ids = Array.from(new Set(items.map((item) => item.id)));
  if (ids.length !== items.length) throw new HttpError(400, "Categorias duplicadas na ordenacao");
  const count = await prisma.channelCategory.count({ where: { guildId, id: { in: ids } } });
  if (count !== ids.length) throw new HttpError(400, "Uma ou mais categorias nao pertencem ao espaco");
  await prisma.$transaction(items.map((item) => prisma.channelCategory.update({ where: { id: item.id }, data: { position: item.position } })));
  await writeAudit({ guildId, actorId: req.auth!.sub, action: "CATEGORY_REORDER", targetType: "CATEGORY", metadata: { count: items.length }, request: req });
  emitGuildStructure(req, guildId);
  res.status(204).end();
}));

guildsRouter.post("/guilds/:guildId/channels", requireAuth, asyncHandler(async (req, res) => {
  const guildId = routeParam(req.params.guildId, "guildId");
  const data = createChannelSchema.parse(req.body);
  await requireGuildCapability(req.auth!.sub, guildId, "manageChannels");
  await ensureCategoryBelongsToGuild(guildId, data.categoryId);

  const last = await prisma.channel.aggregate({ where: { guildId, categoryId: data.categoryId ?? null }, _max: { position: true } });
  try {
    const channel = await prisma.channel.create({
      data: {
        guildId,
        categoryId: data.categoryId ?? null,
        name: data.name,
        type: data.type,
        position: (last._max?.position ?? -1) + 1,
        syncPermissionsWithCategory: Boolean(data.categoryId),
        permissions: {
          create: [
            { role: "MODERATOR", canView: true, canSendMessages: true, canConnect: true },
            { role: "MEMBER", canView: true, canSendMessages: true, canConnect: true }
          ]
        }
      }
    });
    await writeAudit({ guildId, actorId: req.auth!.sub, action: "CHANNEL_CREATE", targetType: "CHANNEL", targetId: channel.id, metadata: { name: channel.name, type: channel.type, categoryId: channel.categoryId }, request: req });
    emitGuildStructure(req, guildId);
    res.status(201).json({ channel });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") throw new HttpError(409, "Ja existe um canal com esse nome");
    throw error;
  }
}));

guildsRouter.patch("/channels/:channelId", requireAuth, asyncHandler(async (req, res) => {
  const channelId = routeParam(req.params.channelId, "channelId");
  const data = updateChannelSchema.parse(req.body);
  const channel = await prisma.channel.findUnique({ where: { id: channelId } });
  if (!channel) throw new HttpError(404, "Canal nao encontrado");
  await requireGuildCapability(req.auth!.sub, channel.guildId, "manageChannels");
  if (data.categoryId !== undefined) await ensureCategoryBelongsToGuild(channel.guildId, data.categoryId);

  try {
    const updated = await prisma.channel.update({ where: { id: channelId }, data });
    await writeAudit({ guildId: channel.guildId, actorId: req.auth!.sub, action: "CHANNEL_UPDATE", targetType: "CHANNEL", targetId: channelId, metadata: data, request: req });
    emitGuildStructure(req, channel.guildId);
    res.json({ channel: updated });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") throw new HttpError(409, "Ja existe um canal com esse nome");
    throw error;
  }
}));

guildsRouter.put("/guilds/:guildId/channels/reorder", requireAuth, asyncHandler(async (req, res) => {
  const guildId = routeParam(req.params.guildId, "guildId");
  const { items } = reorderChannelsSchema.parse(req.body);
  await requireGuildCapability(req.auth!.sub, guildId, "manageChannels");

  const ids = Array.from(new Set(items.map((item) => item.id)));
  if (ids.length !== items.length) throw new HttpError(400, "Canais duplicados na ordenacao");
  const channelCount = await prisma.channel.count({ where: { guildId, id: { in: ids } } });
  if (channelCount !== ids.length) throw new HttpError(400, "Um ou mais canais nao pertencem ao espaco");

  const categoryIds = Array.from(new Set(items.map((item) => item.categoryId).filter((id): id is string => Boolean(id))));
  if (categoryIds.length > 0) {
    const categoryCount = await prisma.channelCategory.count({ where: { guildId, id: { in: categoryIds } } });
    if (categoryCount !== categoryIds.length) throw new HttpError(400, "Uma ou mais categorias nao pertencem ao espaco");
  }

  await prisma.$transaction(items.map((item) => prisma.channel.update({
    where: { id: item.id },
    data: {
      categoryId: item.categoryId,
      position: item.position,
      ...(item.categoryId ? {} : { syncPermissionsWithCategory: false })
    }
  })));
  await writeAudit({ guildId, actorId: req.auth!.sub, action: "CHANNEL_REORDER", targetType: "CHANNEL", metadata: { count: items.length }, request: req });
  emitGuildStructure(req, guildId);
  res.status(204).end();
}));

guildsRouter.delete("/channels/:channelId", requireAuth, asyncHandler(async (req, res) => {
  const channelId = routeParam(req.params.channelId, "channelId");
  const channel = await prisma.channel.findUnique({ where: { id: channelId } });
  if (!channel) throw new HttpError(404, "Canal nao encontrado");
  await requireGuildCapability(req.auth!.sub, channel.guildId, "manageChannels");
  const channelCount = await prisma.channel.count({ where: { guildId: channel.guildId } });
  if (channelCount <= 1) throw new HttpError(400, "O espaco precisa manter pelo menos um canal");
  await prisma.$transaction([
    prisma.channel.delete({ where: { id: channelId } }),
    prisma.guild.updateMany({ where: { id: channel.guildId, afkChannelId: channelId }, data: { afkChannelId: null, afkEnabled: false } }),
    prisma.guild.updateMany({ where: { id: channel.guildId, memberSystemMessageChannelId: channelId }, data: { memberSystemMessageChannelId: null } }),
    prisma.guild.updateMany({ where: { id: channel.guildId, welcomeChannelId: channelId }, data: { welcomeChannelId: null } })
  ]);
  await writeAudit({ guildId: channel.guildId, actorId: req.auth!.sub, action: "CHANNEL_DELETE", targetType: "CHANNEL", targetId: channelId, metadata: { name: channel.name, type: channel.type }, request: req });
  emitGuildStructure(req, channel.guildId);
  res.status(204).end();
}));

guildsRouter.get("/guilds/:guildId/structure", requireAuth, asyncHandler(async (req, res) => {
  const guildId = routeParam(req.params.guildId, "guildId");
  await requireAnyGuildCapability(req.auth!.sub, guildId, ["manageServer", "manageChannels", "manageRoles"]);
  const [categories, channels, rolePermissions, customRoles] = await Promise.all([
    prisma.channelCategory.findMany({ where: { guildId }, orderBy: [{ position: "asc" }, { createdAt: "asc" }], include: { permissions: true, customRolePermissions: true } }),
    prisma.channel.findMany({ where: { guildId }, orderBy: [{ position: "asc" }, { createdAt: "asc" }], include: { permissions: true, customRolePermissions: true } }),
    Promise.all((["MODERATOR", "MEMBER"] as const).map(async (role) => ({ role, ...(await effectiveGuildPermissions(guildId, role)) }))),
    prisma.guildCustomRole.findMany({ where: { guildId }, orderBy: [{ position: "desc" }, { createdAt: "asc" }] })
  ]);
  res.json({ categories, channels, rolePermissions, customRoles });
}));

guildsRouter.get("/guilds/:guildId/channel-permissions", requireAuth, asyncHandler(async (req, res) => {
  const guildId = routeParam(req.params.guildId, "guildId");
  await requireGuildCapability(req.auth!.sub, guildId, "manageRoles");
  const channels = await prisma.channel.findMany({ where: { guildId }, orderBy: [{ position: "asc" }, { createdAt: "asc" }], include: { permissions: true } });
  res.json({ channels });
}));

guildsRouter.put("/guilds/:guildId/role-permissions/:role", requireAuth, asyncHandler(async (req, res) => {
  const guildId = routeParam(req.params.guildId, "guildId");
  const role = permissionRoleSchema.parse(routeParam(req.params.role, "role"));
  const data = guildRolePermissionSchema.parse(req.body);
  await requireGuildCapability(req.auth!.sub, guildId, "manageRoles");
  const permission = await prisma.guildRolePermission.upsert({
    where: { guildId_role: { guildId, role } },
    update: data,
    create: { guildId, role, ...data }
  });
  await writeAudit({ guildId, actorId: req.auth!.sub, action: "ROLE_PERMISSION_UPDATE", targetType: "ROLE", targetId: role, metadata: data, request: req });
  emitGuildStructure(req, guildId);
  res.json({ permission });
}));

guildsRouter.put("/categories/:categoryId/permissions/:role", requireAuth, asyncHandler(async (req, res) => {
  const categoryId = routeParam(req.params.categoryId, "categoryId");
  const role = permissionRoleSchema.parse(routeParam(req.params.role, "role"));
  const data = channelPermissionSchema.parse(req.body);
  const category = await prisma.channelCategory.findUnique({ where: { id: categoryId } });
  if (!category) throw new HttpError(404, "Categoria nao encontrada");
  await requireGuildCapability(req.auth!.sub, category.guildId, "manageRoles");
  const permission = await prisma.categoryPermission.upsert({
    where: { categoryId_role: { categoryId, role } },
    update: data,
    create: { categoryId, role, ...data }
  });
  await writeAudit({ guildId: category.guildId, actorId: req.auth!.sub, action: "CATEGORY_PERMISSION_UPDATE", targetType: "CATEGORY", targetId: categoryId, metadata: { role, ...data }, request: req });
  emitGuildStructure(req, category.guildId);
  res.json({ permission });
}));

guildsRouter.put("/channels/:channelId/permissions/:role", requireAuth, asyncHandler(async (req, res) => {
  const channelId = routeParam(req.params.channelId, "channelId");
  const role = permissionRoleSchema.parse(routeParam(req.params.role, "role"));
  const data = channelPermissionSchema.parse(req.body);
  const channel = await prisma.channel.findUnique({ where: { id: channelId } });
  if (!channel) throw new HttpError(404, "Canal nao encontrado");
  await requireGuildCapability(req.auth!.sub, channel.guildId, "manageRoles");
  const permission = await prisma.channelPermission.upsert({
    where: { channelId_role: { channelId, role } },
    update: data,
    create: { channelId, role, ...data }
  });
  await writeAudit({ guildId: channel.guildId, actorId: req.auth!.sub, action: "CHANNEL_PERMISSION_UPDATE", targetType: "CHANNEL", targetId: channelId, metadata: { role, ...data }, request: req });
  emitGuildStructure(req, channel.guildId);
  res.json({ permission });
}));

guildsRouter.post("/guilds/:guildId/invites", requireAuth, asyncHandler(async (req, res) => {
  const guildId = routeParam(req.params.guildId, "guildId");
  const options = inviteOptionsSchema.parse(req.body ?? {});
  await requireGuildCapability(req.auth!.sub, guildId, "createInvites");

  const expiresInMinutes = options.expiresInMinutes ?? (options.expiresInHours ? options.expiresInHours * 60 : null);
  const expiresAt = expiresInMinutes ? new Date(Date.now() + expiresInMinutes * 60 * 1000) : null;
  let invite;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      invite = await prisma.invite.create({
        data: { code: inviteCode(), guildId, createdById: req.auth!.sub, expiresAt, maxUses: options.maxUses ?? null }
      });
      break;
    } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002")) throw error;
    }
  }
  if (!invite) throw new HttpError(500, "Nao foi possivel gerar o convite");
  await writeAudit({ guildId, actorId: req.auth!.sub, action: "INVITE_CREATE", targetType: "INVITE", targetId: invite.code, metadata: { expiresAt: invite.expiresAt?.toISOString() ?? null, maxUses: invite.maxUses }, request: req });
  res.status(201).json({ invite });
}));

guildsRouter.get("/guilds/:guildId/invites", requireAuth, asyncHandler(async (req, res) => {
  const guildId = routeParam(req.params.guildId, "guildId");
  await requireGuildCapability(req.auth!.sub, guildId, "manageInvites");
  const invites = await prisma.invite.findMany({
    where: { guildId },
    orderBy: { createdAt: "desc" },
    include: { createdBy: { select: { id: true, username: true, displayName: true, avatarColor: true, systemRole: true, platformOwner: true, accountType: true } } }
  });
  res.json({ invites });
}));

guildsRouter.delete("/guilds/:guildId/invites/:code", requireAuth, asyncHandler(async (req, res) => {
  const guildId = routeParam(req.params.guildId, "guildId");
  const code = routeParam(req.params.code, "code").toUpperCase();
  await requireGuildCapability(req.auth!.sub, guildId, "manageInvites");
  const invite = await prisma.invite.findUnique({ where: { code } });
  if (!invite || invite.guildId !== guildId) throw new HttpError(404, "Convite nao encontrado");
  await prisma.invite.delete({ where: { code } });
  await writeAudit({ guildId, actorId: req.auth!.sub, action: "INVITE_REVOKE", targetType: "INVITE", targetId: code, request: req });
  res.status(204).end();
}));

guildsRouter.get("/invites/:code", asyncHandler(async (req, res) => {
  const code = routeParam(req.params.code, "code").toUpperCase();
  const invite = await prisma.invite.findUnique({
    where: { code },
    include: { guild: { select: { id: true, name: true, iconColor: true, _count: { select: { members: true } } } } }
  });
  if (!invite) throw new HttpError(404, "Convite nao encontrado");
  const iconUrl = await guildIconUrl(invite.guild.id);
  const expired = Boolean(invite.expiresAt && invite.expiresAt.getTime() < Date.now());
  const exhausted = Boolean(invite.maxUses && invite.uses >= invite.maxUses);
  res.json({
    invite: {
      code: invite.code,
      expiresAt: invite.expiresAt,
      uses: invite.uses,
      maxUses: invite.maxUses,
      valid: !expired && !exhausted,
      guild: { id: invite.guild.id, name: invite.guild.name, iconColor: invite.guild.iconColor, iconUrl, memberCount: invite.guild._count.members }
    }
  });
}));

guildsRouter.post("/invites/:code/join", requireAuth, asyncHandler(async (req, res) => {
  const code = routeParam(req.params.code, "code").toUpperCase();
  const userId = req.auth!.sub;
  const preview = await prisma.invite.findUnique({ where: { code }, select: { guildId: true } });
  if (!preview) throw new HttpError(404, "Convite nao encontrado");
  const existing = await prisma.guildMember.findUnique({ where: { guildId_userId: { guildId: preview.guildId, userId } } });
  const joinSecurity = existing ? { timeoutUntil:null, timeoutReason:"" } : await checkGuildJoinSecurity(preview.guildId,userId);
  const joinResult = await prisma.$transaction(async (tx) => {
    const invite = await tx.invite.findUnique({ where: { code }, include: { guild: { select: { lockdownEnabled: true, welcomeChannelId: true } } } });
    if (!invite) throw new HttpError(404, "Convite nao encontrado");
    if (invite.guild.lockdownEnabled) throw new HttpError(423, "Servidor em modo de contencao. Novas entradas estao pausadas temporariamente.");
    if (invite.expiresAt && invite.expiresAt.getTime() < Date.now()) throw new HttpError(410, "Convite expirado");

    const ban = await tx.guildBan.findUnique({ where: { guildId_userId: { guildId: invite.guildId, userId } } });
    if (ban) {
      if (!ban.expiresAt || ban.expiresAt.getTime() > Date.now()) {
        throw new HttpError(403, ban.expiresAt ? `Voce esta banido ate ${ban.expiresAt.toISOString()}` : "Voce foi banido permanentemente deste espaco");
      }
      await tx.guildBan.delete({ where: { id: ban.id } });
    }

    const existing = await tx.guildMember.findUnique({ where: { guildId_userId: { guildId: invite.guildId, userId } } });
    const joined = !existing;
    if (!existing) {
      if (invite.maxUses) {
        const claimed = await tx.invite.updateMany({
          where: { code, uses: { lt: invite.maxUses } },
          data: { uses: { increment: 1 } }
        });
        if (!claimed.count) throw new HttpError(410, "Convite esgotado");
      } else {
        await tx.invite.update({ where: { code }, data: { uses: { increment: 1 } } });
      }
      await tx.guildMember.create({ data: { guildId: invite.guildId, userId, role: "MEMBER", timeoutUntil: joinSecurity.timeoutUntil, timeoutReason: joinSecurity.timeoutReason } });
    }
    return { guildId: invite.guildId, welcomeChannelId: invite.guild.welcomeChannelId, joined };
  });
  if (joinResult.joined) await postGuildMemberSystemMessage(req.app.get("io"), joinResult.guildId, userId, "JOIN").catch((error) => console.warn("Mensagem de entrada no servidor falhou", error));
  emitGuildStructure(req, joinResult.guildId);
  res.json(joinResult);
}));
