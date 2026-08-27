import { randomUUID } from "node:crypto";
import { Router, type Request } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { writeAudit } from "../audit.js";
import { config } from "../config.js";
import { prisma } from "../db.js";
import { asyncHandler, HttpError } from "../errors.js";
import { requireAuth } from "../middleware.js";
import { effectiveGuildPermissionsForUser, requireChannelCapability, requireGuildMember } from "../permissions.js";
import { routeParam } from "../utils.js";

export const musicRouter = Router();

const musicProviderLimiter = rateLimit({
  windowMs: 60_000,
  limit: 40,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Muitas consultas de musica em pouco tempo. Aguarde alguns segundos." }
});

const musicControlLimiter = rateLimit({
  windowMs: 60_000,
  limit: 90,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Muitos comandos de musica em pouco tempo. Aguarde alguns segundos." }
});

type MusicProvider = "YOUTUBE" | "SOUNDCLOUD";
type MusicPlaybackStatus = "IDLE" | "PLAYING" | "PAUSED";
type MusicRepeatMode = "OFF" | "TRACK" | "QUEUE";

export interface MusicTrack {
  id: string;
  provider: MusicProvider;
  providerId: string;
  title: string;
  url: string;
  thumbnailUrl: string | null;
  durationSeconds: number | null;
  requestedBy: string;
  requestedByName: string;
  addedAt: string;
}

interface MusicRuntimeState {
  guildId: string;
  channelId: string | null;
  status: MusicPlaybackStatus;
  queue: MusicTrack[];
  history: MusicTrack[];
  volume: number;
  repeat: MusicRepeatMode;
  shuffle: boolean;
  startedAt: number | null;
  pausedPositionSeconds: number;
  revision: number;
}

const musicStates = new Map<string, MusicRuntimeState>();
const musicPlaybackLeases = new Map<string, { clientId: string; expiresAt: number }>();
const MUSIC_PLAYBACK_LEASE_TTL_MS = 12_000;

const settingsSchema = z.object({
  enabled: z.boolean().optional(),
  allowMembers: z.boolean().optional(),
  defaultVolume: z.number().int().min(0).max(100).optional(),
  defaultVoiceChannelId: z.string().min(1).max(128).nullable().optional()
}).refine((value) => Object.keys(value).length > 0, { message: "Nenhuma alteracao informada" });

const queueSchema = z.object({ input: z.string().trim().min(3).max(700) });
const joinSchema = z.object({ channelId: z.string().min(1).max(128) });
const playbackLeaseSchema = z.object({ clientId: z.string().min(8).max(128), action: z.enum(["ACQUIRE", "RELEASE"]).default("ACQUIRE") });
const controlSchema = z.object({
  action: z.enum(["PLAY", "PAUSE", "SKIP", "PREVIOUS", "STOP", "CLEAR", "SHUFFLE", "REPEAT", "VOLUME", "ENDED"]),
  volume: z.number().int().min(0).max(100).optional(),
  repeat: z.enum(["OFF", "TRACK", "QUEUE"]).optional(),
  expectedTrackId: z.string().min(1).max(128).optional()
});
const searchSchema = z.object({
  q: z.string().trim().min(2).max(120),
  limit: z.coerce.number().int().min(1).max(20).default(8),
  provider: z.enum(["YOUTUBE", "SOUNDCLOUD"]).default("YOUTUBE")
});

function emptyRuntime(guildId: string, volume = 70): MusicRuntimeState {
  return {
    guildId,
    channelId: null,
    status: "IDLE",
    queue: [],
    history: [],
    volume,
    repeat: "OFF",
    shuffle: false,
    startedAt: null,
    pausedPositionSeconds: 0,
    revision: 1
  };
}

function currentPosition(state: MusicRuntimeState) {
  if (state.status !== "PLAYING" || !state.startedAt) return Math.max(0, state.pausedPositionSeconds);
  return Math.max(0, state.pausedPositionSeconds + (Date.now() - state.startedAt) / 1000);
}

function touch(state: MusicRuntimeState) {
  state.revision += 1;
}

