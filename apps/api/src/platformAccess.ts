import { prisma } from "./db.js";
import { HttpError } from "./errors.js";

export async function requirePlatformAdmin(userId: string) {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, systemRole: true, platformOwner: true, accountType: true } });
  if (!user || user.accountType !== "HUMAN" || user.systemRole !== "PLATFORM_ADMIN") {
    throw new HttpError(403, "Acesso exclusivo da administracao da plataforma");
  }
  return user;
}

export async function requireDeveloperAccess(userId: string) {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, systemRole: true, platformOwner: true, accountType: true } });
  if (!user || user.accountType !== "HUMAN" || !["DEVELOPER", "PLATFORM_ADMIN"].includes(user.systemRole)) {
    throw new HttpError(403, "Sua conta nao possui acesso ao Portal do Desenvolvedor");
  }
  return user;
}
