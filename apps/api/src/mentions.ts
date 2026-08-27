import { prisma } from "./db.js";
import { HttpError } from "./errors.js";

export const EVERYONE_MENTION_PATTERN = /(?:^|[^a-zA-Z0-9_.-])@(todos|everyone|here)(?=$|[^a-zA-Z0-9_.-])/i;
export const USER_MENTION_PATTERN = /(?:^|[^a-zA-Z0-9_.-])@([a-zA-Z0-9_.-]{3,24})(?=$|[^a-zA-Z0-9_.-])/g;

export function extractGuildMentions(content: string) {
  const mentionEveryone = EVERYONE_MENTION_PATTERN.test(content);
  const usernames = new Set<string>();
  for (const match of content.matchAll(USER_MENTION_PATTERN)) {
    const username = String(match[1] || "").toLowerCase();
    if (["todos", "everyone", "here"].includes(username)) continue;
    usernames.add(username);
  }
  return { mentionEveryone, usernames: Array.from(usernames) };
}

/**
 * Impede mencoes fantasmas: qualquer @usuario reconhecivel precisa existir no
 * servidor. A validacao fica na API para nao poder ser burlada pelo DevTools.
 */
export async function validateGuildMentions(guildId: string, content: string) {
  const mentions = extractGuildMentions(content);
  if (mentions.usernames.length === 0) return mentions;
  const members = await prisma.guildMember.findMany({
    where: { guildId, user: { username: { in: mentions.usernames } } },
    select: { user: { select: { username: true } } }
  });
  const existing = new Set(members.map((member) => member.user.username.toLowerCase()));
  const missing = mentions.usernames.filter((username) => !existing.has(username));
  if (missing.length) {
    const label = missing.length === 1 ? `@${missing[0]}` : missing.map((item) => `@${item}`).join(", ");
    throw new HttpError(400, `Usuario ${label} nao existe neste servidor`);
  }
  return mentions;
}