function publicRuntime(state: MusicRuntimeState) {
  return {
    guildId: state.guildId,
    channelId: state.channelId,
    status: state.status,
    queue: state.queue,
    history: state.history.slice(-15),
    current: state.queue[0] ?? null,
    volume: state.volume,
    repeat: state.repeat,
    shuffle: state.shuffle,
    positionSeconds: currentPosition(state),
    serverNow: Date.now(),
    revision: state.revision
  };
}

async function guildMusicSettings(guildId: string) {
  const guild = await prisma.guild.findUnique({
    where: { id: guildId },
    select: {
      id: true,
      musicEnabled: true,
      musicAllowMembers: true,
      musicDefaultVolume: true,
      musicDefaultVoiceChannelId: true
    }
  });
  if (!guild) throw new HttpError(404, "Servidor nao encontrado");
  return guild;
}

async function runtimeFor(guildId: string) {
  let runtime = musicStates.get(guildId);
  if (!runtime) {
    const settings = await guildMusicSettings(guildId);
    runtime = emptyRuntime(guildId, settings.musicDefaultVolume);
    musicStates.set(guildId, runtime);
  }
  return runtime;
}

function emitMusic(req: Request, guildId: string, state: MusicRuntimeState) {
  const io = req.app.get("io");
  io?.to?.(`guild:${guildId}`)?.emit?.("music:state", publicRuntime(state));
}

function publicSettings(settings: { musicEnabled: boolean; musicAllowMembers: boolean; musicDefaultVolume: number; musicDefaultVoiceChannelId: string | null }) {
  return {
    enabled: settings.musicEnabled,
    allowMembers: settings.musicAllowMembers,
    defaultVolume: settings.musicDefaultVolume,
    defaultVoiceChannelId: settings.musicDefaultVoiceChannelId,
    youtubeSearchEnabled: Boolean(config.youtubeApiKey),
    soundcloudSearchEnabled: Boolean(config.soundcloudClientId && config.soundcloudClientSecret),
    maxQueue: config.musicMaxQueue,
    maxPlaylistItems: config.musicMaxPlaylistItems
  };
}

function emitMusicSettings(req: Request, guildId: string, settings: { musicEnabled: boolean; musicAllowMembers: boolean; musicDefaultVolume: number; musicDefaultVoiceChannelId: string | null }) {
  const io = req.app.get("io");
  io?.to?.(`guild:${guildId}`)?.emit?.("music:settings", { guildId, settings: publicSettings(settings) });
}

async function musicAccess(userId: string, guildId: string, requireManager = false) {
  const { membership, permissions } = await effectiveGuildPermissionsForUser(userId, guildId);
  const settings = await guildMusicSettings(guildId);
  const manager = membership.role === "OWNER" || membership.role === "ADMIN" || permissions.canManageServer || permissions.canManageBots;
  if (requireManager && !manager) throw new HttpError(403, "Voce nao pode gerenciar o Ginga Music neste servidor");
  if (!requireManager && !settings.musicAllowMembers && !manager) throw new HttpError(403, "Somente a moderacao pode controlar a musica neste servidor");
  return { membership, permissions, settings, manager };
}

function parseYoutube(input: URL) {
  const host = input.hostname.toLowerCase().replace(/^www\./, "");
  if (!["youtube.com", "m.youtube.com", "youtu.be", "youtube-nocookie.com"].includes(host)) return null;
  let videoId = "";
  if (host === "youtu.be") videoId = input.pathname.split("/").filter(Boolean)[0] ?? "";
  else if (input.pathname === "/watch") videoId = input.searchParams.get("v") ?? "";
  else if (input.pathname.startsWith("/shorts/") || input.pathname.startsWith("/embed/")) videoId = input.pathname.split("/").filter(Boolean)[1] ?? "";
  const playlistId = input.searchParams.get("list") ?? "";
  return { videoId: /^[A-Za-z0-9_-]{6,20}$/.test(videoId) ? videoId : "", playlistId: /^[A-Za-z0-9_-]{8,80}$/.test(playlistId) ? playlistId : "" };
}

function isSoundCloud(input: URL) {
  const host = input.hostname.toLowerCase().replace(/^www\./, "");
  return host === "soundcloud.com" || host === "m.soundcloud.com" || host === "on.soundcloud.com";
}

