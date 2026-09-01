import type { GuildRole } from "@prisma/client";
import { prisma } from "./db.js";
import { HttpError } from "./errors.js";

export type ChannelCapability = "view" | "sendMessages" | "connect";
export type GuildCapability =
  | "manageChannels"
  | "manageMessages"
  | "manageMembers"
  | "manageServer"
  | "manageRoles"
  | "kickMembers"
  | "moveMembers"
  | "muteMembers"
  | "deafenMembers"
  | "manageNicknames"
  | "banMembers"
  | "viewAuditLog"
  | "createInvites"
  | "manageInvites"
  | "manageWebhooks"
  | "manageBots"
  | "manageEvents"
  | "manageForums"
  | "manageAutoMod"
  | "pinMessages"
  | "scheduleMessages"
  | "mentionEveryone"
  | "shareScreen"
  | "useVideo";

export interface EffectiveGuildPermissions {
  canManageChannels: boolean;
  canManageMessages: boolean;
  canManageMembers: boolean;
  canManageServer: boolean;
  canManageRoles: boolean;
  canKickMembers: boolean;
  canMoveMembers: boolean;
  canMuteMembers: boolean;
  canDeafenMembers: boolean;
  canManageNicknames: boolean;
  canBanMembers: boolean;
  canViewAuditLog: boolean;
  canCreateInvites: boolean;
  canManageInvites: boolean;
  canManageWebhooks: boolean;
  canManageBots: boolean;
  canManageEvents: boolean;
  canManageForums: boolean;
  canManageAutoMod: boolean;
  canPinMessages: boolean;
  canScheduleMessages: boolean;
  canMentionEveryone: boolean;
  canShareScreen: boolean;
  canUseVideo: boolean;
}

const elevatedPermissions: EffectiveGuildPermissions = {
  canManageChannels: true,
  canManageMessages: true,
  canManageMembers: true,
  canManageServer: true,
  canManageRoles: true,
  canKickMembers: true,
  canMoveMembers: true,
  canMuteMembers: true,
  canDeafenMembers: true,
  canManageNicknames: true,
  canBanMembers: true,
  canViewAuditLog: true,
  canCreateInvites: true,
  canManageInvites: true,
  canManageWebhooks: true,
  canManageBots: true,
  canManageEvents: true,
  canManageForums: true,
  canManageAutoMod: true,
  canPinMessages: true,
  canScheduleMessages: true,
  canMentionEveryone: true,
  canShareScreen: true,
  canUseVideo: true
};

const defaultRolePermissions: Record<GuildRole, EffectiveGuildPermissions> = {
  OWNER: elevatedPermissions,
  ADMIN: elevatedPermissions,
  MODERATOR: {
    canManageChannels: false,
    canManageMessages: true,
    canManageMembers: false,
    canManageServer: false,
    canManageRoles: false,
    canKickMembers: true,
    canMoveMembers: true,
    canMuteMembers: true,
    canDeafenMembers: true,
    canManageNicknames: true,
    canBanMembers: true,
    canViewAuditLog: true,
    canCreateInvites: true,
    canManageInvites: false,
    canManageWebhooks: false,
    canManageBots: false,
    canManageEvents: true,
    canManageForums: true,
    canManageAutoMod: false,
    canPinMessages: true,
    canScheduleMessages: false,
    canMentionEveryone: false,
    canShareScreen: true,
    canUseVideo: true
  },
  MEMBER: {
    canManageChannels: false,
    canManageMessages: false,
    canManageMembers: false,
    canManageServer: false,
    canManageRoles: false,
    canKickMembers: false,
    canMoveMembers: false,
    canMuteMembers: false,
    canDeafenMembers: false,
    canManageNicknames: false,
    canBanMembers: false,
    canViewAuditLog: false,
    canCreateInvites: true,
    canManageInvites: false,
    canManageWebhooks: false,
    canManageBots: false,
    canManageEvents: false,
    canManageForums: false,
    canManageAutoMod: false,
    canPinMessages: false,
    canScheduleMessages: false,
    canMentionEveryone: false,
    canShareScreen: true,
    canUseVideo: true
  }
};

