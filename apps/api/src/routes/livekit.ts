import { Router } from "express";
import rateLimit from "express-rate-limit";
import { AccessToken } from "livekit-server-sdk";
import { z } from "zod";
import { config } from "../config.js";
import { prisma } from "../db.js";
import { asyncHandler, HttpError } from "../errors.js";
import { requireAuth } from "../middleware.js";
import { effectiveGuildPermissionsForUser, requireChannelCapability, requireDirectMember } from "../permissions.js";
import { usersBlockEachOther } from "../socialPrivacy.js";
import { canJoinDirectCall } from "./directCalls.js";

export const livekitRouter = Router();
const tokenSchema = z.object({ channelId: z.string().min(1).max(128) });
const directTokenSchema = z.object({ conversationId: z.string().min(1).max(128).optional(), callId: z.string().min(1).max(128).optional() }).refine((value) => Boolean(value.conversationId || value.callId), { message: "Informe a chamada ou conversa" });

const tokenLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: config.LIVEKIT_TOKEN_LIMIT_MINUTE,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Muitas solicitacoes de chamada. Aguarde um pouco." }
});

async function buildToken(
  userId: string,
  roomName: string,
  metadata: Record<string, string>,
  mediaGrant: { canPublish?: boolean; canSubscribe?: boolean } = {}
) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, username: true, displayName: true, avatarColor: true, systemRole: true, platformOwner: true, accountType: true }
  });
  if (!user) throw new HttpError(401, "Usuario nao encontrado");

  const accessToken = new AccessToken(config.LIVEKIT_API_KEY, config.LIVEKIT_API_SECRET, {
    identity: user.id,
    name: user.displayName,
    ttl: "2h",
    metadata: JSON.stringify({
      username: user.username,
      avatarColor: user.avatarColor,
      ...metadata
    })
  });

  accessToken.addGrant({
    roomJoin: true,
    room: roomName,
    canPublish: mediaGrant.canPublish ?? true,
    canSubscribe: mediaGrant.canSubscribe ?? true,
    canPublishData: true
  });

  return {
    url: config.PUBLIC_LIVEKIT_URL,
    token: await accessToken.toJwt(),
    roomName
  };
}

livekitRouter.post("/livekit/token", requireAuth, tokenLimiter, asyncHandler(async (req, res) => {
  const { channelId } = tokenSchema.parse(req.body);
  const userId = req.auth!.sub;
  const { channel, membership } = await requireChannelCapability(userId, channelId, "connect");
  if (channel.type !== "VOICE") throw new HttpError(400, "O canal informado nao e de voz");

  const credentials = await buildToken(userId, `space-${channel.guildId}-voice-${channel.id}`, {
    guildId: channel.guildId,
    channelId: channel.id,
    context: "SPACE",
    serverMuted: membership.serverMuted ? "1" : "0",
    serverDeafened: membership.serverDeafened ? "1" : "0"
  }, { canPublish: !membership.serverMuted && !membership.serverDeafened, canSubscribe: !membership.serverDeafened });
  const { permissions } = await effectiveGuildPermissionsForUser(userId, channel.guildId);
  res.json({
    ...credentials,
    mediaPermissions: { canShareScreen: permissions.canShareScreen && !membership.serverMuted && !membership.serverDeafened, canUseVideo: permissions.canUseVideo && !membership.serverMuted && !membership.serverDeafened },
    serverVoiceState: { muted: membership.serverMuted, deafened: membership.serverDeafened }
  });
}));

livekitRouter.post("/livekit/direct-token", requireAuth, tokenLimiter, asyncHandler(async (req, res) => {
  const { conversationId, callId } = directTokenSchema.parse(req.body);
  const userId = req.auth!.sub;

  if (callId) {
    const call = await canJoinDirectCall(callId, userId);
    if (!call) throw new HttpError(403, "Voce nao faz parte desta chamada ativa");
    const roomKey = call.room_key || call.id;
    const credentials = await buildToken(userId, `direct-call-${roomKey}`, {
      callId,
      conversationId: call.conversation_id || "",
      context: "DIRECT_CALL"
    });
    return res.json({ ...credentials, mediaPermissions: { canShareScreen: true, canUseVideo: true } });
  }

  const directConversationId = conversationId!;
  await requireDirectMember(userId, directConversationId);
  const peer = await prisma.directConversationMember.findFirst({
    where: { conversationId: directConversationId, userId: { not: userId } },
    select: { userId: true }
  });
  if (!peer || await usersBlockEachOther(userId, peer.userId)) throw new HttpError(403, "Chamada privada indisponivel");

  const credentials = await buildToken(userId, `direct-${directConversationId}`, {
    conversationId: directConversationId,
    context: "DIRECT"
  });
  res.json({ ...credentials, mediaPermissions: { canShareScreen: true, canUseVideo: true } });
}));