function parseIsoDuration(value: string | undefined) {
  if (!value) return null;
  const match = value.match(/^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/i);
  if (!match) return null;
  const days = Number(match[1] || 0);
  const hours = Number(match[2] || 0);
  const minutes = Number(match[3] || 0);
  const seconds = Number(match[4] || 0);
  const total = days * 86400 + hours * 3600 + minutes * 60 + seconds;
  return Number.isFinite(total) && total > 0 ? total : null;
}

async function safeJsonFetch(url: string, extraHeaders: Record<string, string> = {}) {
  const response = await fetch(url, {
    headers: { "User-Agent": "GingaMusic/1.0", ...extraHeaders },
    signal: AbortSignal.timeout(8_000),
    redirect: "follow"
  });
  if (!response.ok) throw new HttpError(502, `O provedor de musica respondeu ${response.status}`);
  return response.json() as Promise<unknown>;
}


let soundCloudTokenCache: { token: string; expiresAt: number } | null = null;

async function soundCloudAccessToken() {
  if (!config.soundcloudClientId || !config.soundcloudClientSecret) {
    throw new HttpError(409, "Busca do SoundCloud indisponivel: configure SOUNDCLOUD_CLIENT_ID e SOUNDCLOUD_CLIENT_SECRET no servidor");
  }
  if (soundCloudTokenCache && soundCloudTokenCache.expiresAt > Date.now() + 30_000) return soundCloudTokenCache.token;

  const credentials = Buffer.from(`${config.soundcloudClientId}:${config.soundcloudClientSecret}`, "utf8").toString("base64");
  const response = await fetch("https://secure.soundcloud.com/oauth/token", {
    method: "POST",
    headers: {
      "Accept": "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
      "Authorization": `Basic ${credentials}`,
      "User-Agent": "GingaMusic/1.0"
    },
    body: new URLSearchParams({ grant_type: "client_credentials" }),
    signal: AbortSignal.timeout(8_000)
  });
  if (!response.ok) throw new HttpError(502, `Nao foi possivel autenticar no SoundCloud (${response.status})`);
  const payload = await response.json() as { access_token?: string; expires_in?: number };
  if (!payload.access_token) throw new HttpError(502, "O SoundCloud nao retornou um token de acesso valido");
  const expiresIn = Number(payload.expires_in ?? 3600);
  soundCloudTokenCache = {
    token: payload.access_token,
    expiresAt: Date.now() + Math.max(60, Number.isFinite(expiresIn) ? expiresIn : 3600) * 1000
  };
  return soundCloudTokenCache.token;
}

async function youtubeVideoInfo(videoId: string) {
  if (config.youtubeApiKey) {
    const apiUrl = new URL("https://www.googleapis.com/youtube/v3/videos");
    apiUrl.searchParams.set("part", "snippet,contentDetails");
    apiUrl.searchParams.set("id", videoId);
    apiUrl.searchParams.set("key", config.youtubeApiKey);
    const payload = await safeJsonFetch(apiUrl.toString()) as { items?: Array<{ id?: string; snippet?: { title?: string; thumbnails?: Record<string, { url?: string }> }; contentDetails?: { duration?: string } }> };
    const item = payload.items?.[0];
    if (item) {
      const thumbs = item.snippet?.thumbnails ?? {};
      return {
        title: item.snippet?.title?.slice(0, 180) || `YouTube ${videoId}`,
        thumbnailUrl: thumbs.maxres?.url || thumbs.high?.url || thumbs.medium?.url || thumbs.default?.url || null,
        durationSeconds: parseIsoDuration(item.contentDetails?.duration)
      };
    }
  }

  const oembed = new URL("https://www.youtube.com/oembed");
  oembed.searchParams.set("url", `https://www.youtube.com/watch?v=${videoId}`);
  oembed.searchParams.set("format", "json");
  const payload = await safeJsonFetch(oembed.toString()) as { title?: string; thumbnail_url?: string };
  return {
    title: payload.title?.slice(0, 180) || `YouTube ${videoId}`,
    thumbnailUrl: payload.thumbnail_url || null,
    durationSeconds: null
  };
}