const capabilityField: Record<GuildCapability, keyof EffectiveGuildPermissions> = {
  manageChannels: "canManageChannels",
  manageMessages: "canManageMessages",
  manageMembers: "canManageMembers",
  manageServer: "canManageServer",
  manageRoles: "canManageRoles",
  kickMembers: "canKickMembers",
  moveMembers: "canMoveMembers",
  muteMembers: "canMuteMembers",
  deafenMembers: "canDeafenMembers",
  manageNicknames: "canManageNicknames",
  banMembers: "canBanMembers",
  viewAuditLog: "canViewAuditLog",
  createInvites: "canCreateInvites",
  manageInvites: "canManageInvites",
  manageWebhooks: "canManageWebhooks",
  manageBots: "canManageBots",
  manageEvents: "canManageEvents",
  manageForums: "canManageForums",
  manageAutoMod: "canManageAutoMod",
  pinMessages: "canPinMessages",
  scheduleMessages: "canScheduleMessages",
  mentionEveryone: "canMentionEveryone",
  shareScreen: "canShareScreen",
  useVideo: "canUseVideo"
};

const capabilityMessage: Record<GuildCapability, string> = {
  manageChannels: "Voce nao pode gerenciar canais e categorias deste espaco",
  manageMessages: "Voce nao pode moderar mensagens deste espaco",
  manageMembers: "Voce nao pode gerenciar membros deste espaco",
  manageServer: "Voce nao pode alterar as configuracoes deste espaco",
  manageRoles: "Voce nao pode gerenciar cargos e permissoes deste espaco",
  kickMembers: "Voce nao pode expulsar membros deste espaco",
  moveMembers: "Voce nao pode mover membros entre salas de voz deste espaco",
  muteMembers: "Voce nao pode mutar membros na voz deste espaco",
  deafenMembers: "Voce nao pode ensurdecer membros na voz deste espaco",
  manageNicknames: "Voce nao pode gerenciar apelidos deste espaco",
  banMembers: "Voce nao pode banir membros deste espaco",
  viewAuditLog: "Voce nao pode visualizar a auditoria deste espaco",
  createInvites: "Voce nao pode criar convites para este espaco",
  manageInvites: "Voce nao pode gerenciar convites deste espaco",
  manageWebhooks: "Voce nao pode gerenciar webhooks deste espaco",
  manageBots: "Voce nao pode instalar ou gerenciar bots neste espaco",
  manageEvents: "Voce nao pode gerenciar eventos neste espaco",
  manageForums: "Voce nao pode moderar foruns neste espaco",
  manageAutoMod: "Voce nao pode gerenciar o AutoMod deste espaco",
  pinMessages: "Voce nao pode fixar mensagens neste espaco",
  scheduleMessages: "Voce nao pode agendar mensagens neste espaco",
  mentionEveryone: "Voce nao pode mencionar todos neste espaco",
  shareScreen: "Voce nao pode compartilhar a tela neste espaco",
  useVideo: "Voce nao pode usar a camera neste espaco"
};

const roleRank: Record<GuildRole, number> = { OWNER: 4, ADMIN: 3, MODERATOR: 2, MEMBER: 1 };

export const customRolePermissionKeys: GuildCapability[] = Object.keys(capabilityField) as GuildCapability[];

export function defaultGuildRolePermissionData(role: GuildRole) {
  return { role, ...defaultRolePermissions[role] };
}

export async function requireGuildMember(userId: string, guildId: string) {
  const membership = await prisma.guildMember.findUnique({
    where: { guildId_userId: { guildId, userId } }
  });
  if (!membership) throw new HttpError(403, "Voce nao participa deste espaco");
  return membership;
}

