import type { Server } from "socket.io";
import { prisma } from "./db.js";
import { extractGuildMentions } from "./mentions.js";
import { requireChannelCapability } from "./permissions.js";

type GuildMessageChannel = {
  id: string;
  guildId: string;
  name: string;
};

type GuildMessageAuthor = {
  id: string;
  username: string;
  displayName: string;
  avatarColor: string;
};

type GuildMessage = {
  id: string;
  authorId: string;
  content: string;
  createdAt: Date;
  author: GuildMessageAuthor;
  attachments?: readonly unknown[];
};

type HumanSocket = {
  id: string;
  data: { auth?: { sub?: string }; bot?: unknown; channelId?: string };
  emit: (event: string, payload: unknown) => unknown;
  leave: (room: string) => Promise<void> | void;
};

type BotInstallForDelivery = {
  applicationId: string;
  permissions: string[];
  application: {
    botUserId: string | null;
    messageContentIntent: boolean;
  };
};

type BotSocket = {
  data: {
    bot?: {
      applicationId?: string;
      botUserId?: string;
      intents?: string[];
    };
  };
  emit: (event: string, payload: unknown) => unknown;
};

async function usersWhoCanViewChannel(userIds: string[], channelId: string) {
  const uniqueIds = Array.from(new Set(userIds));
  const checks = await Promise.all(uniqueIds.map(async (targetUserId) => {
    try {
      await requireChannelCapability(targetUserId, channelId, "view");
      return targetUserId;
    } catch {
      return null;
    }
  }));
  return new Set(checks.filter((value): value is string => Boolean(value)));
}

/**
 * Emite um evento de canal somente para sockets HUMAN que ainda possuem acesso
 * efetivo ao canal no momento do envio. Isto evita que um socket que entrou no
 * room antes de uma revogacao de cargo/ACL continue recebendo conteudo privado.
 */
export async function emitChannelEventToAuthorizedHumans(io: Server, channelId: string, event: string, payload: unknown) {
  const sockets = await io.in(`channel:${channelId}`).fetchSockets() as unknown as HumanSocket[];
  const humanSockets = sockets.filter((socket) => !socket.data.bot && typeof socket.data.auth?.sub === "string");
  const allowedIds = await usersWhoCanViewChannel(
    humanSockets.map((socket) => socket.data.auth!.sub!),
    channelId
  );

  await Promise.all(humanSockets.map(async (socket) => {
    const userId = socket.data.auth?.sub;
    if (!userId || !allowedIds.has(userId)) {
      await socket.leave(`channel:${channelId}`);
      if (socket.data.channelId === channelId) socket.data.channelId = undefined;
      return;
    }
    socket.emit(event, payload);
  }));
}

async function emitGuildActivityToAuthorizedHumans(io: Server, channel: GuildMessageChannel, payload: unknown) {
  const sockets = await io.in(`guild:${channel.guildId}`).fetchSockets() as unknown as HumanSocket[];
  const humanSockets = sockets.filter((socket) => !socket.data.bot && typeof socket.data.auth?.sub === "string");
  const allowedIds = await usersWhoCanViewChannel(
    humanSockets.map((socket) => socket.data.auth!.sub!),
    channel.id
  );

  for (const socket of humanSockets) {
    const userId = socket.data.auth?.sub;
    if (userId && allowedIds.has(userId)) socket.emit("guild:message:new", payload);
  }
}