async function youtubePlaylistItems(playlistId: string) {
  if (!config.youtubeApiKey) {
    throw new HttpError(409, "Para importar playlists do YouTube, configure YOUTUBE_API_KEY no .env do Ginga. Links de videos individuais funcionam sem a chave.");
  }
  const tracks: Array<{ videoId: string; title: string; thumbnailUrl: string | null }> = [];
  let pageToken = "";
  while (tracks.length < config.musicMaxPlaylistItems) {
    const apiUrl = new URL("https://www.googleapis.com/youtube/v3/playlistItems");
    apiUrl.searchParams.set("part", "snippet,contentDetails");
    apiUrl.searchParams.set("playlistId", playlistId);
    apiUrl.searchParams.set("maxResults", String(Math.min(50, config.musicMaxPlaylistItems - tracks.length)));
    apiUrl.searchParams.set("key", config.youtubeApiKey);
    if (pageToken) apiUrl.searchParams.set("pageToken", pageToken);
    const payload = await safeJsonFetch(apiUrl.toString()) as {
      items?: Array<{ contentDetails?: { videoId?: string }; snippet?: { title?: string; thumbnails?: Record<string, { url?: string }> } }>;
      nextPageToken?: string;
    };
    for (const item of payload.items ?? []) {
      const videoId = item.contentDetails?.videoId ?? "";
      if (!/^[A-Za-z0-9_-]{6,20}$/.test(videoId)) continue;
      const thumbs = item.snippet?.thumbnails ?? {};
      tracks.push({
        videoId,
        title: item.snippet?.title?.slice(0, 180) || `YouTube ${videoId}`,
        thumbnailUrl: thumbs.high?.url || thumbs.medium?.url || thumbs.default?.url || null
      });
      if (tracks.length >= config.musicMaxPlaylistItems) break;
    }
    pageToken = payload.nextPageToken ?? "";
    if (!pageToken) break;
  }

  if (!tracks.length) throw new HttpError(404, "Nenhuma musica foi encontrada nessa playlist do YouTube");

  const ids = tracks.map((track) => track.videoId);
  const durations = new Map<string, number | null>();
  for (let offset = 0; offset < ids.length; offset += 50) {
    const apiUrl = new URL("https://www.googleapis.com/youtube/v3/videos");
    apiUrl.searchParams.set("part", "contentDetails");
    apiUrl.searchParams.set("id", ids.slice(offset, offset + 50).join(","));
    apiUrl.searchParams.set("key", config.youtubeApiKey);
    const payload = await safeJsonFetch(apiUrl.toString()) as { items?: Array<{ id?: string; contentDetails?: { duration?: string } }> };
    for (const item of payload.items ?? []) if (item.id) durations.set(item.id, parseIsoDuration(item.contentDetails?.duration));
  }
  return tracks.map((track) => ({ ...track, durationSeconds: durations.get(track.videoId) ?? null }));
}

async function soundCloudInfo(url: string) {
  const oembed = new URL("https://soundcloud.com/oembed");
  oembed.searchParams.set("format", "json");
  oembed.searchParams.set("url", url);
  const payload = await safeJsonFetch(oembed.toString()) as { title?: string; thumbnail_url?: string; author_name?: string };
  return {
    title: payload.title?.slice(0, 180) || payload.author_name?.slice(0, 180) || "SoundCloud",
    thumbnailUrl: payload.thumbnail_url || null,
    durationSeconds: null
  };
}

function createTrack(data: Omit<MusicTrack, "id" | "addedAt">): MusicTrack {
  return { ...data, id: randomUUID(), addedAt: new Date().toISOString() };
}

