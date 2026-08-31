import type { Server } from "socket.io";
import { enforceAutoMod } from "./automod.js";
import { prisma } from "./db.js";
import { HttpError } from "./errors.js";
import { emitNewGuildMessage } from "./guildMessageEvents.js";
import { validateGuildMentions } from "./mentions.js";
import { requireChannelCapability, requireGuildCapability } from "./permissions.js";

async function flushScheduledMessages(io: Server) {
  const pending = await prisma.scheduledMessage.findMany({
    where: { status: "PENDING", scheduledFor: { lte: new Date() } },
    orderBy: { scheduledFor: "asc" },
    take: 50
  });

  for (const item of pending) {
    try {
      let deliveryChannel: { id: string; guildId: string; name: string; type: string } | null = null;
      try {
        const result = await requireChannelCapability(item.authorId, item.channelId, "sendMessages");
        deliveryChannel = { id: result.channel.id, guildId: result.channel.guildId, name: result.channel.name, type: result.channel.type };
        if (!["TEXT", "ANNOUNCEMENT", "FORUM", "EVENT"].includes(deliveryChannel.type)) {
          throw new HttpError(409, "O canal agendado nao aceita mensagens de texto");
        }
        await requireGuildCapability(item.authorId, deliveryChannel.guildId, "scheduleMessages");
        const mentions = await validateGuildMentions(deliveryChannel.guildId, item.content);
        if (mentions.mentionEveryone) await requireGuildCapability(item.authorId, deliveryChannel.guildId, "mentionEveryone");
        await enforceAutoMod({ guildId: deliveryChannel.guildId, channelId: deliveryChannel.id, userId: item.authorId, content: item.content });
      } catch (error) {
        if (!(error instanceof HttpError)) throw error;
        await prisma.scheduledMessage.updateMany({ where: { id: item.id, status: "PENDING" }, data: { status: "CANCELLED" } });
        console.warn("Mensagem agendada cancelada por permissao/regra atual", item.id, error.message);
        continue;
      }

      if (!deliveryChannel) continue;

      const message = await prisma.$transaction(async (tx) => {
        const channelState = await tx.channel.findUnique({
          where: { id: item.channelId },
          select: { guildId: true, guild: { select: { lockdownEnabled: true } } }
        });
        if (channelState?.guild.lockdownEnabled) {
          const membership = await tx.guildMember.findUnique({
            where: { guildId_userId: { guildId: channelState.guildId, userId: item.authorId } },
            select: { role: true }
          });
          if (membership?.role === "MEMBER") {
            const [basePermissions, customRoles] = await Promise.all([
              tx.guildRolePermission.findUnique({
                where: { guildId_role: { guildId: channelState.guildId, role: "MEMBER" } },
                select: { canManageServer: true, canManageMessages: true, canManageMembers: true, canKickMembers: true, canMoveMembers: true, canMuteMembers: true, canDeafenMembers: true, canManageNicknames: true, canBanMembers: true, canManageAutoMod: true }
              }),
              tx.guildMemberCustomRole.findMany({
                where: { guildId: channelState.guildId, userId: item.authorId },
                include: { role: { select: { permissions: true } } }
              })
            ]);
            const staffCapabilities = new Set(["manageServer", "manageMessages", "manageMembers", "kickMembers", "moveMembers", "muteMembers", "deafenMembers", "manageNicknames", "banMembers", "manageAutoMod"]);
            const customStaff = customRoles.some((assignment) => assignment.role.permissions.some((permission) => staffCapabilities.has(permission)));
            const baseStaff = Boolean(basePermissions && (basePermissions.canManageServer || basePermissions.canManageMessages || basePermissions.canManageMembers
              || basePermissions.canKickMembers || basePermissions.canMoveMembers || basePermissions.canMuteMembers || basePermissions.canDeafenMembers || basePermissions.canManageNicknames || basePermissions.canBanMembers || basePermissions.canManageAutoMod));
            if (!customStaff && !baseStaff) {
              // Mantem a mensagem pendente e evita que um lote vencido ocupe a fila durante a contencao.
              await tx.scheduledMessage.updateMany({
                where: { id: item.id, status: "PENDING" },
                data: { scheduledFor: new Date(Date.now() + 60_000) }
              });
              return null;
            }
          }
        }

        const claimed = await tx.scheduledMessage.updateMany({
          where: { id: item.id, status: "PENDING" },
          data: { status: "SENT" }
        });
        if (!claimed.count) return null;
        const created = await tx.message.create({ data: { channelId: item.channelId, authorId: item.authorId, content: item.content } });
        await tx.scheduledMessage.update({ where: { id: item.id }, data: { sentMessageId: created.id } });
        return tx.message.findUniqueOrThrow({
          where: { id: created.id },
          include: {
            author: { select: { id: true, username: true, displayName: true, avatarColor: true, systemRole: true, platformOwner: true, accountType: true } },
            attachments: true,
            reactions: { include: { user: { select: { id: true, username: true, displayName: true } } } },
            replyTo: { include: { author: { select: { id: true, username: true, displayName: true, avatarColor: true, systemRole: true, platformOwner: true, accountType: true } } } }
          }
        });
      });
      if (message) {
        await emitNewGuildMessage(io, { id: deliveryChannel.id, guildId: deliveryChannel.guildId, name: deliveryChannel.name }, message);
      }
    } catch (error) {
      console.error("Falha ao enviar mensagem agendada", item.id, error);
    }
  }
}

async function expireGuildBans() {
  const result = await prisma.guildBan.deleteMany({ where: { expiresAt: { lte: new Date() } } });
  if (result.count) console.log(`Banimentos temporarios expirados: ${result.count}`);
}

export function scheduleBackgroundJobs(io: Server) {
  void flushScheduledMessages(io);
  void expireGuildBans();
  const scheduledTimer = setInterval(() => void flushScheduledMessages(io), 10_000);
  const banTimer = setInterval(() => void expireGuildBans(), 60_000);
  scheduledTimer.unref();
  banTimer.unref();
}
