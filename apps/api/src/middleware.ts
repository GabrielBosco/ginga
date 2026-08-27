import type { NextFunction, Request, Response } from "express";
import { verifyToken } from "./auth.js";
import { isAuthSessionActive } from "./authSessions.js";
import { prisma } from "./db.js";
import { HttpError } from "./errors.js";
import { secretMatches, tokenPrefix } from "./secretTokens.js";

export function requireAuth(req: Request, _res: Response, next: NextFunction) {
  const header = req.header("authorization");
  if (!header?.startsWith("Bearer ")) {
    return next(new HttpError(401, "Autenticacao obrigatoria"));
  }

  let payload;
  try {
    payload = verifyToken(header.slice(7));
  } catch (error) {
    return next(error);
  }

  void prisma.user.findUnique({
    where: { id: payload.sub },
    select: { id: true, tokenVersion: true, accountType: true, accountDisabled: true }
  }).then(async (user) => {
    if (!user || user.accountType !== "HUMAN" || user.tokenVersion !== payload.ver) return next(new HttpError(401, "Sessao revogada. Entre novamente."));
    if (user.accountDisabled) return next(new HttpError(403, "Esta conta esta desativada. Fale com um administrador do Ginga."));
    if (payload.sid && !(await isAuthSessionActive(payload.sid, payload.sub))) return next(new HttpError(401, "Esta sessao foi encerrada. Entre novamente."));
    req.auth = payload;
    return next();
  }).catch(next);
}

export function requireBotAuth(req: Request, _res: Response, next: NextFunction) {
  const header = req.header("authorization");
  if (!header?.startsWith("Bot ")) return next(new HttpError(401, "Token de bot obrigatorio"));
  const raw = header.slice(4).trim();
  if (raw.length < 24) return next(new HttpError(401, "Token de bot invalido"));

  const prefix = tokenPrefix(raw);
  void prisma.developerApplication.findFirst({
    where: { botTokenPrefix: prefix },
    select: { id: true, clientId: true, botUserId: true, botTokenHash: true }
  }).then((application) => {
    if (!application?.botUserId || !application.botTokenHash || !secretMatches(raw, application.botTokenHash)) {
      return next(new HttpError(401, "Token de bot invalido"));
    }
    req.botAuth = { applicationId: application.id, botUserId: application.botUserId, clientId: application.clientId };
    return next();
  }).catch(next);
}