async function resolveMusicInput(input: string, userId: string, userName: string): Promise<MusicTrack[]> {
  let parsed: URL;
  try { parsed = new URL(input); }
  catch { throw new HttpError(400, "Cole um link valido do YouTube ou SoundCloud. Para buscar por texto, configure a API do provedor no servidor."); }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") throw new HttpError(400, "Use somente links HTTP/HTTPS");

  const yt = parseYoutube(parsed);
  if (yt) {
    if (yt.playlistId) {
      const items = await youtubePlaylistItems(yt.playlistId);
      return items.map((item) => createTrack({
        provider: "YOUTUBE",
        providerId: item.videoId,
        title: item.title,
        url: `https://www.youtube.com/watch?v=${item.videoId}`,
        thumbnailUrl: item.thumbnailUrl,
        durationSeconds: item.durationSeconds,
        requestedBy: userId,
        requestedByName: userName
      }));
    }
    if (!yt.videoId) throw new HttpError(400, "O link do YouTube nao possui um video valido");
    const info = await youtubeVideoInfo(yt.videoId);
    return [createTrack({
      provider: "YOUTUBE",
      providerId: yt.videoId,
      title: info.title,
      url: `https://www.youtube.com/watch?v=${yt.videoId}`,
      thumbnailUrl: info.thumbnailUrl,
      durationSeconds: info.durationSeconds,
      requestedBy: userId,
      requestedByName: userName
    })];
  }

  if (isSoundCloud(parsed)) {
    const info = await soundCloudInfo(parsed.toString());
    return [createTrack({
      provider: "SOUNDCLOUD",
      providerId: parsed.toString(),
      title: info.title,
      url: parsed.toString(),
      thumbnailUrl: info.thumbnailUrl,
      durationSeconds: null,
      requestedBy: userId,
      requestedByName: userName
    })];
  }

  throw new HttpError(400, "Este provedor ainda nao e suportado. Use YouTube ou SoundCloud.");
}

function resetClock(state: MusicRuntimeState, positionSeconds = 0) {
  state.pausedPositionSeconds = Math.max(0, positionSeconds);
  state.startedAt = state.status === "PLAYING" ? Date.now() : null;
}

function advance(state: MusicRuntimeState, ended = false) {
  const current = state.queue[0];
  if (!current) {
    state.status = "IDLE";
    resetClock(state, 0);
    return;
  }
  if (ended && state.repeat === "TRACK") {
    state.status = "PLAYING";
    resetClock(state, 0);
    touch(state);
    return;
  }

  if (state.repeat === "QUEUE" && state.queue.length > 1) {
    state.queue.shift();
    state.queue.push(current);
  } else {
    state.queue.shift();
    state.history.push(current);
    if (state.history.length > 30) state.history.shift();
  }

  if (state.shuffle && state.queue.length > 1) {
    const currentFirst = state.queue[0];
    const rest = state.queue.slice(1);
    for (let index = rest.length - 1; index > 0; index -= 1) {
      const swap = Math.floor(Math.random() * (index + 1));
      [rest[index], rest[swap]] = [rest[swap]!, rest[index]!];
    }
    state.queue = currentFirst ? [currentFirst, ...rest] : rest;
  }

  state.status = state.queue.length ? "PLAYING" : "IDLE";
  resetClock(state, 0);
  touch(state);
}

musicRouter.get("/guilds/:guildId/music", requireAuth, asyncHandler(async (req, res) => {
  const guildId = routeParam(req.params.guildId, "guildId");
  const userId = req.auth!.sub;
  await requireGuildMember(userId, guildId);
  const settings = await guildMusicSettings(guildId);
  const state = await runtimeFor(guildId);
  res.json({
    settings: publicSettings(settings),
    state: publicRuntime(state)
  });
}));

musicRouter.patch("/guilds/:guildId/music/settings", requireAuth, asyncHandler(async (req, res) => {
  const guildId = routeParam(req.params.guildId, "guildId");
  const userId = req.auth!.sub;
  await musicAccess(userId, guildId, true);
  const data = settingsSchema.parse(req.body);

  if (data.defaultVoiceChannelId) {
    const channel = await prisma.channel.findUnique({ where: { id: data.defaultVoiceChannelId }, select: { guildId: true, type: true } });
    if (!channel || channel.guildId !== guildId || channel.type !== "VOICE") throw new HttpError(400, "Canal padrao de musica invalido");
  }

  const updated = await prisma.guild.update({
    where: { id: guildId },
    data: {
      ...(data.enabled !== undefined ? { musicEnabled: data.enabled } : {}),
      ...(data.allowMembers !== undefined ? { musicAllowMembers: data.allowMembers } : {}),
      ...(data.defaultVolume !== undefined ? { musicDefaultVolume: data.defaultVolume } : {}),
      ...(data.defaultVoiceChannelId !== undefined ? { musicDefaultVoiceChannelId: data.defaultVoiceChannelId } : {})
    },
    select: { musicEnabled: true, musicAllowMembers: true, musicDefaultVolume: true, musicDefaultVoiceChannelId: true }
  });

  const state = await runtimeFor(guildId);
  if (data.defaultVolume !== undefined && state.status === "IDLE") state.volume = data.defaultVolume;
  if (data.enabled === false) {
    state.status = "IDLE";
    state.queue = [];
    state.history = [];
    state.channelId = null;
    resetClock(state, 0);
    touch(state);
  }
  emitMusic(req, guildId, state);
  emitMusicSettings(req, guildId, updated);
  await writeAudit({ guildId, actorId: userId, action: "MUSIC_SETTINGS_UPDATE", targetType: "MUSIC", targetId: guildId, metadata: data, request: req });
  res.json({
    settings: publicSettings(updated),
    state: publicRuntime(state)
  });
}));

