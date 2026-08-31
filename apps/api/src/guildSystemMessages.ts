import { prisma } from "./db.js";
import { emitNewGuildMessage } from "./guildMessageEvents.js";

export type GuildMemberSystemEvent = "JOIN" | "LEAVE";

const SYSTEM_USER_ID = "ginga-system";
const SYSTEM_USER_EMAIL = "__ginga_system__@local.invalid";
const SYSTEM_USERNAME = "ginga-system";

const systemMessageInclude = {
  author: { select: { id: true, username: true, displayName: true, avatarColor: true, systemRole: true, platformOwner: true, accountType: true } },
  attachments: { orderBy: { createdAt: "asc" as const } },
  reactions: { include: { user: { select: { id: true, username: true, displayName: true } } }, orderBy: { createdAt: "asc" as const } },
  replyTo: { include: { author: { select: { id: true, username: true, displayName: true, avatarColor: true, systemRole: true, platformOwner: true, accountType: true } } } }
};

async function ensureSystemUser() {
  return prisma.user.upsert({
    where: { id: SYSTEM_USER_ID },
    update: { accountType: "SYSTEM", displayName: "Ginga" },
    create: {
      id: SYSTEM_USER_ID,
      email: SYSTEM_USER_EMAIL,
      username: SYSTEM_USERNAME,
      displayName: "Ginga",
      passwordHash: "login-disabled-for-system-account",
      avatarColor: "#5865f2",
      accountType: "SYSTEM"
    }
  });
}

async function resolveSystemChannel(guildId: string, configuredChannelId: string | null, welcomeChannelId: string | null) {
  const candidates = [configuredChannelId, welcomeChannelId].filter((value): value is string => Boolean(value));
  for (const channelId of candidates) {
    const channel = await prisma.channel.findFirst({
      where: { id: channelId, guildId, type: { in: ["TEXT", "ANNOUNCEMENT"] } },
      select: { id: true, name: true, guildId: true }
    });
    if (channel) return channel;
  }

  return prisma.channel.findFirst({
    where: { guildId, type: { in: ["TEXT", "ANNOUNCEMENT"] } },
    orderBy: [{ position: "asc" }, { createdAt: "asc" }],
    select: { id: true, name: true, guildId: true }
  });
}

/**
 * Registra no proprio chat a entrada/saida de membros. A configuracao vive no
 * servidor e a escolha de canal possui fallback seguro para boas-vindas ou o
 * primeiro canal de texto disponivel.
 */
export async function postGuildMemberSystemMessage(
  io: any,
  guildId: string,
  memberUserId: string,
  event: GuildMemberSystemEvent
) {
  const guild = await prisma.guild.findUnique({
    where: { id: guildId },
    select: {
      id: true,
      name: true,
      welcomeChannelId: true,
      memberJoinMessagesEnabled: true,
      memberLeaveMessagesEnabled: true,
      memberSystemMessageChannelId: true
    }
  });
  if (!guild) return null;
  if (event === "JOIN" && !guild.memberJoinMessagesEnabled) return null;
  if (event === "LEAVE" && !guild.memberLeaveMessagesEnabled) return null;

  const [member, channel] = await Promise.all([
    prisma.user.findUnique({
      where: { id: memberUserId },
      select: { id: true, username: true, displayName: true }
    }),
    resolveSystemChannel(guildId, guild.memberSystemMessageChannelId, guild.welcomeChannelId)
  ]);
  if (!member || !channel) return null;

  const systemUser = await ensureSystemUser();
  const content = event === "JOIN"
    ? `👋 ${member.displayName} entrou no servidor.`
    : `👋 ${member.displayName} saiu do servidor.`;

  const message = await prisma.message.create({
    data: { channelId: channel.id, authorId: systemUser.id, content },
    include: systemMessageInclude
  });

  if (io) await emitNewGuildMessage(io, { id: channel.id, guildId, name: channel.name }, message);
  return message;
}
