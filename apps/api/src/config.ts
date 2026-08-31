import "dotenv/config";
import { z } from "zod";

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3001),
  DATABASE_URL: z.string().min(1),
  JWT_SECRET: z.string().min(48),
  JWT_EXPIRES_IN: z.string().default("12h"),
  MFA_ENCRYPTION_KEY: z.string().trim().regex(/^[0-9a-fA-F]{64}$/).optional(),
  JWT_ISSUER: z.string().min(3).max(64).default("nexora-api"),
  JWT_AUDIENCE: z.string().min(3).max(64).default("nexora-client"),
  APP_ORIGINS: z.string().default("http://localhost:3090"),
  MAX_UPLOAD_MB: z.coerce.number().int().min(1).max(500).default(50),
  MAX_USER_STORAGE_MB: z.coerce.number().int().min(100).max(102400).default(2048),
  UPLOAD_DIR: z.string().default("./data/uploads"),
  LIVEKIT_API_KEY: z.string().min(3),
  LIVEKIT_API_SECRET: z.string().min(16),
  PUBLIC_LIVEKIT_URL: z.string().url(),
  LIVEKIT_INTERNAL_URL: z.string().url().default("http://livekit:7880"),
  AUTH_MAX_FAILED_ATTEMPTS: z.coerce.number().int().min(3).max(20).default(8),
  AUTH_LOCK_MINUTES: z.coerce.number().int().min(1).max(1440).default(15),
  AUTH_LOGIN_LIMIT_10M: z.coerce.number().int().min(3).max(100).default(20),
  AUTH_REGISTER_LIMIT_HOUR: z.coerce.number().int().min(1).max(100).default(10),
  API_RATE_LIMIT_5M: z.coerce.number().int().min(100).max(10000).default(1200),
  UPLOAD_RATE_LIMIT_HOUR: z.coerce.number().int().min(1).max(1000).default(120),
  SOCKET_MESSAGE_LIMIT_10S: z.coerce.number().int().min(5).max(500).default(40),
  SOCKET_CALL_LIMIT_MINUTE: z.coerce.number().int().min(1).max(100).default(10),
  LIVEKIT_TOKEN_LIMIT_MINUTE: z.coerce.number().int().min(5).max(500).default(60),
  ALLOW_REGISTRATION: z.enum(["true", "false"]).default("true"),
  EMAIL_VERIFICATION_REQUIRED: z.enum(["true", "false"]).default("false"),
  PLATFORM_OWNER_USERNAME: z.string().trim().min(3).max(24).regex(/^[a-zA-Z0-9_.-]+$/).optional(),
  ALLOW_FIRST_USER_PLATFORM_OWNER: z.enum(["true", "false"]).default("false"),
  ALLOW_LEGACY_WEBHOOK_URL_TOKENS: z.enum(["true", "false"]).default("false"),
  YOUTUBE_API_KEY: z.string().trim().optional().default(""),
  SOUNDCLOUD_CLIENT_ID: z.string().trim().optional().default(""),
  SOUNDCLOUD_CLIENT_SECRET: z.string().trim().optional().default(""),
  MUSIC_MAX_QUEUE: z.coerce.number().int().min(10).max(500).default(200),
  MUSIC_MAX_PLAYLIST_ITEMS: z.coerce.number().int().min(10).max(100).default(50)
}).superRefine((value, ctx) => {
  if (/CHANGE_ME/i.test(value.JWT_SECRET)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["JWT_SECRET"], message: "JWT_SECRET padrao nao e permitido" });
  if (/CHANGE_ME/i.test(value.LIVEKIT_API_KEY)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["LIVEKIT_API_KEY"], message: "LIVEKIT_API_KEY padrao nao e permitido" });
  if (/CHANGE_ME/i.test(value.LIVEKIT_API_SECRET)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["LIVEKIT_API_SECRET"], message: "LIVEKIT_API_SECRET padrao nao e permitido" });
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  console.error("Configuracao invalida:", parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const config = {
  ...parsed.data,
  appOrigins: parsed.data.APP_ORIGINS.split(",").map((value) => value.trim()).filter(Boolean),
  maxUploadBytes: parsed.data.MAX_UPLOAD_MB * 1024 * 1024,
  maxUserStorageBytes: parsed.data.MAX_USER_STORAGE_MB * 1024 * 1024,
  authLockMs: parsed.data.AUTH_LOCK_MINUTES * 60 * 1000,
  allowRegistration: parsed.data.ALLOW_REGISTRATION === "true",
  emailVerificationRequired: parsed.data.EMAIL_VERIFICATION_REQUIRED === "true",
  platformOwnerUsername: parsed.data.PLATFORM_OWNER_USERNAME?.toLowerCase() ?? null,
  allowFirstUserPlatformOwner: parsed.data.ALLOW_FIRST_USER_PLATFORM_OWNER === "true",
  allowLegacyWebhookUrlTokens: parsed.data.ALLOW_LEGACY_WEBHOOK_URL_TOKENS === "true",
  youtubeApiKey: parsed.data.YOUTUBE_API_KEY,
  soundcloudClientId: parsed.data.SOUNDCLOUD_CLIENT_ID,
  soundcloudClientSecret: parsed.data.SOUNDCLOUD_CLIENT_SECRET,
  musicMaxQueue: parsed.data.MUSIC_MAX_QUEUE,
  musicMaxPlaylistItems: parsed.data.MUSIC_MAX_PLAYLIST_ITEMS
};