musicRouter.post("/guilds/:guildId/music/playback-lease", requireAuth, asyncHandler(async (req, res) => {
  const guildId = routeParam(req.params.guildId, "guildId");
  const userId = req.auth!.sub;
  await requireGuildMember(userId, guildId);
  const { clientId, action } = playbackLeaseSchema.parse(req.body);
  const key = `${guildId}:${userId}`;
  const current = musicPlaybackLeases.get(key);

  if (action === "RELEASE") {
    if (current?.clientId === clientId) musicPlaybackLeases.delete(key);
    return res.json({ owner: false, expiresAt: 0 });
  }

  const now = Date.now();
  if (!current || current.clientId === clientId || current.expiresAt <= now) {
    const expiresAt = now + MUSIC_PLAYBACK_LEASE_TTL_MS;
    musicPlaybackLeases.set(key, { clientId, expiresAt });
    return res.json({ owner: true, expiresAt });
  }
  res.json({ owner: false, expiresAt: current.expiresAt });
}));

musicRouter.post("/guilds/:guildId/music/join", requireAuth, asyncHandler(async (req, res) => {
  const guildId = routeParam(req.params.guildId, "guildId");
  const userId = req.auth!.sub;
  const { settings } = await musicAccess(userId, guildId);
  if (!settings.musicEnabled) throw new HttpError(409, "O Ginga Music esta desativado neste servidor");
  const { channelId } = joinSchema.parse(req.body);
  const { channel } = await requireChannelCapability(userId, channelId, "connect");
  if (channel.guildId !== guildId || channel.type !== "VOICE") throw new HttpError(400, "Escolha uma sala de voz deste servidor");
  const state = await runtimeFor(guildId);
  state.channelId = channelId;
  if (state.queue.length && state.status === "IDLE") state.status = "PLAYING";
  resetClock(state, currentPosition(state));
  touch(state);
  emitMusic(req, guildId, state);
  res.json({ state: publicRuntime(state) });
}));

musicRouter.post("/guilds/:guildId/music/leave", requireAuth, asyncHandler(async (req, res) => {
  const guildId = routeParam(req.params.guildId, "guildId");
  const userId = req.auth!.sub;
  const { settings } = await musicAccess(userId, guildId);
  if (!settings.musicEnabled) throw new HttpError(409, "O Ginga Music esta desativado neste servidor");
  const state = await runtimeFor(guildId);
  const position = currentPosition(state);
  state.channelId = null;
  state.status = "IDLE";
  state.startedAt = null;
  state.pausedPositionSeconds = position;
  touch(state);
  emitMusic(req, guildId, state);
  res.json({ state: publicRuntime(state) });
}));

