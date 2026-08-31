import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db.js";
import { asyncHandler, HttpError } from "../errors.js";
import { requireAuth } from "../middleware.js";
import { requireDirectMember } from "../permissions.js";
import { routeParam } from "../utils.js";
import { usersBlockEachOther } from "../socialPrivacy.js";
import { publicGamingProfileForViewer } from "./gamingProfile.js";

export const socialRouter = Router();

const userSelect = {
  id: true,
  username: true,
  displayName: true,
  avatarColor: true,
  bio: true,
  statusMessage: true,
  systemRole: true,
  platformOwner: true,
  accountType: true
} as const;

const friendRequestSchema = z.object({ username: z.string().trim().min(3).max(24).transform((value) => value.toLowerCase()) });
const directCreateSchema = z.object({ userId: z.string().min(1) });
const directEditSchema = z.object({ content: z.string().trim().min(1).max(4000) });
const searchSchema = z.object({ q: z.string().trim().min(1).max(50) });
const profileQuerySchema = z.object({ guildId: z.string().min(1).optional() });
const messagesQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  before: z.string().datetime().optional()
});


let socialSafetyStoragePromise: Promise<void> | null = null;

async function initializeSocialSafetyStorage() {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "UserBlock" (
      "blockerId" TEXT NOT NULL,
      "blockedId" TEXT NOT NULL,
      "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT "UserBlock_pkey" PRIMARY KEY ("blockerId", "blockedId"),
      CONSTRAINT "UserBlock_blockerId_fkey" FOREIGN KEY ("blockerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
      CONSTRAINT "UserBlock_blockedId_fkey" FOREIGN KEY ("blockedId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
    )
  `);
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "UserBlock_blockedId_createdAt_idx" ON "UserBlock" ("blockedId", "createdAt")`);
  await prisma.$executeRawUnsafe(`ALTER TABLE "DirectMessage" ADD COLUMN IF NOT EXISTS "replyToId" TEXT NULL`);
}

export async function ensureSocialSafetyStorage() {
  if (!socialSafetyStoragePromise) {
    socialSafetyStoragePromise = initializeSocialSafetyStorage().catch((error) => {
      socialSafetyStoragePromise = null;
      throw error;
    });
  }
  await socialSafetyStoragePromise;
}


function otherSide<T extends { requesterId: string; addresseeId: string; requester: unknown; addressee: unknown }>(item: T, userId: string) {
  return item.requesterId === userId ? item.addressee : item.requester;
}

socialRouter.get("/friends", requireAuth, asyncHandler(async (req, res) => {
  const userId = req.auth!.sub;
  const friendships = await prisma.friendship.findMany({
    where: { OR: [{ requesterId: userId }, { addresseeId: userId }] },
    orderBy: { updatedAt: "desc" },
    include: { requester: { select: userSelect }, addressee: { select: userSelect } }
  });

  res.json({
    friends: friendships
      .filter((item) => item.status === "ACCEPTED")
      .map((item) => ({ id: item.id, user: otherSide(item, userId), since: item.updatedAt })),
    incoming: friendships
      .filter((item) => item.status === "PENDING" && item.addresseeId === userId)
      .map((item) => ({ id: item.id, user: item.requester, createdAt: item.createdAt })),
    outgoing: friendships
      .filter((item) => item.status === "PENDING" && item.requesterId === userId)
      .map((item) => ({ id: item.id, user: item.addressee, createdAt: item.createdAt }))
  });
}));

socialRouter.get("/users/blocked", requireAuth, asyncHandler(async (req, res) => {
  const userId = req.auth!.sub;
  await ensureSocialSafetyStorage();
  const blocks = await prisma.userBlock.findMany({
    where: { blockerId: userId },
    orderBy: { createdAt: "desc" },
    include: { blocked: { select: userSelect } }
  });
  res.json({ blocked: blocks.map((item) => ({ user: item.blocked, createdAt: item.createdAt })) });
}));

socialRouter.post("/users/:userId/block", requireAuth, asyncHandler(async (req, res) => {
  const blockerId = req.auth!.sub;
  const blockedId = routeParam(req.params.userId, "userId");
  if (blockerId === blockedId) throw new HttpError(400, "Voce nao pode bloquear a si mesmo");
  await ensureSocialSafetyStorage();
  const target = await prisma.user.findUnique({ where: { id: blockedId }, select: userSelect });
  if (!target || target.accountType !== "HUMAN") throw new HttpError(404, "Usuario nao encontrado");

  await prisma.$transaction([
    prisma.userBlock.upsert({
      where: { blockerId_blockedId: { blockerId, blockedId } },
      create: { blockerId, blockedId },
      update: {}
    }),
    prisma.friendship.deleteMany({
      where: {
        OR: [
          { requesterId: blockerId, addresseeId: blockedId },
          { requesterId: blockedId, addresseeId: blockerId }
        ]
      }
    })
  ]);
  res.json({ blocked: true, user: target });
}));

socialRouter.delete("/users/:userId/block", requireAuth, asyncHandler(async (req, res) => {
  const blockerId = req.auth!.sub;
  const blockedId = routeParam(req.params.userId, "userId");
  await ensureSocialSafetyStorage();
  await prisma.userBlock.deleteMany({ where: { blockerId, blockedId } });
  res.status(204).end();
}));

socialRouter.get("/users/search", requireAuth, asyncHandler(async (req, res) => {
  const { q } = searchSchema.parse(req.query);
  const userId = req.auth!.sub;
  const users = await prisma.user.findMany({
    where: {
      id: { not: userId },
      accountType: "HUMAN",
      OR: [
        { username: { contains: q, mode: "insensitive" } },
        { displayName: { contains: q, mode: "insensitive" } }
      ]
    },
    select: userSelect,
    orderBy: { username: "asc" },
    take: 16
  });

  const relations = await prisma.friendship.findMany({
    where: {
      OR: [
        { requesterId: userId, addresseeId: { in: users.map((item) => item.id) } },
        { addresseeId: userId, requesterId: { in: users.map((item) => item.id) } }
      ]
    }
  });

  res.json({
    users: users.map((item) => {
      const relation = relations.find((entry) =>
        (entry.requesterId === userId && entry.addresseeId === item.id) ||
        (entry.addresseeId === userId && entry.requesterId === item.id)
      );
      return {
        ...item,
        friendship: relation
          ? {
              id: relation.id,
              status: relation.status,
              direction: relation.requesterId === userId ? "OUTGOING" : "INCOMING"
            }
          : null
      };
    })
  });
}));

socialRouter.get("/users/:userId/profile", requireAuth, asyncHandler(async (req, res) => {
  const userId = routeParam(req.params.userId, "userId");
  const viewerId = req.auth!.sub;
  const { guildId } = profileQuerySchema.parse(req.query);

  const profile = await prisma.user.findUnique({
    where: { id: userId },
    select: { ...userSelect, createdAt: true }
  });
  if (!profile) throw new HttpError(404, "Usuario nao encontrado");

  // Identidades internas (SYSTEM/BOT/WEBHOOK) possuem perfil somente leitura.
  // Elas nao participam do grafo social humano, evitando amizade, bloqueio e DM acidentais.
  if (profile.accountType !== "HUMAN") {
    res.json({ profile, gamingProfile: null, friendship: null, sharedGuilds: [], guildMembership: null, block: null });
    return;
  }

  await ensureSocialSafetyStorage();
  const [friendship, sharedGuilds, blockRelation, gamingProfile] = await Promise.all([
    userId === viewerId ? null : prisma.friendship.findFirst({
      where: {
        OR: [
          { requesterId: viewerId, addresseeId: userId },
          { requesterId: userId, addresseeId: viewerId }
        ]
      }
    }),
    prisma.guild.findMany({
      where: {
        AND: [
          { members: { some: { userId: viewerId } } },
          { members: { some: { userId } } }
        ]
      },
      select: { id: true, name: true, iconColor: true },
      orderBy: { name: "asc" },
      take: 12
    }),
    userId === viewerId ? null : prisma.userBlock.findFirst({
      where: { OR: [{ blockerId: viewerId, blockedId: userId }, { blockerId: userId, blockedId: viewerId }] },
      select: { blockerId: true, blockedId: true }
    }),
    publicGamingProfileForViewer(viewerId, userId)
  ]);

  let guildMembership: { role: string; joinedAt: Date } | null = null;
  if (guildId) {
    const viewerMembership = await prisma.guildMember.findUnique({ where: { guildId_userId: { guildId, userId: viewerId } } });
    if (viewerMembership) {
      const membership = await prisma.guildMember.findUnique({
        where: { guildId_userId: { guildId, userId } },
        select: { role: true, joinedAt: true }
      });
      if (membership) guildMembership = membership;
    }
  }

  res.json({
    profile,
    gamingProfile,
    friendship: friendship
      ? {
          id: friendship.id,
          status: friendship.status,
          direction: friendship.requesterId === viewerId ? "OUTGOING" : "INCOMING"
        }
      : null,
    sharedGuilds,
    guildMembership,
    block: blockRelation ? { blockedByViewer: blockRelation.blockerId === viewerId, blockedViewer: blockRelation.blockerId === userId } : null
  });
}));

socialRouter.post("/friends/requests", requireAuth, asyncHandler(async (req, res) => {
  const { username } = friendRequestSchema.parse(req.body);
  const userId = req.auth!.sub;
  const target = await prisma.user.findUnique({
    where: { username },
    select: { ...userSelect, allowFriendRequests: true }
  });
  if (!target || target.accountType !== "HUMAN") throw new HttpError(404, "Usuario nao encontrado");
  if (target.id === userId) throw new HttpError(400, "Voce nao pode adicionar a si mesmo");
  if (await usersBlockEachOther(userId, target.id)) throw new HttpError(403, "Nao e possivel enviar solicitacao para este usuario");

  const existing = await prisma.friendship.findFirst({
    where: {
      OR: [
        { requesterId: userId, addresseeId: target.id },
        { requesterId: target.id, addresseeId: userId }
      ]
    }
  });

  if (existing?.status === "ACCEPTED") throw new HttpError(409, "Voces ja sao amigos");
  if (existing?.status === "PENDING" && existing.requesterId === userId) throw new HttpError(409, "Solicitacao ja enviada");

  if (existing?.status === "PENDING" && existing.addresseeId === userId) {
    const accepted = await prisma.friendship.update({ where: { id: existing.id }, data: { status: "ACCEPTED" } });
    res.json({ friendship: accepted, autoAccepted: true });
    return;
  }

  if (!target.allowFriendRequests) throw new HttpError(403, "Este usuario nao esta aceitando novas solicitacoes de amizade");

  const friendship = await prisma.friendship.create({
    data: { requesterId: userId, addresseeId: target.id }
  });
  res.status(201).json({ friendship, autoAccepted: false });
}));

socialRouter.post("/friends/:friendshipId/accept", requireAuth, asyncHandler(async (req, res) => {
  const friendshipId = routeParam(req.params.friendshipId, "friendshipId");
  const friendship = await prisma.friendship.findUnique({ where: { id: friendshipId } });
  if (!friendship || friendship.addresseeId !== req.auth!.sub || friendship.status !== "PENDING") {
    throw new HttpError(404, "Solicitacao nao encontrada");
  }
  const updated = await prisma.friendship.update({ where: { id: friendship.id }, data: { status: "ACCEPTED" } });
  res.json({ friendship: updated });
}));

socialRouter.delete("/friends/:friendshipId", requireAuth, asyncHandler(async (req, res) => {
  const friendshipId = routeParam(req.params.friendshipId, "friendshipId");
  const friendship = await prisma.friendship.findUnique({ where: { id: friendshipId } });
  if (!friendship || (friendship.requesterId !== req.auth!.sub && friendship.addresseeId !== req.auth!.sub)) {
    throw new HttpError(404, "Relacionamento nao encontrado");
  }
  await prisma.friendship.delete({ where: { id: friendship.id } });
  res.status(204).end();
}));

socialRouter.get("/direct/conversations", requireAuth, asyncHandler(async (req, res) => {
  const userId = req.auth!.sub;
  const memberships = await prisma.directConversationMember.findMany({
    where: { userId },
    orderBy: { conversation: { updatedAt: "desc" } },
    include: {
      conversation: {
        include: {
          members: { include: { user: { select: userSelect } } },
          messages: {
            orderBy: { createdAt: "desc" },
            take: 1,
            include: { author: { select: userSelect }, attachments: { orderBy: { createdAt: "asc" } } }
          }
        }
      }
    }
  });

  res.json({
    conversations: memberships.map(({ conversation }) => ({
      id: conversation.id,
      otherUser: conversation.members.find((item) => item.userId !== userId)?.user ?? conversation.members[0]?.user,
      lastMessage: conversation.messages[0] ?? null,
      updatedAt: conversation.updatedAt
    }))
  });
}));

socialRouter.post("/direct/conversations", requireAuth, asyncHandler(async (req, res) => {
  const { userId: otherUserId } = directCreateSchema.parse(req.body);
  const userId = req.auth!.sub;
  if (userId === otherUserId) throw new HttpError(400, "Escolha outro usuario");
  if (await usersBlockEachOther(userId, otherUserId)) throw new HttpError(403, "Esta conversa esta indisponivel porque um dos usuarios bloqueou o outro");

  const directKey = [userId, otherUserId].sort().join(":");
  const existing = await prisma.directConversation.findUnique({
    where: { directKey },
    include: { members: { include: { user: { select: userSelect } } } }
  });

  if (existing) {
    res.json({
      conversation: {
        id: existing.id,
        otherUser: existing.members.find((item) => item.userId !== userId)?.user ?? existing.members[0]?.user,
        lastMessage: null,
        updatedAt: existing.updatedAt
      }
    });
    return;
  }

  const [target, friendship, sharedMembership] = await Promise.all([
    prisma.user.findUnique({
      where: { id: otherUserId },
      select: { allowDirectMessages: true, accountType: true }
    }),
    prisma.friendship.findFirst({
      where: {
        status: "ACCEPTED",
        OR: [
          { requesterId: userId, addresseeId: otherUserId },
          { requesterId: otherUserId, addresseeId: userId }
        ]
      },
      select: { id: true }
    }),
    prisma.guild.findFirst({
      where: {
        AND: [
          { members: { some: { userId } } },
          { members: { some: { userId: otherUserId } } }
        ]
      },
      select: { id: true }
    })
  ]);

  if (!target || target.accountType !== "HUMAN") throw new HttpError(404, "Usuario nao encontrado");
  if (!friendship && !sharedMembership) {
    throw new HttpError(403, "Voce precisa compartilhar um espaco com esta pessoa ou adiciona-la como amiga");
  }
  if (!target.allowDirectMessages) throw new HttpError(403, "Este usuario desativou novas conversas privadas");

  const conversation = await prisma.directConversation.create({
    data: {
      directKey,
      members: { create: [{ userId }, { userId: otherUserId }] }
    },
    include: { members: { include: { user: { select: userSelect } } } }
  });

  res.json({
    conversation: {
      id: conversation.id,
      otherUser: conversation.members.find((item) => item.userId !== userId)?.user ?? conversation.members[0]?.user,
      lastMessage: null,
      updatedAt: conversation.updatedAt
    }
  });
}));

socialRouter.get("/direct/conversations/:conversationId/messages", requireAuth, asyncHandler(async (req, res) => {
  const conversationId = routeParam(req.params.conversationId, "conversationId");
  await requireDirectMember(req.auth!.sub, conversationId);
  const query = messagesQuerySchema.parse(req.query);

  const messages = await prisma.directMessage.findMany({
    where: {
      conversationId,
      ...(query.before ? { createdAt: { lt: new Date(query.before) } } : {})
    },
    orderBy: { createdAt: "desc" },
    take: query.limit,
    include: {
      author: { select: userSelect },
      attachments: { orderBy: { createdAt: "asc" } }
    }
  });
  res.json({ messages: messages.reverse() });
}));


socialRouter.patch("/direct/messages/:messageId", requireAuth, asyncHandler(async (req, res) => {
  const messageId = routeParam(req.params.messageId, "messageId");
  const { content } = directEditSchema.parse(req.body);
  const message = await prisma.directMessage.findUnique({ where: { id: messageId }, select: { id: true, authorId: true, conversationId: true } });
  if (!message || message.authorId !== req.auth!.sub) throw new HttpError(404, "Mensagem nao encontrada");
  await requireDirectMember(req.auth!.sub, message.conversationId);
  const peer = await prisma.directConversationMember.findFirst({
    where: { conversationId: message.conversationId, userId: { not: req.auth!.sub } },
    select: { userId: true }
  });
  if (peer && await usersBlockEachOther(req.auth!.sub, peer.userId)) throw new HttpError(403, "Esta conversa foi bloqueada");
  const updated = await prisma.directMessage.update({
    where: { id: messageId },
    data: { content, editedAt: new Date() },
    include: { author: { select: userSelect }, attachments: { orderBy: { createdAt: "asc" } } }
  });
  const members = await prisma.directConversationMember.findMany({ where: { conversationId: message.conversationId }, select: { userId: true } });
  const io = req.app.get("io") as { to(room: string): { emit(event: string, payload: unknown): void } } | undefined;
  for (const member of members) io?.to(`user:${member.userId}`).emit("direct:message:updated", updated);
  res.json({ message: updated });
}));

socialRouter.delete("/direct/messages/:messageId", requireAuth, asyncHandler(async (req, res) => {
  const messageId = routeParam(req.params.messageId, "messageId");
  const message = await prisma.directMessage.findUnique({ where: { id: messageId }, select: { id: true, authorId: true, conversationId: true } });
  if (!message || message.authorId !== req.auth!.sub) throw new HttpError(404, "Mensagem nao encontrada");
  await requireDirectMember(req.auth!.sub, message.conversationId);
  await prisma.directMessage.delete({ where: { id: messageId } });
  const members = await prisma.directConversationMember.findMany({ where: { conversationId: message.conversationId }, select: { userId: true } });
  const io = req.app.get("io") as { to(room: string): { emit(event: string, payload: unknown): void } } | undefined;
  for (const member of members) io?.to(`user:${member.userId}`).emit("direct:message:deleted", { id: messageId, conversationId: message.conversationId });
  res.status(204).end();
}));
