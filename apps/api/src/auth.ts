import { randomUUID } from "node:crypto";
import jwt, { type JwtPayload, type SignOptions } from "jsonwebtoken";
import { config } from "./config.js";
import { HttpError } from "./errors.js";

export interface AuthPayload extends JwtPayload {
  sub: string;
  username: string;
  ver: number;
  sid?: string;
}

export function signToken(user: { id: string; username: string; tokenVersion?: number }, sessionId?: string | null): string {
  return jwt.sign(
    {
      username: user.username,
      ver: user.tokenVersion ?? 0,
      ...(sessionId ? { sid: sessionId } : {})
    },
    config.JWT_SECRET,
    {
      algorithm: "HS256",
      subject: user.id,
      issuer: config.JWT_ISSUER,
      audience: config.JWT_AUDIENCE,
      jwtid: randomUUID(),
      expiresIn: config.JWT_EXPIRES_IN as SignOptions["expiresIn"]
    }
  );
}

export function verifyToken(token: string): AuthPayload {
  try {
    const payload = jwt.verify(token, config.JWT_SECRET, {
      algorithms: ["HS256"],
      issuer: config.JWT_ISSUER,
      audience: config.JWT_AUDIENCE,
      clockTolerance: 10
    });
    if (
      typeof payload === "string" ||
      !payload.sub ||
      typeof payload.username !== "string" ||
      typeof payload.ver !== "number"
    ) {
      throw new Error("Payload invalido");
    }
    return payload as AuthPayload;
  } catch {
    throw new HttpError(401, "Sessao invalida ou expirada");
  }
}

interface PublicUserInput {
  id: string;
  username: string;
  displayName: string;
  avatarColor: string;
  bio?: string;
  statusMessage?: string;
  email?: string;
  allowFriendRequests?: boolean;
  allowDirectMessages?: boolean;
  createdAt?: Date;
  systemRole?: "USER" | "DEVELOPER" | "PLATFORM_ADMIN";
  platformOwner?: boolean;
  accountType?: "HUMAN" | "BOT" | "WEBHOOK" | "SYSTEM";
}

export function publicUser(user: PublicUserInput) {
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    avatarColor: user.avatarColor,
    bio: user.bio ?? "",
    statusMessage: user.statusMessage ?? "",
    ...(user.email ? { email: user.email } : {}),
    ...(typeof user.allowFriendRequests === "boolean" ? { allowFriendRequests: user.allowFriendRequests } : {}),
    ...(typeof user.allowDirectMessages === "boolean" ? { allowDirectMessages: user.allowDirectMessages } : {}),
    ...(user.createdAt ? { createdAt: user.createdAt } : {}),
    systemRole: user.systemRole ?? "USER",
    platformOwner: user.platformOwner ?? false,
    accountType: user.accountType ?? "HUMAN"
  };
}
