import { prisma } from "./db.js";
import { HttpError } from "./errors.js";

function uniqueIds(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

export async function requireGuildCustomRoleId(guildId: string, roleId: string) {
  const role = await prisma.guildCustomRole.findFirst({
    where: { id: roleId, guildId },
    select: { id: true }
  });
  if (!role) throw new HttpError(400, "Cargo invalido para este servidor");
  return role.id;
}

export async function requireGuildCustomRoleIds(guildId: string, roleIds: string[]) {
  const ids = uniqueIds(roleIds);
  if (!ids.length) return ids;
  const rows = await prisma.guildCustomRole.findMany({
    where: { guildId, id: { in: ids } },
    select: { id: true }
  });
  if (rows.length !== ids.length) throw new HttpError(409, "Existe cargo de outro servidor na configuracao");
  return ids;
}

export async function requireGuildChannelIds(guildId: string, channelIds: string[]) {
  const ids = uniqueIds(channelIds);
  if (!ids.length) return ids;
  const rows = await prisma.channel.findMany({
    where: { guildId, id: { in: ids } },
    select: { id: true }
  });
  if (rows.length !== ids.length) throw new HttpError(409, "Existe canal de outro servidor na configuracao");
  return ids;
}

export async function requireGuildCategoryIds(guildId: string, categoryIds: string[]) {
  const ids = uniqueIds(categoryIds);
  if (!ids.length) return ids;
  const rows = await prisma.channelCategory.findMany({
    where: { guildId, id: { in: ids } },
    select: { id: true }
  });
  if (rows.length !== ids.length) throw new HttpError(409, "Existe categoria de outro servidor na configuracao");
  return ids;
}

export async function requireGuildCategoryId(guildId: string, categoryId: string) {
  const category = await prisma.channelCategory.findFirst({
    where: { id: categoryId, guildId },
    select: { id: true }
  });
  if (!category) throw new HttpError(400, "Categoria invalida para este servidor");
  return category.id;
}

export async function requireGuildTextChannelId(guildId: string, channelId: string) {
  const channel = await prisma.channel.findFirst({
    where: { id: channelId, guildId },
    select: { id: true, type: true }
  });
  if (!channel || !["TEXT", "ANNOUNCEMENT"].includes(channel.type)) {
    throw new HttpError(400, "Canal de log invalido para este servidor");
  }
  return channel.id;
}
