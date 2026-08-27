import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db.js";
import { asyncHandler, HttpError } from "../errors.js";
import { requireAuth } from "../middleware.js";
import { requireChannelCapability } from "../permissions.js";
import { routeParam } from "../utils.js";

export const channelsRouter = Router();

const querySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  before: z.string().datetime().optional()
});

channelsRouter.get("/channels/:channelId/messages", requireAuth, asyncHandler(async (req, res) => {
  const channelId = routeParam(req.params.channelId, "channelId");
  const { channel } = await requireChannelCapability(req.auth!.sub, channelId, "view");
  if (!["TEXT", "ANNOUNCEMENT", "FORUM", "EVENT"].includes(channel.type)) throw new HttpError(400, "Este canal nao aceita mensagens de texto");

  const query = querySchema.parse(req.query);
  const messages = await prisma.message.findMany({
    where: {
      channelId: channel.id,
      ...(query.before ? { createdAt: { lt: new Date(query.before) } } : {})
    },
    orderBy: { createdAt: "desc" },
    take: query.limit,
    include: {
      author: { select: { id: true, username: true, displayName: true, avatarColor: true, systemRole: true, platformOwner: true, accountType: true } },
      attachments: { orderBy: { createdAt: "asc" } },
      reactions: { include: { user: { select: { id: true, username: true, displayName: true } } }, orderBy: { createdAt: "asc" } },
      replyTo: { include: { author: { select: { id: true, username: true, displayName: true, avatarColor: true, systemRole: true, platformOwner: true, accountType: true } } } }
    }
  });

  res.json({ messages: messages.reverse() });
}));