musicRouter.post("/guilds/:guildId/music/queue", requireAuth, musicProviderLimiter, asyncHandler(async (req, res) => {
  const guildId = routeParam(req.params.guildId, "guildId");
  const userId = req.auth!.sub;
  const { settings } = await musicAccess(userId, guildId);
  if (!settings.musicEnabled) throw new HttpError(409, "Ative o Ginga Music nas configuracoes do servidor primeiro");
  const { input } = queueSchema.parse(req.body);
  const requester = await prisma.user.findUnique({ where: { id: userId }, select: { displayName: true } });
  if (!requester) throw new HttpError(401, "Usuario nao encontrado");
  const tracks = await resolveMusicInput(input, userId, requester.displayName);
  const state = await runtimeFor(guildId);
  if (state.queue.length + tracks.length > config.musicMaxQueue) throw new HttpError(409, `A fila aceita no maximo ${config.musicMaxQueue} itens`);
  state.queue.push(...tracks);
  if (!state.channelId && settings.musicDefaultVoiceChannelId) {
    const defaultChannel = await prisma.channel.findUnique({
      where: { id: settings.musicDefaultVoiceChannelId },
      select: { id: true, guildId: true, type: true }
    });
    if (defaultChannel?.guildId === guildId && defaultChannel.type === "VOICE") {
      state.channelId = defaultChannel.id;
    }
  }
  if (state.channelId && state.status === "IDLE") {
    state.status = "PLAYING";
    resetClock(state, 0);
  }
  touch(state);
  emitMusic(req, guildId, state);
  res.status(201).json({ added: tracks, state: publicRuntime(state) });
}));

musicRouter.delete("/guilds/:guildId/music/queue/:trackId", requireAuth, asyncHandler(async (req, res) => {
  const guildId = routeParam(req.params.guildId, "guildId");
  const trackId = routeParam(req.params.trackId, "trackId");
  const userId = req.auth!.sub;
  await musicAccess(userId, guildId);
  const state = await runtimeFor(guildId);
  const index = state.queue.findIndex((item) => item.id === trackId);
  if (index < 0) throw new HttpError(404, "Item nao encontrado na fila");
  if (index === 0) advance(state, false);
  else { state.queue.splice(index, 1); touch(state); }
  emitMusic(req, guildId, state);
  res.json({ state: publicRuntime(state) });
}));

musicRouter.post("/guilds/:guildId/music/control", requireAuth, musicControlLimiter, asyncHandler(async (req, res) => {
  const guildId = routeParam(req.params.guildId, "guildId");
  const userId = req.auth!.sub;
  const data = controlSchema.parse(req.body);
  // ENDED e um sinal do player oficial, nao um comando de moderacao.
  // Qualquer membro conectado pode reportar o fim da faixa, mas sempre precisa
  // identificar a faixa atual; os demais comandos respeitam musicAllowMembers.
  const settings = data.action === "ENDED"
    ? await (async () => { await requireGuildMember(userId, guildId); return guildMusicSettings(guildId); })()
    : (await musicAccess(userId, guildId)).settings;
  if (!settings.musicEnabled) throw new HttpError(409, "O Ginga Music esta desativado neste servidor");
  const state = await runtimeFor(guildId);

  if (data.action === "ENDED") {
    if (!data.expectedTrackId || state.queue[0]?.id !== data.expectedTrackId) return res.json({ state: publicRuntime(state) });
    advance(state, true);
  } else if (data.action === "PLAY") {
    if (state.queue.length) {
      state.status = "PLAYING";
      state.startedAt = Date.now();
      touch(state);
    }
  } else if (data.action === "PAUSE") {
    if (state.status === "PLAYING") {
      state.pausedPositionSeconds = currentPosition(state);
      state.status = "PAUSED";
      state.startedAt = null;
      touch(state);
    }
  } else if (data.action === "SKIP") {
    advance(state, false);
  } else if (data.action === "PREVIOUS") {
    const previous = state.history.pop();
    if (previous) {
      const current = state.queue[0];
      if (current) state.queue.shift();
      if (current) state.queue.unshift(current);
      state.queue.unshift(previous);
      state.status = "PLAYING";
      resetClock(state, 0);
      touch(state);
    } else {
      resetClock(state, 0);
      state.status = state.queue.length ? "PLAYING" : "IDLE";
      touch(state);
    }
  } else if (data.action === "STOP") {
    state.status = "IDLE";
    state.channelId = null;
    state.queue = [];
    state.history = [];
    resetClock(state, 0);
    touch(state);
  } else if (data.action === "CLEAR") {
    if (state.queue.length > 1) state.queue = [state.queue[0]!];
    touch(state);
  } else if (data.action === "SHUFFLE") {
    state.shuffle = !state.shuffle;
    if (state.queue.length > 2) {
      const current = state.queue[0]!;
      const rest = state.queue.slice(1);
      for (let index = rest.length - 1; index > 0; index -= 1) {
        const swap = Math.floor(Math.random() * (index + 1));
        [rest[index], rest[swap]] = [rest[swap]!, rest[index]!];
      }
      state.queue = [current, ...rest];
    }
    touch(state);
  } else if (data.action === "REPEAT") {
    state.repeat = data.repeat ?? (state.repeat === "OFF" ? "QUEUE" : state.repeat === "QUEUE" ? "TRACK" : "OFF");
    touch(state);
  } else if (data.action === "VOLUME") {
    if (data.volume === undefined) throw new HttpError(400, "Informe o volume");
    state.volume = data.volume;
    touch(state);
  }

  emitMusic(req, guildId, state);
  res.json({ state: publicRuntime(state) });
}));