export async function effectiveGuildPermissions(guildId: string, role: GuildRole): Promise<EffectiveGuildPermissions> {
  if (role === "OWNER" || role === "ADMIN") return { ...elevatedPermissions };
  const stored = await prisma.guildRolePermission.findUnique({ where: { guildId_role: { guildId, role } } });
  if (!stored) return { ...defaultRolePermissions[role] };
  return {
    canManageChannels: stored.canManageChannels,
    canManageMessages: stored.canManageMessages,
    canManageMembers: stored.canManageMembers,
    canManageServer: stored.canManageServer,
    canManageRoles: stored.canManageRoles,
    canKickMembers: stored.canKickMembers,
    canMoveMembers: stored.canMoveMembers,
    canMuteMembers: stored.canMuteMembers,
    canDeafenMembers: stored.canDeafenMembers,
    canManageNicknames: stored.canManageNicknames,
    canBanMembers: stored.canBanMembers,
    canViewAuditLog: stored.canViewAuditLog,
    canCreateInvites: stored.canCreateInvites,
    canManageInvites: stored.canManageInvites,
    canManageWebhooks: stored.canManageWebhooks,
    canManageBots: stored.canManageBots,
    canManageEvents: stored.canManageEvents,
    canManageForums: stored.canManageForums,
    canManageAutoMod: stored.canManageAutoMod,
    canPinMessages: stored.canPinMessages,
    canScheduleMessages: stored.canScheduleMessages,
    canMentionEveryone: stored.canMentionEveryone,
    canShareScreen: stored.canShareScreen,
    canUseVideo: stored.canUseVideo
  };
}

export async function effectiveGuildPermissionsForUser(userId: string, guildId: string) {
  const membership = await requireGuildMember(userId, guildId);
  const base = await effectiveGuildPermissions(guildId, membership.role);
  if (membership.role === "OWNER" || membership.role === "ADMIN") return { membership, permissions: base };

  const assignments = (await prisma.guildMemberCustomRole.findMany({
    where: { guildId, userId },
    include: { role: { select: { guildId: true, permissions: true } } }
  })).filter((assignment) => assignment.role.guildId === guildId);
  const granted = new Set(assignments.flatMap((assignment) => assignment.role.permissions));
  const permissions = { ...base };
  for (const capability of customRolePermissionKeys) {
    if (granted.has(capability)) permissions[capabilityField[capability]] = true;
  }
  return { membership, permissions };
}

export async function requireGuildCapability(userId: string, guildId: string, capability: GuildCapability) {
  const { membership, permissions } = await effectiveGuildPermissionsForUser(userId, guildId);
  if (!permissions[capabilityField[capability]]) throw new HttpError(403, capabilityMessage[capability]);
  return { membership, permissions };
}

export async function requireAnyGuildCapability(userId: string, guildId: string, capabilities: GuildCapability[]) {
  const { membership, permissions } = await effectiveGuildPermissionsForUser(userId, guildId);
  if (!capabilities.some((capability) => permissions[capabilityField[capability]])) {
    throw new HttpError(403, "Voce nao possui permissao para acessar esta area");
  }
  return { membership, permissions };
}

export async function requireGuildManager(userId: string, guildId: string) {
  const { membership } = await requireGuildCapability(userId, guildId, "manageServer");
  return membership;
}

export async function requireGuildOwner(userId: string, guildId: string) {
  const membership = await requireGuildMember(userId, guildId);
  if (membership.role !== "OWNER") throw new HttpError(403, "Somente o proprietario pode realizar esta acao");
  return membership;
}

export function roleCanManageRole(actorRole: GuildRole, targetRole: GuildRole, nextRole: GuildRole): boolean {
  if (targetRole === "OWNER" || nextRole === "OWNER") return false;
  return roleRank[actorRole] > roleRank[targetRole] && roleRank[actorRole] > roleRank[nextRole];
}

