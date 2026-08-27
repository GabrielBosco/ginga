import { randomBytes } from "node:crypto";
import { HttpError } from "./errors.js";

const colors = ["#6f9e90", "#7590b5", "#8d7fa8", "#b08a6d", "#8b9f6a", "#9f7784", "#708a9e"];

export function randomColor(): string {
  return colors[Math.floor(Math.random() * colors.length)] ?? "#6f9e90";
}

export function inviteCode(): string {
  return randomBytes(9).toString("base64url").slice(0, 12).toUpperCase();
}

export function safeFileName(value: string): string {
  const sanitized = value
    .normalize("NFKC")
    .replace(/[\x00-\x1f\x7f<>:"/\\|?*]/g, "_")
    .replace(/\s+/g, " ")
    .replace(/[. ]+$/g, "")
    .trim();
  const fallback = sanitized || "arquivo";
  return fallback.slice(0, 180);
}

export function routeParam(value: string | string[] | undefined, name: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new HttpError(400, `Parametro de rota invalido: ${name}`);
  }
  return value;
}
