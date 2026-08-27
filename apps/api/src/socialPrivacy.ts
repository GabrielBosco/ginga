import { prisma } from "./db.js";

function directKey(a: string, b: string) {
  return [a, b].sort().join(":");
}

export async function usersBlockEachOther(firstUserId: string, secondUserId: string) {
  if (firstUserId === secondUserId) return false;
  const existing = await prisma.userBlock.findFirst({
    where: {
      OR: [
        { blockerId: firstUserId, blockedId: secondUserId },
        { blockerId: secondUserId, blockedId: firstUserId }
      ]
    },
    select: { blockerId: true }
  }).catch(() => null);
  return Boolean(existing);
}

export async function directConversationBetween(firstUserId: string, secondUserId: string) {
  if (firstUserId === secondUserId) return null;
  return prisma.directConversation.findUnique({
    where: { directKey: directKey(firstUserId, secondUserId) },
    select: { id: true, directKey: true }
  });
}

export async function canObserveUser(viewerId: string, targetUserId: string) {
  if (viewerId === targetUserId) return true;
  const allowed = await observableUserIds(viewerId, [targetUserId]);
  return allowed.has(targetUserId);
}

export async function observableUserIds(viewerId: string, candidateIds: string[]) {
  const unique = Array.from(new Set(candidateIds.filter(Boolean))).slice(0, 500);
  const allowed = new Set<string>();
  if (unique.includes(viewerId)) allowed.add(viewerId);
  const others = unique.filter((id) => id !== viewerId);
  if (!others.length) return allowed;

  const [blocks, friendships, viewerGuilds, viewerDirects] = await Promise.all([
    prisma.userBlock.findMany({
      where: {
        OR: [
          { blockerId: viewerId, blockedId: { in: others } },
          { blockedId: viewerId, blockerId: { in: others } }
        ]
      },
      select: { blockerId: true, blockedId: true }
    }).catch(() => []),
    prisma.friendship.findMany({
      where: {
        status: "ACCEPTED",
        OR: [
          { requesterId: viewerId, addresseeId: { in: others } },
          { addresseeId: viewerId, requesterId: { in: others } }
        ]
      },
      select: { requesterId: true, addresseeId: true }
    }),
    prisma.guildMember.findMany({ where: { userId: viewerId }, select: { guildId: true } }),
    prisma.directConversationMember.findMany({ where: { userId: viewerId }, select: { conversationId: true } })
  ]);

  const blocked = new Set(blocks.map((item) => item.blockerId === viewerId ? item.blockedId : item.blockerId));
  for (const friendship of friendships) {
    const other = friendship.requesterId === viewerId ? friendship.addresseeId : friendship.requesterId;
    if (!blocked.has(other)) allowed.add(other);
  }

  if (viewerGuilds.length) {
    const shared = await prisma.guildMember.findMany({
      where: { guildId: { in: viewerGuilds.map((item) => item.guildId) }, userId: { in: others } },
      select: { userId: true }
    });
    for (const item of shared) if (!blocked.has(item.userId)) allowed.add(item.userId);
  }

  if (viewerDirects.length) {
    const direct = await prisma.directConversationMember.findMany({
      where: { conversationId: { in: viewerDirects.map((item) => item.conversationId) }, userId: { in: others } },
      select: { userId: true }
    });
    for (const item of direct) if (!blocked.has(item.userId)) allowed.add(item.userId);
  }

  return allowed;
}

export async function presenceAudienceUserIds(subjectUserId: string) {
  const [friendships, memberships, directMemberships, blocks] = await Promise.all([
    prisma.friendship.findMany({
      where: { status: "ACCEPTED", OR: [{ requesterId: subjectUserId }, { addresseeId: subjectUserId }] },
      select: { requesterId: true, addresseeId: true }
    }),
    prisma.guildMember.findMany({ where: { userId: subjectUserId }, select: { guildId: true } }),
    prisma.directConversationMember.findMany({ where: { userId: subjectUserId }, select: { conversationId: true } }),
    prisma.userBlock.findMany({
      where: { OR: [{ blockerId: subjectUserId }, { blockedId: subjectUserId }] },
      select: { blockerId: true, blockedId: true }
    }).catch(() => [])
  ]);

  const audience = new Set<string>([subjectUserId]);
  for (const friendship of friendships) {
    audience.add(friendship.requesterId === subjectUserId ? friendship.addresseeId : friendship.requesterId);
  }

  if (memberships.length) {
    const members = await prisma.guildMember.findMany({
      where: { guildId: { in: memberships.map((item) => item.guildId) } },
      select: { userId: true }
    });
    for (const member of members) audience.add(member.userId);
  }

  if (directMemberships.length) {
    const directMembers = await prisma.directConversationMember.findMany({
      where: { conversationId: { in: directMemberships.map((item) => item.conversationId) } },
      select: { userId: true }
    });
    for (const member of directMembers) audience.add(member.userId);
  }

  for (const block of blocks) {
    const other = block.blockerId === subjectUserId ? block.blockedId : block.blockerId;
    audience.delete(other);
  }
  return Array.from(audience);
}

export async function presenceModeHidden(userId: string) {
  const row = await prisma.gingaGamingProfile.findUnique({
    where: { userId },
    select: { presenceMode: true }
  }).catch(() => null);
  return row?.presenceMode === "OFFLINE";
}
