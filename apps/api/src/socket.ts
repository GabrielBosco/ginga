import type { Server as HttpServer } from "node:http";
import { Server } from "socket.io";
import { z } from "zod";
import { verifyToken } from "./auth.js";
import { isAuthSessionActive } from "./authSessions.js";
import { enforceAutoMod } from "./automod.js";
import { config } from "./config.js";
import { prisma } from "./db.js";
import { HttpError } from "./errors.js";
import { requireChannelCapability, requireDirectMember, requireGuildCapability, requireGuildMember, requireModerationTarget } from "./permissions.js";
import { removeUserFromGuildMedia } from "./mediaAdmin.js";
import { emitNewGuildMessage } from "./guildMessageEvents.js";
import { EVERYONE_MENTION_PATTERN, validateGuildMentions } from "./mentions.js";
import { secretMatches, tokenPrefix } from "./secretTokens.js";
import { observableUserIds, presenceAudienceUserIds, presenceModeHidden } from "./socialPrivacy.js";
import { ensureV090Storage } from "./v090Storage.js";

const joinSchema = z.object({ channelId: z.string().min(1) });
const guildWatchSchema = z.object({ guildId: z.string().min(1) });
const voicePresenceSchema = z.object({ channelId: z.string().min(1) });
const voiceStateSchema = z.object({ channelId: z.string().min(1), micMuted: z.boolean(), deafened: z.boolean(), streaming: z.boolean().optional() });
const voiceSyncSchema = voiceStateSchema;
const voiceMoveSchema = z.object({ targetUserId: z.string().min(1), targetChannelId: z.string().min(1) });
const voiceDisconnectSchema = z.object({ guildId: z.string().min(1), targetUserId: z.string().min(1) });
const voiceAfkSchema = z.object({ guildId: z.string().min(1) });
const voiceStreamWatchSchema = z.object({ channelId: z.string().min(1), broadcasterId: z.string().min(1) });
const voiceSoundboardPlaySchema = z.object({ channelId: z.string().min(1), soundId: z.string().min(1) });
const presenceQuerySchema = z.object({ userIds: z.array(z.string().min(1)).max(300) });
const directSchema = z.object({ conversationId: z.string().min(1) });
const messageSchema = z.object({
  channelId: z.string().min(1),
  content: z.string().trim().max(4000).default(""),
  attachmentIds: z.array(z.string()).max(10).default([]),
  replyToId: z.string().min(1).nullable().optional()
}).refine((value) => value.content.length > 0 || value.attachmentIds.length > 0, {
  message: "A mensagem precisa ter texto ou anexo"
});
const directMessageSchema = z.object({
  conversationId: z.string().min(1),
  content: z.string().trim().max(4000).default(""),
  attachmentIds: z.array(z.string()).max(10).default([]),
  replyToId: z.string().min(1).nullable().optional()
}).refine((value) => value.content.length > 0 || value.attachmentIds.length > 0, {
  message: "A mensagem precisa ter texto ou anexo"
});

type Ack = (response: { ok: true; [key: string]: unknown } | { ok: false; error: string }) => void;

type RateBucket = { count: number; resetAt: number };
type GingaSocketServer = Server & {
  gingaRemoveUserFromGuildVoice?: (guildId: string, userId: string, reason?: string) => boolean;
  gingaSetUserVoiceModeration?: (guildId: string, userId: string, state: { muted?: boolean; deafened?: boolean }) => boolean;
};
const onlineCounts = new Map<string, number>();

export function onlineUserCountForIds(userIds: readonly string[]) {
  let count = 0;
  for (const userId of userIds) if ((onlineCounts.get(userId) ?? 0) > 0) count += 1;
  return count;
}

export function isUserOnlineNow(userId: string) { return (onlineCounts.get(userId) ?? 0) > 0; }

function consumeSocketBudget(socket: { data: Record<string, any> }, key: string, limit: number, windowMs: number) {
  const now = Date.now();
  const buckets = (socket.data.rateBuckets ??= new Map<string, RateBucket>()) as Map<string, RateBucket>;
  const current = buckets.get(key);
  if (!current || current.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return;
  }
  if (current.count >= limit) throw new HttpError(429, "Muitas acoes em pouco tempo. Aguarde alguns segundos.");
  current.count += 1;
}

type VoicePresenceUser = {
  id: string;
  username: string;
  displayName: string;
  avatarColor: string;
  micMuted?: boolean;
  deafened?: boolean;
  serverMuted?: boolean;
  serverDeafened?: boolean;
  streaming?: boolean;
};

type VoiceSession = {
  userId: string;
  guildId: string;
  channelId: string;
  micMuted: boolean;
  deafened: boolean;
  serverMuted: boolean;
  serverDeafened: boolean;
  streaming: boolean;
  user: VoicePresenceUser;
};

function errorMessage(error: unknown): string {
  if (error instanceof HttpError) return error.message;
  if (error instanceof z.ZodError) return "Dados invalidos";
  console.error(error);
  return "Erro interno ao processar a solicitacao";
}

function buildVoicePresence(voiceSessions: Map<string, VoiceSession>, guildId: string, revision = 0) {
  const channels: Record<string, VoicePresenceUser[]> = {};
  const seenByChannel = new Map<string, Set<string>>();

  for (const session of voiceSessions.values()) {
    if (session.guildId !== guildId) continue;
    const seen = seenByChannel.get(session.channelId) ?? new Set<string>();
    if (seen.has(session.userId)) continue;
    seen.add(session.userId);
    seenByChannel.set(session.channelId, seen);
    (channels[session.channelId] ??= []).push({
      ...session.user,
      micMuted: session.serverMuted || session.serverDeafened || session.micMuted,
      deafened: session.serverDeafened || session.deafened,
      serverMuted: session.serverMuted,
      serverDeafened: session.serverDeafened,
      streaming: session.streaming
    });
  }

  for (const users of Object.values(channels)) {
    users.sort((a, b) => a.displayName.localeCompare(b.displayName, "pt-BR", { sensitivity: "base" }));
  }

  return { guildId, channels, revision };
}

