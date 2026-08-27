import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { config } from "./config.js";

export function hashSecret(secret: string) {
  return createHmac("sha256", config.JWT_SECRET).update(secret).digest("hex");
}

export function secureToken(prefix: string) {
  return `${prefix}_${randomBytes(36).toString("base64url")}`;
}

export function tokenPrefix(token: string, length = 18) {
  return token.slice(0, length);
}

export function secretMatches(secret: string, expectedHash: string) {
  const actual = Buffer.from(hashSecret(secret), "hex");
  const expected = Buffer.from(expectedHash, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