async function emitGuildActivityToAuthorizedBots(io: Server, channel: GuildMessageChannel, payload: unknown) {
  // Intents vivem no handshake do socket; instalacao/permissoes vivem no banco.
  // Revalidamos ambos a cada mensagem para que revogacoes de ACL tenham efeito
  // imediato, sem depender de reconnect ou de rooms antigos do Socket.IO.
  const sockets = await io.fetchSockets() as unknown as BotSocket[];
  const botSockets = sockets.filter((socket) => {
    const bot = socket.data.bot;
    if (!bot?.applicationId || !bot.botUserId) return false;
    const intents = new Set(bot.intents ?? []);
    return intents.has("GUILD_MESSAGES") && intents.has("MESSAGE_CONTENT");
  });
  if (botSockets.length === 0) return;

  const applicationIds = Array.from(new Set(botSockets.map((socket) => socket.data.bot!.applicationId!)));
  const installs = await prisma.botInstall.findMany({
    where: { guildId: channel.guildId, applicationId: { in: applicationIds } },
    select: { applicationId: true, permissions: true, application: { select: { botUserId: true, messageContentIntent: true } } }
  });

  const installByApplication = new Map<string, BotInstallForDelivery>(installs.map((install) => [install.applicationId, install]));
  const candidateBotUserIds: string[] = [];
  for (const socket of botSockets) {
    const bot = socket.data.bot!;
    const install = installByApplication.get(bot.applicationId!);
    if (!install?.application.messageContentIntent || !install.permissions.includes("VIEW_CHANNELS")) continue;
    if (!install.application.botUserId || install.application.botUserId !== bot.botUserId) continue;
    candidateBotUserIds.push(bot.botUserId!);
  }

  const allowedBotIds = await usersWhoCanViewChannel(candidateBotUserIds, channel.id);
  for (const socket of botSockets) {
    const bot = socket.data.bot!;
    const install = installByApplication.get(bot.applicationId!);
    if (!install?.application.messageContentIntent || !install.permissions.includes("VIEW_CHANNELS")) continue;
    if (!bot.botUserId || install.application.botUserId !== bot.botUserId || !allowedBotIds.has(bot.botUserId)) continue;
    socket.emit("guild:message:new", payload);
  }
}

async function emitMentionNotifications(io: Server, channel: GuildMessageChannel, message: GuildMessage) {
  const mentions = extractGuildMentions(message.content);
  if (!mentions.mentionEveryone && mentions.usernames.length === 0) return;

  const directMembers = mentions.usernames.length > 0
    ? await prisma.guildMember.findMany({
        where: { guildId: channel.guildId, user: { username: { in: mentions.usernames } } },
        select: { userId: true }
      })
    : [];

  const directIds = new Set<string>(directMembers.map((member) => member.userId));
  let candidateIds: string[] = Array.from(directIds);
  if (mentions.mentionEveryone) {
    const allMembers = await prisma.guildMember.findMany({ where: { guildId: channel.guildId }, select: { userId: true } });
    candidateIds = Array.from(new Set<string>([...candidateIds, ...allMembers.map((member) => member.userId)]));
  }
  candidateIds = candidateIds.filter((targetUserId) => targetUserId !== message.authorId);
  if (candidateIds.length === 0) return;

  const allowedIds = await usersWhoCanViewChannel(candidateIds, channel.id);
  if (allowedIds.size === 0) return;
  const guild = await prisma.guild.findUnique({ where: { id: channel.guildId }, select: { name: true } });

  for (const targetUserId of allowedIds) {
    io.to(`user:${targetUserId}`).emit("notification:message", {
      kind: directIds.has(targetUserId) ? "MENTION" : "EVERYONE",
      messageId: message.id,
      channelId: channel.id,
      channelName: channel.name,
      guildId: channel.guildId,
      guildName: guild?.name ?? "Espaco",
      content: message.content,
      author: message.author
    });
  }
}

/**
 * Entrega a atividade de mensagem com autorizacao dinamica. O payload com
 * conteudo nunca e broadcast para o room inteiro do servidor: humanos e bots
 * sao filtrados pela ACL atual do canal antes de receberem o evento.
 */
export async function emitGuildMessageActivity(io: Server, channel: GuildMessageChannel, message: GuildMessage) {
  const guildMessageEvent = {
    messageId: message.id,
    channelId: channel.id,
    channelName: channel.name,
    guildId: channel.guildId,
    authorId: message.authorId,
    author: message.author,
    content: message.content,
    hasAttachments: Boolean(message.attachments?.length),
    createdAt: message.createdAt
  };

  await Promise.all([
    emitGuildActivityToAuthorizedHumans(io, channel, guildMessageEvent),
    emitGuildActivityToAuthorizedBots(io, channel, guildMessageEvent),
    emitMentionNotifications(io, channel, message)
  ]);
}

export async function emitNewGuildMessage(io: Server, channel: GuildMessageChannel, message: GuildMessage) {
  await Promise.all([
    emitChannelEventToAuthorizedHumans(io, channel.id, "message:new", message),
    emitGuildMessageActivity(io, channel, message)
  ]);
}