async function requireModerationHierarchy(
  actorUserId: string,
  guildId: string,
  targetUserId: string,
  actor: { role: GuildRole }
) {
  if (actorUserId === targetUserId) throw new HttpError(400, "Voce nao pode aplicar esta acao a si mesmo");
  const targetIdentity = await prisma.user.findUnique({
    where: { id: targetUserId },
    select: { id: true, accountType: true }
  });
  if (!targetIdentity) throw new HttpError(404, "Membro nao encontrado");
  if (targetIdentity.accountType !== "HUMAN") {
    throw new HttpError(403, "Identidades do sistema, bots e webhooks nao podem ser moderadas como membros");
  }
  const target = await prisma.guildMember.findUnique({ where: { guildId_userId: { guildId, userId: targetUserId } } });
  if (!target) throw new HttpError(404, "Membro nao encontrado");
  if (target.role === "OWNER") throw new HttpError(403, "O proprietario do espaco nao pode ser moderado");

  const actorFixedRank = roleRank[actor.role];
  const targetFixedRank = roleRank[target.role];
  if (actorFixedRank < targetFixedRank) throw new HttpError(403, "Voce nao pode moderar um membro com cargo superior ao seu");

  if (actorFixedRank === targetFixedRank) {
    // Funcoes estruturais iguais continuam protegidas, com uma excecao intencional:
    // MEMBER pode receber uma funcao de moderacao via cargo personalizado. Nesse caso
    // a posicao do cargo personalizado define quem pode moderar quem.
    if (actor.role !== "MEMBER" || target.role !== "MEMBER") {
      throw new HttpError(403, "Voce nao pode moderar um membro com funcao estrutural igual a sua");
    }

    const [actorTopRole, targetTopRole] = await Promise.all([
      prisma.guildCustomRole.findFirst({
        where: { guildId, assignments: { some: { userId: actorUserId } } },
        orderBy: [{ position: "desc" }, { createdAt: "asc" }],
        select: { position: true }
      }),
      prisma.guildCustomRole.findFirst({
        where: { guildId, assignments: { some: { userId: targetUserId } } },
        orderBy: [{ position: "desc" }, { createdAt: "asc" }],
        select: { position: true }
      })
    ]);
    const actorPosition = actorTopRole?.position ?? -1;
    const targetPosition = targetTopRole?.position ?? -1;
    if (actorPosition <= targetPosition) {
      throw new HttpError(403, "Voce nao pode moderar um membro com cargo personalizado igual ou superior ao seu");
    }
  }
  return target;
}

export async function requireModerationTarget(
  actorUserId: string,
  guildId: string,
  targetUserId: string,
  capability: "kickMembers" | "moveMembers" | "muteMembers" | "deafenMembers" | "manageNicknames" | "banMembers"
) {
  const { membership: actor } = await requireGuildCapability(actorUserId, guildId, capability);
  const target = await requireModerationHierarchy(actorUserId, guildId, targetUserId, actor);
  return { actor, target };
}

export async function requireModerationTargetAny(
  actorUserId: string,
  guildId: string,
  targetUserId: string,
  capabilities: Array<"manageMembers" | "kickMembers" | "moveMembers" | "muteMembers" | "deafenMembers" | "manageNicknames" | "banMembers">
) {
  const { membership: actor } = await requireAnyGuildCapability(actorUserId, guildId, capabilities);
  const target = await requireModerationHierarchy(actorUserId, guildId, targetUserId, actor);
  return { actor, target };
}

export async function requireChannelMember(userId: string, channelId: string) {
  const channel = await prisma.channel.findUnique({ where: { id: channelId } });
  if (!channel) throw new HttpError(404, "Canal nao encontrado");
  await requireGuildMember(userId, channel.guildId);
  return channel;
}

function resolveCustomOverride(
  overrides: Array<{ canView: boolean | null; canSendMessages: boolean | null; canConnect: boolean | null }>,
  capability: ChannelCapability
) {
  const field = capability === "view" ? "canView" : capability === "sendMessages" ? "canSendMessages" : "canConnect";
  if (overrides.some((item) => item[field] === false)) return false;
  if (overrides.some((item) => item[field] === true)) return true;
  return null;
}