export function setupSocket(server: HttpServer) {
  const io = new Server(server, {
    cors: { origin: config.appOrigins, methods: ["GET", "POST"] },
    connectionStateRecovery: {
      maxDisconnectionDuration: 2 * 60 * 1000,
      skipMiddlewares: false
    },
    maxHttpBufferSize: 1_000_000
  });

  const voiceSessions = new Map<string, VoiceSession>();
  const voicePresenceRevisions = new Map<string, number>();
  const streamWatchers = new Map<string, { guildId: string; channelId: string; broadcasterId: string; viewers: Map<string, string> }>();
  const soundboardChannelLastAt = new Map<string, number>();

  const streamWatchKey = (channelId: string, broadcasterId: string) => `${channelId}:${broadcasterId}`;

  function emitStreamViewerCount(group: { guildId: string; channelId: string; broadcasterId: string; viewers: Map<string, string> }) {
    const viewerIds = Array.from(new Set(group.viewers.values()));
    const count = viewerIds.length;
    const payload = { channelId: group.channelId, broadcasterId: group.broadcasterId, count, viewerIds };
    const audience = new Set<string>([group.broadcasterId, ...group.viewers.values()]);
    for (const session of voiceSessions.values()) if (session.channelId === group.channelId) audience.add(session.userId);
    for (const audienceUserId of audience) io.to(`user:${audienceUserId}`).emit("voice:stream-viewers", payload);
  }

  function clearSocketStreamWatches(socketId: string) {
    for (const [key, group] of streamWatchers) {
      if (!group.viewers.delete(socketId)) continue;
      if (group.viewers.size === 0) streamWatchers.delete(key);
      emitStreamViewerCount(group);
    }
  }

  function clearBroadcasterStream(channelId: string, broadcasterId: string, guildId: string) {
    const key = streamWatchKey(channelId, broadcasterId);
    const group = streamWatchers.get(key) ?? { guildId, channelId, broadcasterId, viewers: new Map<string, string>() };
    streamWatchers.delete(key);
    group.viewers.clear();
    emitStreamViewerCount(group);
  }

  function currentVoicePresenceRevision(guildId: string) {
    return voicePresenceRevisions.get(guildId) ?? 0;
  }

  async function filterVoicePresenceForUser(userId: string, payload: ReturnType<typeof buildVoicePresence>) {
    const channelIds = Object.keys(payload.channels);
    if (channelIds.length === 0) return payload;
    const checks = await Promise.all(channelIds.map(async (channelId) => {
      try {
        await requireChannelCapability(userId, channelId, "view");
        return channelId;
      } catch {
        return null;
      }
    }));
    const allowed = new Set(checks.filter((channelId): channelId is string => Boolean(channelId)));
    return {
      ...payload,
      channels: Object.fromEntries(Object.entries(payload.channels).filter(([channelId]) => allowed.has(channelId)))
    };
  }

  function emitVoicePresence(guildId: string) {
    const revision = currentVoicePresenceRevision(guildId) + 1;
    voicePresenceRevisions.set(guildId, revision);
    const payload = buildVoicePresence(voiceSessions, guildId, revision);

    void (async () => {
      // Nao envie a lista completa de voz para o room do servidor: um membro
      // pode nao ter permissao para visualizar um dos canais de voz privados.
      const humanSockets = await io.in(`guild:${guildId}`).fetchSockets();
      const humanByUser = new Map<string, (typeof humanSockets)[number][]>();
      for (const target of humanSockets) {
        const targetUserId = typeof target.data.auth?.sub === "string" ? target.data.auth.sub : "";
        if (!targetUserId || target.data.bot) continue;
        const list = humanByUser.get(targetUserId) ?? [];
        list.push(target);
        humanByUser.set(targetUserId, list);
      }
      for (const [targetUserId, sockets] of humanByUser) {
        const filtered = await filterVoicePresenceForUser(targetUserId, payload);
        for (const target of sockets) target.emit("voice:presence", filtered);
      }

      // Bots tambem recebem somente canais visiveis e apenas enquanto a
      // instalacao atual ainda permite visualizar canais neste servidor.
      const botSockets = await io.in(`botvoice:${guildId}`).fetchSockets();
      for (const target of botSockets) {
        const bot = target.data.bot as { applicationId?: string; botUserId?: string; intents?: string[] } | undefined;
        if (!bot?.applicationId || !bot.botUserId || !(bot.intents ?? []).includes("VOICE_STATES")) continue;
        const install = await prisma.botInstall.findUnique({
          where: { guildId_applicationId: { guildId, applicationId: bot.applicationId } },
          select: { permissions: true, application: { select: { botUserId: true } } }
        });
        if (!install?.permissions.includes("VIEW_CHANNELS") || install.application.botUserId !== bot.botUserId) continue;
        const filtered = await filterVoicePresenceForUser(bot.botUserId, payload);
        target.emit("voice:presence", filtered);
      }
    })().catch((error) => console.warn("Falha ao publicar presenca de voz filtrada", error));
  }

  (io as GingaSocketServer).gingaRemoveUserFromGuildVoice = (guildId: string, userId: string, reason = "MODERATION") => {
    const targetSessions = Array.from(voiceSessions.entries()).filter(([, session]) => session.guildId === guildId && session.userId === userId);
    if (targetSessions.length === 0) return false;
    for (const [socketId, session] of targetSessions) {
      voiceSessions.delete(socketId);
      clearSocketStreamWatches(socketId);
      if (session.streaming) clearBroadcasterStream(session.channelId, session.userId, session.guildId);
    }
    emitVoicePresence(guildId);
    io.to(`user:${userId}`).emit("voice:disconnected", { guildId, reason });
    return true;
  };

  (io as GingaSocketServer).gingaSetUserVoiceModeration = (guildId: string, userId: string, state: { muted?: boolean; deafened?: boolean }) => {
    const targetSessions = Array.from(voiceSessions.entries()).filter(([, session]) => session.guildId === guildId && session.userId === userId);
    for (const [socketId, session] of targetSessions) {
      voiceSessions.set(socketId, {
        ...session,
        ...(typeof state.muted === "boolean" ? { serverMuted: state.muted } : {}),
        ...(typeof state.deafened === "boolean" ? { serverDeafened: state.deafened } : {})
      });
    }
    if (targetSessions.length > 0) emitVoicePresence(guildId);
    io.to(`user:${userId}`).emit("voice:moderation-state", { guildId, ...state });
    return targetSessions.length > 0;
  };

  function claimVoiceSession(ownerSocketId: string, userId: string, channelId: string) {
    const affectedGuildIds = new Set<string>();
    for (const [socketId, session] of voiceSessions.entries()) {
      if (socketId === ownerSocketId || session.userId !== userId) continue;
      voiceSessions.delete(socketId);
      clearSocketStreamWatches(socketId);
      if (session.streaming) clearBroadcasterStream(session.channelId, session.userId, session.guildId);
      affectedGuildIds.add(session.guildId);
      io.to(socketId).emit("voice:session-replaced", {
        channelId: session.channelId,
        replacementChannelId: channelId,
        reason: "NEWER_CLIENT"
      });
    }
    for (const guildId of affectedGuildIds) emitVoicePresence(guildId);
  }

  function setUserOnline(userId: string, online: boolean) {
    if (online) onlineCounts.set(userId, (onlineCounts.get(userId) ?? 0) + 1);
    else {
      const next = Math.max(0, (onlineCounts.get(userId) ?? 1) - 1);
      if (next === 0) onlineCounts.delete(userId);
      else onlineCounts.set(userId, next);
    }
    void (async () => {
      const [audience, hidden] = await Promise.all([presenceAudienceUserIds(userId), presenceModeHidden(userId)]);
      const visibleOnline = onlineCounts.has(userId) && !hidden;
      for (const targetUserId of audience) io.to(`user:${targetUserId}`).emit("presence:user", { userId, online: visibleOnline });
    })().catch((error) => console.warn("Falha ao publicar presenca privada", error));
  }

  const botGatewayIntents = new Set(["GUILDS", "GUILD_MESSAGES", "MESSAGE_CONTENT", "VOICE_STATES"]);

  function parseBotGatewayIntents(value: unknown) {
    if (!Array.isArray(value)) return new Set<string>();
    return new Set(value.filter((item): item is string => typeof item === "string" && botGatewayIntents.has(item)));
  }

  io.use(async (socket, next) => {
    const botToken = typeof socket.handshake.auth?.botToken === "string" ? socket.handshake.auth.botToken : "";
    if (botToken) {
      const application = await prisma.developerApplication.findFirst({
        where: { botTokenPrefix: tokenPrefix(botToken) },
        select: { id: true, clientId: true, botUserId: true, botTokenHash: true, messageContentIntent: true }
      }).catch(() => null);
      if (!application?.botUserId || !application.botTokenHash || !secretMatches(botToken, application.botTokenHash)) {
        return next(new Error("Token de bot invalido"));
      }
      const intents = parseBotGatewayIntents(socket.handshake.auth?.intents);
      if (!application.messageContentIntent) intents.delete("MESSAGE_CONTENT");
      socket.data.bot = {
        applicationId: application.id,
        clientId: application.clientId,
        botUserId: application.botUserId,
        intents: [...intents]
      };
      return next();
    }

    const token = typeof socket.handshake.auth?.token === "string"
      ? socket.handshake.auth.token
      : socket.handshake.headers.authorization?.replace(/^Bearer\s+/i, "");

    if (!token) return next(new Error("Autenticacao obrigatoria"));

    try {
      const auth = verifyToken(token);
      const user = await prisma.user.findUnique({ where: { id: auth.sub }, select: { id: true, tokenVersion: true, accountType: true, accountDisabled: true } });
      if (!user || user.accountType !== "HUMAN" || user.tokenVersion !== auth.ver || user.accountDisabled) return next(new Error("Sessao revogada, expirada ou conta desativada"));
      if (auth.sid && !(await isAuthSessionActive(auth.sid, auth.sub, false))) return next(new Error("Esta sessao foi encerrada"));
      socket.data.auth = auth;
      return next();
    } catch {
      return next(new Error("Sessao invalida ou expirada"));
    }
  });

  io.on("connection", async (socket) => {
    if (socket.data.bot) {
      const bot = socket.data.bot as { applicationId: string; clientId: string; botUserId: string; intents: string[] };
      const intents = new Set(bot.intents);
      await socket.join(`user:${bot.botUserId}`);
      await socket.join(`bot:${bot.applicationId}`);
      const installs = await prisma.botInstall.findMany({
        where: { applicationId: bot.applicationId },
        include: { guild: { include: { channels: { select: { id: true, type: true } } } } }
      });
      for (const install of installs) {
        if (intents.has("GUILDS")) await socket.join(`botguild:${install.guildId}`);
        if (intents.has("VOICE_STATES")) await socket.join(`botvoice:${install.guildId}`);
        if (!install.permissions.includes("VIEW_CHANNELS") || !intents.has("GUILD_MESSAGES") || !intents.has("MESSAGE_CONTENT")) continue;
        for (const channel of install.guild.channels) {
          if (!["TEXT", "ANNOUNCEMENT", "FORUM", "EVENT"].includes(channel.type)) continue;
          try {
            await requireChannelCapability(bot.botUserId, channel.id, "view");
            // A entrega de mensagens de bot e autorizada dinamicamente por evento.
          } catch {
            // A permissao de instalacao nunca ignora os ACLs reais do canal.
          }
        }
      }
      setUserOnline(bot.botUserId, true);
      socket.emit("bot:ready", { applicationId: bot.applicationId, clientId: bot.clientId, guildIds: installs.map((item) => item.guildId), intents: bot.intents });
      socket.on("disconnect", () => setUserOnline(bot.botUserId, false));
      return;
    }

    const userId = socket.data.auth.sub as string;
    await socket.join(`user:${userId}`);
    const membershipGuilds = await prisma.guildMember.findMany({ where: { userId }, select: { guildId: true } });
    for (const membership of membershipGuilds) await socket.join(`guild:${membership.guildId}`);
    setUserOnline(userId, true);

    socket.use((_packet, next) => {
      const now = Date.now();
      const lastCheck = Number(socket.data.sessionCheckedAt ?? 0);
      if (now - lastCheck < 5_000) return next();

      void prisma.user.findUnique({ where: { id: userId }, select: { tokenVersion: true, accountDisabled: true } }).then(async (user) => {
        const auth = socket.data.auth as { ver: number; sid?: string };
        const sessionActive = !auth.sid || await isAuthSessionActive(auth.sid, userId, false);
        if (!user || user.accountDisabled || user.tokenVersion !== auth.ver || !sessionActive) {
          socket.disconnect(true);
          return next(new Error("Sessao revogada, expirada ou conta desativada"));
        }
        socket.data.sessionCheckedAt = now;
        return next();
      }).catch(() => {
        socket.disconnect(true);
        return next(new Error("Falha ao validar a sessao"));
      });
    });

    socket.on("presence:query", async (payload: unknown, ack?: Ack) => {
      try {
        consumeSocketBudget(socket, "presence", 30, 10_000);
        const { userIds } = presenceQuerySchema.parse(payload);
        const observable = await observableUserIds(userId, userIds);
        const observableIds = userIds.filter((id) => observable.has(id));
        const connectedIds = observableIds.filter((id) => onlineCounts.has(id));
        const profileRows = connectedIds.length ? await prisma.gingaGamingProfile.findMany({
          where: { userId: { in: connectedIds } },
          select: { userId: true, presenceMode: true, autoAway: true, idle: true }
        }).catch(() => []) : [];
        const profileByUserId = new Map(profileRows.map((item) => [item.userId, item]));
        const presenceByUserId: Record<string, "ONLINE" | "AWAY" | "BUSY" | "OFFLINE"> = {};
        for (const id of observableIds) {
          if (!onlineCounts.has(id)) { presenceByUserId[id] = "OFFLINE"; continue; }
          const profile = profileByUserId.get(id);
          if (profile?.presenceMode === "OFFLINE") presenceByUserId[id] = "OFFLINE";
          else if (profile?.presenceMode === "BUSY") presenceByUserId[id] = "BUSY";
          else if (profile?.presenceMode === "AWAY" || (profile?.autoAway && profile?.idle)) presenceByUserId[id] = "AWAY";
          else presenceByUserId[id] = "ONLINE";
        }
        const onlineUserIds = observableIds.filter((id) => presenceByUserId[id] !== "OFFLINE");
        ack?.({ ok: true, onlineUserIds, presenceByUserId });
      } catch (error) {
        ack?.({ ok: false, error: errorMessage(error) });
      }
    });

    socket.on("guild:watch", async (payload: unknown, ack?: Ack) => {
      try {
        consumeSocketBudget(socket, "navigation", 40, 10_000);
        const { guildId } = guildWatchSchema.parse(payload);
        await requireGuildMember(userId, guildId);

        await socket.join(`guild:${guildId}`);
        socket.data.guildId = guildId;
        const initialVoicePresence = buildVoicePresence(voiceSessions, guildId, currentVoicePresenceRevision(guildId));
        socket.emit("voice:presence", await filterVoicePresenceForUser(userId, initialVoicePresence));
        ack?.({ ok: true });
      } catch (error) {
        ack?.({ ok: false, error: errorMessage(error) });
      }
    });

    socket.on("voice:join", async (payload: unknown, ack?: Ack) => {
      try {
        consumeSocketBudget(socket, "voice", 20, 10_000);
        const { channelId } = voicePresenceSchema.parse(payload);
        const { channel, membership } = await requireChannelCapability(userId, channelId, "connect");
        if (channel.type !== "VOICE") throw new HttpError(400, "O canal informado nao e de voz");

        const user = await prisma.user.findUnique({
          where: { id: userId },
          select: { id: true, username: true, displayName: true, avatarColor: true, systemRole: true, platformOwner: true, accountType: true }
        });
        if (!user) throw new HttpError(401, "Usuario nao encontrado");

        const previous = voiceSessions.get(socket.id);
        if (previous) {
          clearSocketStreamWatches(socket.id);
          if (previous.streaming) clearBroadcasterStream(previous.channelId, previous.userId, previous.guildId);
        }
        // Uma conta possui somente uma sessao de voz ativa. Isso elimina sessoes
        // fantasma quando Web/Desktop ficam abertos ao mesmo tempo e evita estado
        // divergente de canal/mute entre clientes da mesma conta.
        claimVoiceSession(socket.id, userId, channel.id);
        voiceSessions.set(socket.id, {
          userId,
          guildId: channel.guildId,
          channelId: channel.id,
          micMuted: true,
          deafened: membership.serverDeafened,
          serverMuted: membership.serverMuted,
          serverDeafened: membership.serverDeafened,
          streaming: false,
          user
        });

        if (previous && previous.guildId !== channel.guildId) emitVoicePresence(previous.guildId);
        emitVoicePresence(channel.guildId);
        ack?.({ ok: true });
      } catch (error) {
        ack?.({ ok: false, error: errorMessage(error) });
      }
    });

    socket.on("voice:state", (payload: unknown, ack?: Ack) => {
      try {
        consumeSocketBudget(socket, "voice-state", 40, 10_000);
        const data = voiceStateSchema.parse(payload);
        const current = voiceSessions.get(socket.id);
        if (!current || current.channelId !== data.channelId) throw new HttpError(404, "Sessao de voz nao encontrada");
        const nextMicMuted = current.serverMuted || current.serverDeafened ? true : data.micMuted;
        const nextDeafened = current.serverDeafened ? true : data.deafened;
        const nextStreaming = typeof data.streaming === "boolean" ? data.streaming : current.streaming;
        const wasStreaming = current.streaming;
        const changed = current.micMuted !== nextMicMuted || current.deafened !== nextDeafened || current.streaming !== nextStreaming;
        current.micMuted = nextMicMuted;
        current.deafened = nextDeafened;
        current.streaming = nextStreaming;
        if (wasStreaming && !nextStreaming) clearBroadcasterStream(current.channelId, current.userId, current.guildId);
        voiceSessions.set(socket.id, current);
        if (changed) emitVoicePresence(current.guildId);
        ack?.({ ok: true });
      } catch (error) {
        ack?.({ ok: false, error: errorMessage(error) });
      }
    });

    socket.on("voice:sync", async (payload: unknown, ack?: Ack) => {
      try {
        consumeSocketBudget(socket, "voice-sync", 12, 60_000);
        const data = voiceSyncSchema.parse(payload);
        const existing = voiceSessions.get(socket.id);

        if (existing && existing.channelId === data.channelId) {
          const membership = await requireGuildMember(userId, existing.guildId);
          existing.serverMuted = membership.serverMuted;
          existing.serverDeafened = membership.serverDeafened;
          const nextMicMuted = existing.serverMuted || existing.serverDeafened ? true : data.micMuted;
          const nextDeafened = existing.serverDeafened ? true : data.deafened;
          const nextStreaming = typeof data.streaming === "boolean" ? data.streaming : existing.streaming;
          const wasStreaming = existing.streaming;
          const changed = existing.micMuted !== nextMicMuted || existing.deafened !== nextDeafened || existing.streaming !== nextStreaming;
          existing.micMuted = nextMicMuted;
          existing.deafened = nextDeafened;
          existing.streaming = nextStreaming;
          if (wasStreaming && !nextStreaming) clearBroadcasterStream(existing.channelId, existing.userId, existing.guildId);
          claimVoiceSession(socket.id, userId, data.channelId);
          voiceSessions.set(socket.id, existing);
          if (changed) emitVoicePresence(existing.guildId);
          return ack?.({ ok: true, restored: false });
        }

        const { channel, membership } = await requireChannelCapability(userId, data.channelId, "connect");
        if (channel.type !== "VOICE") throw new HttpError(400, "O canal informado nao e de voz");

        // A reconexao do Socket.IO pode perder o mapa em memoria enquanto o LiveKit
        // continua conectado. Restauramos apenas a mesma sala logica para evitar que
        // uma aba antiga mova o usuario de volta para outro canal silenciosamente.
        const otherSession = Array.from(voiceSessions.entries()).find(([socketId, session]) =>
          socketId !== socket.id && session.userId === userId && session.channelId !== data.channelId
        );
        if (otherSession) throw new HttpError(409, "Existe outra sessao desta conta em uma sala de voz diferente");

        const user = await prisma.user.findUnique({
          where: { id: userId },
          select: { id: true, username: true, displayName: true, avatarColor: true, systemRole: true, platformOwner: true, accountType: true }
        });
        if (!user) throw new HttpError(401, "Usuario nao encontrado");

        const previousGuildId = existing?.guildId;
        if (existing) {
          clearSocketStreamWatches(socket.id);
          if (existing.streaming) clearBroadcasterStream(existing.channelId, existing.userId, existing.guildId);
        }
        claimVoiceSession(socket.id, userId, channel.id);
        voiceSessions.set(socket.id, {
          userId,
          guildId: channel.guildId,
          channelId: channel.id,
          micMuted: membership.serverMuted || membership.serverDeafened ? true : data.micMuted,
          deafened: membership.serverDeafened ? true : data.deafened,
          serverMuted: membership.serverMuted,
          serverDeafened: membership.serverDeafened,
          streaming: Boolean(data.streaming),
          user
        });
        if (previousGuildId && previousGuildId !== channel.guildId) emitVoicePresence(previousGuildId);
        emitVoicePresence(channel.guildId);
        ack?.({ ok: true, restored: true });
      } catch (error) {
        ack?.({ ok: false, error: errorMessage(error) });
      }
    });


    socket.on("voice:soundboard-play", async (payload: unknown, ack?: Ack) => {
      try {
        consumeSocketBudget(socket, "voice-soundboard", 6, 10_000);
        const now = Date.now();
        const lastAt = Number(socket.data.lastSoundboardAt || 0);
        if (lastAt > 0 && now - lastAt < 700) throw new HttpError(429, "Aguarde um instante antes de tocar outro som");
        const data = voiceSoundboardPlaySchema.parse(payload);
        const current = voiceSessions.get(socket.id);
        if (!current || current.userId !== userId || current.channelId !== data.channelId) throw new HttpError(409, "Entre nesta sala de voz antes de usar os sons");
        const { channel } = await requireChannelCapability(userId, data.channelId, "connect");
        if (channel.type !== "VOICE") throw new HttpError(400, "O Soundboard so funciona em canais de voz");
        const roomLastAt = soundboardChannelLastAt.get(data.channelId) ?? 0;
        if (roomLastAt > 0 && now - roomLastAt < 500) throw new HttpError(429, "A sala acabou de tocar um som. Aguarde um instante.");
        await ensureV090Storage();
        const sound = (await prisma.$queryRawUnsafe<Array<{id:string;name:string;emoji:string;etag:string;duration_ms:number;trim_start_ms:number;trim_end_ms:number}>>(
          `SELECT id,name,emoji,etag,duration_ms,trim_start_ms,trim_end_ms FROM "GingaGuildSoundboardSound" WHERE guild_id=$1 AND id=$2 LIMIT 1`,
          channel.guildId,
          data.soundId
        ))[0];
        if (!sound) throw new HttpError(404, "Este som nao existe mais");
        socket.data.lastSoundboardAt = now;
        soundboardChannelLastAt.set(data.channelId, now);
        const event = {
          channelId: data.channelId,
          guildId: channel.guildId,
          sound: {
            id: sound.id,
            name: sound.name,
            emoji: sound.emoji || "🔊",
            durationMs: Math.max(0, Math.min(12_000, Number(sound.duration_ms || 0))),
            trimStartMs: Math.max(0, Number(sound.trim_start_ms || 0)),
            trimEndMs: Math.max(0, Number(sound.trim_end_ms || sound.duration_ms || 0)),
            url: `/api/guilds/${encodeURIComponent(channel.guildId)}/soundboard/${encodeURIComponent(sound.id)}/${encodeURIComponent(sound.etag)}`
          },
          playedBy: { id: current.userId, displayName: current.user.displayName || current.user.username },
          // Pequeno buffer para os clientes abrirem/precarregarem o asset antes de tocar.
          playAt: now + 350
        };
        const delivered = new Set<string>();
        for (const [socketId, session] of voiceSessions.entries()) {
          if (session.channelId !== data.channelId || session.guildId !== channel.guildId) continue;
          if (session.deafened || session.serverDeafened) continue;
          // Uma conta possui uma unica sessao de voz, mas o Set evita qualquer duplicacao
          // durante uma janela curta de reconexao do Socket.IO.
          if (delivered.has(session.userId)) continue;
          delivered.add(session.userId);
          io.to(socketId).emit("voice:soundboard-played", event);
        }
        ack?.({ ok: true, listeners: delivered.size, playAt: event.playAt });
      } catch (error) {
        ack?.({ ok: false, error: errorMessage(error) });
      }
    });

    socket.on("voice:stream-watch", async (payload: unknown, ack?: Ack) => {
      try {
        consumeSocketBudget(socket, "voice-stream-watch", 30, 10_000);
        const data = voiceStreamWatchSchema.parse(payload);
        const viewerSession = Array.from(voiceSessions.values()).find((session) => session.userId === userId && session.channelId === data.channelId);
        if (!viewerSession) throw new HttpError(409, "Entre na sala de voz antes de assistir a transmissao");
        const broadcaster = Array.from(voiceSessions.values()).find((session) => session.userId === data.broadcasterId && session.channelId === data.channelId && session.streaming);
        if (!broadcaster) throw new HttpError(409, "Esta transmissao nao esta mais ativa");
        await requireChannelCapability(userId, data.channelId, "view");
        clearSocketStreamWatches(socket.id);
        const key = streamWatchKey(data.channelId, data.broadcasterId);
        const group = streamWatchers.get(key) ?? { guildId: broadcaster.guildId, channelId: data.channelId, broadcasterId: data.broadcasterId, viewers: new Map<string, string>() };
        // O proprio transmissor nao conta como espectador.
        if (userId !== data.broadcasterId) group.viewers.set(socket.id, userId);
        streamWatchers.set(key, group);
        emitStreamViewerCount(group);
        ack?.({ ok: true, count: new Set(group.viewers.values()).size });
      } catch (error) {
        ack?.({ ok: false, error: errorMessage(error) });
      }
    });

    socket.on("voice:stream-unwatch", (payload: unknown, ack?: Ack) => {
      try {
        voiceStreamWatchSchema.partial().parse(payload ?? {});
        clearSocketStreamWatches(socket.id);
        ack?.({ ok: true });
      } catch (error) {
        ack?.({ ok: false, error: errorMessage(error) });
      }
    });


    socket.on("voice:move-member", async (payload: unknown, ack?: Ack) => {
      try {
        consumeSocketBudget(socket, "voice-moderation", 20, 10_000);
        const { targetUserId, targetChannelId } = voiceMoveSchema.parse(payload);
        const { channel } = await requireChannelCapability(targetUserId, targetChannelId, "connect");
        if (channel.type !== "VOICE") throw new HttpError(400, "O destino precisa ser uma sala de voz");
        await requireModerationTarget(userId, channel.guildId, targetUserId, "moveMembers");

        const targetSessions = Array.from(voiceSessions.entries()).filter(([, session]) => session.userId === targetUserId && session.guildId === channel.guildId);
        if (targetSessions.length === 0) throw new HttpError(409, "Este usuario nao esta conectado em uma sala de voz");
        const previousChannelId = targetSessions[0][1].channelId;
        for (const [socketId, session] of targetSessions) {
          clearSocketStreamWatches(socketId);
          if (session.streaming) clearBroadcasterStream(session.channelId, session.userId, session.guildId);
          voiceSessions.set(socketId, { ...session, channelId: targetChannelId, streaming: false });
        }
        emitVoicePresence(channel.guildId);
        io.to(`user:${targetUserId}`).emit("voice:moved", { guildId: channel.guildId, fromChannelId: previousChannelId, channelId: targetChannelId, movedBy: userId, reason: "MODERATION" });
        ack?.({ ok: true });
      } catch (error) {
        ack?.({ ok: false, error: errorMessage(error) });
      }
    });

    socket.on("voice:disconnect-member", async (payload: unknown, ack?: Ack) => {
      try {
        consumeSocketBudget(socket, "voice-moderation", 20, 10_000);
        const { guildId, targetUserId } = voiceDisconnectSchema.parse(payload);
        await requireModerationTarget(userId, guildId, targetUserId, "moveMembers");
        const targetSessions = Array.from(voiceSessions.entries()).filter(([, session]) => session.userId === targetUserId && session.guildId === guildId);
        if (targetSessions.length === 0) throw new HttpError(409, "Este usuario nao esta conectado em uma sala de voz");
        for (const [socketId, session] of targetSessions) {
          voiceSessions.delete(socketId);
          clearSocketStreamWatches(socketId);
          if (session.streaming) clearBroadcasterStream(session.channelId, session.userId, session.guildId);
        }
        await removeUserFromGuildMedia(guildId, targetUserId).catch(() => undefined);
        emitVoicePresence(guildId);
        io.to(`user:${targetUserId}`).emit("voice:disconnected", { guildId, disconnectedBy: userId, reason: "MODERATION" });
        ack?.({ ok: true });
      } catch (error) {
        ack?.({ ok: false, error: errorMessage(error) });
      }
    });

    socket.on("voice:self-afk", async (payload: unknown, ack?: Ack) => {
      try {
        const { guildId } = voiceAfkSchema.parse(payload);
        await requireGuildMember(userId, guildId);
        const guild = await prisma.guild.findUnique({ where: { id: guildId }, select: { afkEnabled: true, afkChannelId: true } });
        if (!guild?.afkEnabled || !guild.afkChannelId) throw new HttpError(409, "Canal Ausente nao esta habilitado neste servidor");
        const { channel } = await requireChannelCapability(userId, guild.afkChannelId, "connect");
        if (channel.type !== "VOICE") throw new HttpError(409, "Canal Ausente invalido");
        const ownSessions = Array.from(voiceSessions.entries()).filter(([, session]) => session.userId === userId && session.guildId === guildId);
        if (ownSessions.length === 0) throw new HttpError(409, "Voce nao esta conectado em voz neste servidor");
        const previousChannelId = ownSessions[0][1].channelId;
        if (previousChannelId === guild.afkChannelId) return ack?.({ ok: true });
        for (const [socketId, session] of ownSessions) {
          clearSocketStreamWatches(socketId);
          if (session.streaming) clearBroadcasterStream(session.channelId, session.userId, session.guildId);
          voiceSessions.set(socketId, { ...session, channelId: guild.afkChannelId!, streaming: false });
        }
        emitVoicePresence(guildId);
        io.to(`user:${userId}`).emit("voice:moved", { guildId, fromChannelId: previousChannelId, channelId: guild.afkChannelId, movedBy: userId, reason: "AFK" });
        ack?.({ ok: true });
      } catch (error) {
        ack?.({ ok: false, error: errorMessage(error) });
      }
    });

    socket.on("voice:leave", (payload: unknown, ack?: Ack) => {
      try {
        const { channelId } = voicePresenceSchema.parse(payload);
        const current = voiceSessions.get(socket.id);
        if (current && current.channelId === channelId) {
          voiceSessions.delete(socket.id);
          clearSocketStreamWatches(socket.id);
          if (current.streaming) clearBroadcasterStream(current.channelId, current.userId, current.guildId);
          emitVoicePresence(current.guildId);
        }
        ack?.({ ok: true });
      } catch (error) {
        ack?.({ ok: false, error: errorMessage(error) });
      }
    });

    socket.on("channel:join", async (payload: unknown, ack?: Ack) => {
      try {
        consumeSocketBudget(socket, "navigation", 40, 10_000);
        const { channelId } = joinSchema.parse(payload);
        const { channel } = await requireChannelCapability(userId, channelId, "view");
        if (!["TEXT", "ANNOUNCEMENT", "FORUM", "EVENT"].includes(channel.type)) throw new HttpError(400, "Este tipo de canal nao usa o chat");

        for (const room of socket.rooms) {
          if (room.startsWith("channel:")) socket.leave(room);
        }
        await socket.join(`channel:${channelId}`);
        socket.data.channelId = channelId;
        ack?.({ ok: true });
      } catch (error) {
        ack?.({ ok: false, error: errorMessage(error) });
      }
    });

    socket.on("message:send", async (payload: unknown, ack?: Ack) => {
      try {
        consumeSocketBudget(socket, "messages", config.SOCKET_MESSAGE_LIMIT_10S, 10_000);
        const data = messageSchema.parse(payload);
        const { channel, membership } = await requireChannelCapability(userId, data.channelId, "sendMessages");
        if (!["TEXT", "ANNOUNCEMENT", "FORUM", "EVENT"].includes(channel.type)) throw new HttpError(400, "Este canal nao aceita mensagens de texto");

        const mentions = await validateGuildMentions(channel.guildId, data.content);
        if (mentions.mentionEveryone) {
          await requireGuildCapability(userId, channel.guildId, "mentionEveryone");
        }
        await enforceAutoMod({ guildId: channel.guildId, channelId: channel.id, userId, content: data.content });

        if (channel.slowModeSeconds > 0 && membership.role !== "OWNER" && membership.role !== "ADMIN") {
          const permissions = await requireGuildCapability(userId, channel.guildId, "manageMessages").then(() => true).catch(() => false);
          if (!permissions) {
            const last = await prisma.message.findFirst({
              where: { channelId: channel.id, authorId: userId },
              orderBy: { createdAt: "desc" },
              select: { createdAt: true }
            });
            if (last) {
              const remaining = channel.slowModeSeconds * 1000 - (Date.now() - last.createdAt.getTime());
              if (remaining > 0) throw new HttpError(429, `Modo lento ativo. Aguarde ${Math.ceil(remaining / 1000)}s.`);
            }
          }
        }

        if (data.replyToId) {
          const replied = await prisma.message.findUnique({ where: { id: data.replyToId }, select: { channelId: true } });
          if (!replied || replied.channelId !== channel.id) throw new HttpError(400, "Mensagem de resposta invalida");
        }

        const message = await prisma.$transaction(async (tx) => {
          if (data.attachmentIds.length > 0) {
            const attachments = await tx.attachment.findMany({
              where: {
                id: { in: data.attachmentIds },
                uploaderId: userId,
                messageId: null,
                directMessageId: null
              },
              select: { id: true }
            });
            if (attachments.length !== data.attachmentIds.length) throw new HttpError(400, "Um ou mais anexos sao invalidos ou ja foram usados");
          }

          const created = await tx.message.create({
            data: { channelId: data.channelId, authorId: userId, content: data.content, replyToId: data.replyToId ?? null }
          });

          if (data.attachmentIds.length > 0) {
            await tx.attachment.updateMany({
              where: { id: { in: data.attachmentIds }, uploaderId: userId, messageId: null, directMessageId: null },
              data: { messageId: created.id }
            });
          }

          return tx.message.findUniqueOrThrow({
            where: { id: created.id },
            include: {
              author: { select: { id: true, username: true, displayName: true, avatarColor: true, systemRole: true, platformOwner: true, accountType: true } },
              attachments: { orderBy: { createdAt: "asc" } },
              reactions: { include: { user: { select: { id: true, username: true, displayName: true } } } },
              replyTo: { include: { author: { select: { id: true, displayName: true, username: true } } } }
            }
          });
        });

        void emitNewGuildMessage(io, { id: channel.id, guildId: channel.guildId, name: channel.name }, message)
          .catch((error) => console.error("Falha ao entregar mensagem/atividade/notificacao", error));
        ack?.({ ok: true, message });
      } catch (error) {
        ack?.({ ok: false, error: errorMessage(error) });
      }
    });

    socket.on("direct:message:send", async (payload: unknown, ack?: Ack) => {
      try {
        consumeSocketBudget(socket, "messages", config.SOCKET_MESSAGE_LIMIT_10S, 10_000);
        const data = directMessageSchema.parse(payload);
        await requireDirectMember(userId, data.conversationId);
        const peer = await prisma.directConversationMember.findFirst({ where: { conversationId: data.conversationId, userId: { not: userId } }, select: { userId: true } });
        if (peer) {
          const blocked = await prisma.userBlock.findFirst({
            where: { OR: [{ blockerId: userId, blockedId: peer.userId }, { blockerId: peer.userId, blockedId: userId }] },
            select: { blockerId: true }
          });
          if (blocked) throw new HttpError(403, "Esta conversa esta bloqueada");
        }
        if (data.replyToId) {
          const reply = await prisma.directMessage.findUnique({ where: { id: data.replyToId }, select: { conversationId: true } });
          if (!reply || reply.conversationId !== data.conversationId) throw new HttpError(400, "Mensagem de resposta invalida");
        }

        const message = await prisma.$transaction(async (tx) => {
          if (data.attachmentIds.length > 0) {
            const attachments = await tx.attachment.findMany({
              where: {
                id: { in: data.attachmentIds },
                uploaderId: userId,
                messageId: null,
                directMessageId: null
              },
              select: { id: true }
            });
            if (attachments.length !== data.attachmentIds.length) throw new HttpError(400, "Um ou mais anexos sao invalidos ou ja foram usados");
          }

          const created = await tx.directMessage.create({
            data: { conversationId: data.conversationId, authorId: userId, content: data.content, replyToId: data.replyToId ?? null }
          });

          if (data.attachmentIds.length > 0) {
            await tx.attachment.updateMany({
              where: { id: { in: data.attachmentIds }, uploaderId: userId, messageId: null, directMessageId: null },
              data: { directMessageId: created.id }
            });
          }

          await tx.directConversation.update({ where: { id: data.conversationId }, data: { updatedAt: new Date() } });

          return tx.directMessage.findUniqueOrThrow({
            where: { id: created.id },
            include: {
              author: { select: { id: true, username: true, displayName: true, avatarColor: true, systemRole: true, platformOwner: true, accountType: true } },
              attachments: { orderBy: { createdAt: "asc" } }
            }
          });
        });

        const members = await prisma.directConversationMember.findMany({
          where: { conversationId: data.conversationId },
          select: { userId: true }
        });
        for (const member of members) io.to(`user:${member.userId}`).emit("direct:message:new", message);
        ack?.({ ok: true, message });
      } catch (error) {
        ack?.({ ok: false, error: errorMessage(error) });
      }
    });

    socket.on("direct:call:ring", async (payload: unknown, ack?: Ack) => {
      try {
        consumeSocketBudget(socket, "calls", config.SOCKET_CALL_LIMIT_MINUTE, 60_000);
        const { conversationId } = directSchema.parse(payload);
        await requireDirectMember(userId, conversationId);
        const peer = await prisma.directConversationMember.findFirst({ where: { conversationId, userId: { not: userId } }, select: { userId: true } });
        if (peer) {
          const blocked = await prisma.userBlock.findFirst({
            where: { OR: [{ blockerId: userId, blockedId: peer.userId }, { blockerId: peer.userId, blockedId: userId }] },
            select: { blockerId: true }
          });
          if (blocked) throw new HttpError(403, "Nao e possivel iniciar chamada com este usuario");
        }
        const [caller, members] = await Promise.all([
          prisma.user.findUnique({ where: { id: userId }, select: { id: true, username: true, displayName: true, avatarColor: true, systemRole: true, platformOwner: true, accountType: true } }),
          prisma.directConversationMember.findMany({ where: { conversationId }, select: { userId: true } })
        ]);
        if (!caller) throw new HttpError(401, "Usuario nao encontrado");
        for (const member of members) {
          if (member.userId !== userId) io.to(`user:${member.userId}`).emit("direct:call:ringing", { conversationId, caller });
        }
        ack?.({ ok: true });
      } catch (error) {
        ack?.({ ok: false, error: errorMessage(error) });
      }
    });

    socket.on("disconnect", () => {
      const current = voiceSessions.get(socket.id);
      if (current) {
        voiceSessions.delete(socket.id);
        if (current.streaming) clearBroadcasterStream(current.channelId, current.userId, current.guildId);
        emitVoicePresence(current.guildId);
      }
      clearSocketStreamWatches(socket.id);
      setUserOnline(userId, false);
    });
  });

  return io;
}
