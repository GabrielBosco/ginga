import { createHmac } from "node:crypto";
import { Prisma } from "@prisma/client";
import type { Request } from "express";
import { config } from "./config.js";
import { prisma } from "./db.js";

interface AuditInput {
  guildId: string;
  actorId?: string | null;
  action: string;
  targetType?: string | null;
  targetId?: string | null;
  targetUserId?: string | null;
  metadata?: Record<string, unknown> | null;
  request?: Request;
}

function hashIp(ip: string | undefined): string | null {
  if (!ip) return null;
  return createHmac("sha256", config.JWT_SECRET).update(ip).digest("hex").slice(0, 48);
}

export async function writeAudit(input: AuditInput) {
  await prisma.guildAuditLog.create({
    data: {
      guildId: input.guildId,
      actorId: input.actorId ?? null,
      action: input.action.slice(0, 64),
      targetType: input.targetType?.slice(0, 32) ?? null,
      targetId: input.targetId?.slice(0, 128) ?? null,
      targetUserId: input.targetUserId ?? null,
      metadata: input.metadata ? input.metadata as Prisma.InputJsonValue : undefined,
      ipHash: hashIp(input.request?.ip)
    }
  });
}