export async function requireChannelCapability(userId: string, channelId: string, capability: ChannelCapability) {
  const channel = await prisma.channel.findUnique({
    where: { id: channelId },
    include: {
      permissions: true,
      customRolePermissions: true,
      userPermissions: true,
      category: { include: { permissions: true, customRolePermissions: true, userPermissions: true } },
      guild: { select: { lockdownEnabled: true, lockdownReason: true } }
    }
  });
  if (!channel) throw new HttpError(404, "Canal nao encontrado");

  const membership = await requireGuildMember(userId, channel.guildId);
  if (capability !== "view" && membership.timeoutUntil && membership.timeoutUntil.getTime() > Date.now()) {
    const remainingMinutes = Math.max(1, Math.ceil((membership.timeoutUntil.getTime() - Date.now()) / 60_000));
    throw new HttpError(403, `Voce esta em timeout neste servidor por mais ${remainingMinutes} min.`);
  }
  if (membership.role === "OWNER" || membership.role === "ADMIN") return { channel, membership };

  const assignments = (await prisma.guildMemberCustomRole.findMany({
    where: { guildId: channel.guildId, userId },
    include: { role: { select: { guildId: true, permissions: true } } }
  })).filter((assignment) => assignment.role.guildId === channel.guildId);

  if (capability !== "view" && membership.role === "MEMBER" && channel.guild.lockdownEnabled) {
    const staffCapabilities = new Set(["manageServer", "manageMessages", "manageMembers", "kickMembers", "moveMembers", "muteMembers", "deafenMembers", "manageNicknames", "banMembers", "manageAutoMod"]);
    const customStaff = assignments.some((assignment) => assignment.role.permissions.some((permission) => staffCapabilities.has(permission)));
    const basePermissions = await effectiveGuildPermissions(channel.guildId, membership.role);
    const baseStaff = basePermissions.canManageServer || basePermissions.canManageMessages || basePermissions.canManageMembers
      || basePermissions.canKickMembers || basePermissions.canMoveMembers || basePermissions.canMuteMembers || basePermissions.canDeafenMembers || basePermissions.canManageNicknames || basePermissions.canBanMembers || basePermissions.canManageAutoMod;
    if (!customStaff && !baseStaff) {
      const reason = channel.guild.lockdownReason.trim();
      throw new HttpError(423, reason ? `Servidor em modo de contencao: ${reason}` : "Servidor em modo de contencao. Aguarde a equipe liberar mensagens e voz.");
    }
  }

  // Uma categoria vinculada a outro guild jamais participa do calculo de permissao.
  // Isto tambem neutraliza registros legados/corrompidos no banco.
  const inheritedCategory = channel.category?.guildId === channel.guildId ? channel.category : null;
  const permissionSource = inheritedCategory && channel.syncPermissionsWithCategory
    ? inheritedCategory.permissions
    : channel.permissions;
  const permission = permissionSource.find((item) => item.role === membership.role);

  let allowed = capability === "view"
    ? permission?.canView ?? true
    : capability === "sendMessages"
      ? (permission?.canView ?? true) && (permission?.canSendMessages ?? true)
      : (permission?.canView ?? true) && (permission?.canConnect ?? true);

  const roleIds = new Set(assignments.map((item) => item.roleId));
  const customSource = inheritedCategory && channel.syncPermissionsWithCategory
    ? inheritedCategory.customRolePermissions
    : channel.customRolePermissions;
  const relevant = customSource.filter((item) => roleIds.has(item.roleId));
  const override = resolveCustomOverride(relevant, capability);
  if (override !== null) allowed = override;
  const individualSource = inheritedCategory && channel.syncPermissionsWithCategory ? inheritedCategory.userPermissions : channel.userPermissions;
  const individual = individualSource.find((item) => item.userId === userId);
  const individualField = capability === "view" ? individual?.canView : capability === "sendMessages" ? individual?.canSendMessages : individual?.canConnect;
  if (individualField !== null && individualField !== undefined) allowed = individualField;
  if (capability !== "view" && allowed) {
    const viewOverride = resolveCustomOverride(relevant, "view");
    const individualView = individual?.canView;
    if (individualView === false || (individualView == null && (viewOverride === false || (viewOverride === null && permission?.canView === false)))) allowed = false;
  }

  if (!allowed) {
    const messages: Record<ChannelCapability, string> = {
      view: "Voce nao pode visualizar este canal",
      sendMessages: "Voce nao pode enviar mensagens neste canal",
      connect: "Voce nao pode entrar nesta chamada"
    };
    throw new HttpError(403, messages[capability]);
  }

  return { channel, membership };
}

export async function requireDirectMember(userId: string, conversationId: string) {
  const membership = await prisma.directConversationMember.findUnique({
    where: { conversationId_userId: { conversationId, userId } },
    include: { conversation: true }
  });
  if (!membership) throw new HttpError(403, "Voce nao participa desta conversa");
  return membership;
}

export async function requireAcceptedFriendship(userId: string, otherUserId: string) {
  if (userId === otherUserId) throw new HttpError(400, "Escolha outro usuario");
  const friendship = await prisma.friendship.findFirst({
    where: {
      status: "ACCEPTED",
      OR: [
        { requesterId: userId, addresseeId: otherUserId },
        { requesterId: otherUserId, addresseeId: userId }
      ]
    }
  });
  if (!friendship) throw new HttpError(403, "Adicione esta pessoa como amiga antes de iniciar uma conversa privada");
  return friendship;
}
