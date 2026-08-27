import { config } from "./config.js";
import { prisma } from "./db.js";

export const SECURITY_POLICY_VERSION = 5;

export async function applySecurityPolicyMigrations() {
  const guilds = await prisma.guild.findMany({
    where: { securityPolicyVersion: { lt: SECURITY_POLICY_VERSION } },
    select: { id: true }
  });

  for (const guild of guilds) {
    await prisma.$transaction([
      prisma.guildRolePermission.upsert({
        where: { guildId_role: { guildId: guild.id, role: "MODERATOR" } },
        update: {
          canManageMessages: true,
          canKickMembers: true,
          canMoveMembers: true,
          canMuteMembers: true,
          canDeafenMembers: true,
          canManageNicknames: true,
          canBanMembers: true,
          canViewAuditLog: true,
          canCreateInvites: true,
          canManageEvents: true,
          canManageForums: true,
          canPinMessages: true,
          canShareScreen: true,
          canUseVideo: true
        },
        create: {
          guildId: guild.id,
          role: "MODERATOR",
          canManageMessages: true,
          canKickMembers: true,
          canMoveMembers: true,
          canMuteMembers: true,
          canDeafenMembers: true,
          canManageNicknames: true,
          canBanMembers: true,
          canViewAuditLog: true,
          canCreateInvites: true,
          canManageEvents: true,
          canManageForums: true,
          canPinMessages: true,
          canShareScreen: true,
          canUseVideo: true
        }
      }),
      prisma.guildRolePermission.upsert({
        where: { guildId_role: { guildId: guild.id, role: "MEMBER" } },
        update: { canShareScreen: true, canUseVideo: true },
        create: {
          guildId: guild.id,
          role: "MEMBER",
          canCreateInvites: true,
          canShareScreen: true,
          canUseVideo: true
        }
      }),
      prisma.guild.update({
        where: { id: guild.id },
        data: { securityPolicyVersion: SECURITY_POLICY_VERSION }
      })
    ]);
  }

  const existingOwner = await prisma.user.findFirst({
    where: { accountType: "HUMAN", platformOwner: true },
    select: { id: true, username: true }
  });
  if (!existingOwner && config.platformOwnerUsername) {
    const configuredOwner = await prisma.user.findFirst({
      where: { accountType: "HUMAN", username: config.platformOwnerUsername },
      select: { id: true, username: true }
    });
    if (configuredOwner) {
      await prisma.user.update({
        where: { id: configuredOwner.id },
        data: { systemRole: "PLATFORM_ADMIN", platformOwner: true }
      });
      console.log(`Proprietario global Ginga configurado: @${configuredOwner.username}`);
    } else {
      console.warn(`PLATFORM_OWNER_USERNAME=@${config.platformOwnerUsername} ainda nao existe; nenhum usuario foi promovido automaticamente.`);
    }
  } else if (!existingOwner) {
    console.warn("Nenhum proprietario global configurado. Defina PLATFORM_OWNER_USERNAME ou promova um administrador existente de forma explicita.");
  }


  if (guilds.length > 0) {
    console.log(`Politica de seguranca v${SECURITY_POLICY_VERSION} aplicada a ${guilds.length} espaco(s).`);
  }
}