musicRouter.get("/guilds/:guildId/music/search", requireAuth, musicProviderLimiter, asyncHandler(async (req, res) => {
  const guildId = routeParam(req.params.guildId, "guildId");
  const userId = req.auth!.sub;
  const { settings } = await musicAccess(userId, guildId);
  if (!settings.musicEnabled) throw new HttpError(409, "O Ginga Music esta desativado neste servidor");
  const { q, limit, provider } = searchSchema.parse(req.query);

  if (provider === "SOUNDCLOUD") {
    const token = await soundCloudAccessToken();
    const apiUrl = new URL("https://api.soundcloud.com/tracks");
    apiUrl.searchParams.set("q", q);
    apiUrl.searchParams.set("access", "playable");
    apiUrl.searchParams.set("limit", String(limit));
    apiUrl.searchParams.set("linked_partitioning", "true");
    const payload = await safeJsonFetch(apiUrl.toString(), { Authorization: `OAuth ${token}` }) as {
      collection?: Array<{
        id?: string | number;
        urn?: string;
        title?: string;
        permalink_url?: string;
        artwork_url?: string | null;
        duration?: number;
        access?: string;
        user?: { username?: string; avatar_url?: string | null };
      }>;
    };
    const results = (payload.collection ?? []).flatMap((item) => {
      const url = item.permalink_url ?? "";
      if (!url || item.access === "blocked") return [];
      return [{
        provider: "SOUNDCLOUD" as const,
        providerId: item.urn || String(item.id ?? url),
        title: item.title?.slice(0, 180) || "SoundCloud",
        author: item.user?.username?.slice(0, 120) || "SoundCloud",
        thumbnailUrl: item.artwork_url || item.user?.avatar_url || null,
        url
      }];
    });
    return res.json({ results });
  }

  if (!config.youtubeApiKey) throw new HttpError(409, "Busca do YouTube indisponivel: configure YOUTUBE_API_KEY no servidor");
  const apiUrl = new URL("https://www.googleapis.com/youtube/v3/search");
  apiUrl.searchParams.set("part", "snippet");
  apiUrl.searchParams.set("type", "video");
  apiUrl.searchParams.set("videoEmbeddable", "true");
  apiUrl.searchParams.set("safeSearch", "moderate");
  apiUrl.searchParams.set("maxResults", String(limit));
  apiUrl.searchParams.set("q", q);
  apiUrl.searchParams.set("key", config.youtubeApiKey);
  const payload = await safeJsonFetch(apiUrl.toString()) as {
    items?: Array<{ id?: { videoId?: string }; snippet?: { title?: string; channelTitle?: string; thumbnails?: Record<string, { url?: string }> } }>;
  };
  const results = (payload.items ?? []).flatMap((item) => {
    const videoId = item.id?.videoId ?? "";
    if (!videoId) return [];
    const thumbs = item.snippet?.thumbnails ?? {};
    return [{
      provider: "YOUTUBE" as const,
      providerId: videoId,
      title: item.snippet?.title ?? `YouTube ${videoId}`,
      author: item.snippet?.channelTitle ?? "YouTube",
      thumbnailUrl: thumbs.high?.url || thumbs.medium?.url || thumbs.default?.url || null,
      url: `https://www.youtube.com/watch?v=${videoId}`
    }];
  });
  res.json({ results });
}));
