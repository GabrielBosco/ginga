import { ConnectionState, Track, type Room } from "livekit-client";

export interface SoundboardSound {
  id: string;
  name: string;
  emoji: string;
  mimeType: string;
  durationMs: number;
  sourceDurationMs?: number;
  trimStartMs?: number;
  trimEndMs?: number;
  createdBy?: string | null;
  createdAt?: string;
  url: string;
}

export interface SoundboardListResponse {
  sounds: SoundboardSound[];
  limits: {
    maxSounds: number;
    maxBytes: number;
    maxDurationMs: number;
    maxSourceDurationMs?: number;
  };
}

export interface SoundboardPlayedEvent {
  channelId: string;
  guildId: string;
  sound: Pick<SoundboardSound, "id" | "name" | "emoji" | "durationMs" | "trimStartMs" | "trimEndMs" | "url">;
  playedBy: { id: string; displayName: string };
  playAt: number;
}

const VOLUME_KEY = "ginga.voice.soundboardVolume";
const FAVORITES_PREFIX = "ginga.soundboard.favorites.";

export function loadSoundboardVolume() {
  try {
    const value = Number(localStorage.getItem(VOLUME_KEY));
    if (Number.isFinite(value)) return Math.max(0, Math.min(100, Math.round(value)));
  } catch {
    // Preferencia opcional.
  }
  return 80;
}

export function saveSoundboardVolume(value: number) {
  const next = Math.max(0, Math.min(100, Math.round(value)));
  try { localStorage.setItem(VOLUME_KEY, String(next)); } catch {}
  window.dispatchEvent(new CustomEvent("ginga:soundboard-volume-changed", { detail: { volume: next } }));
  return next;
}

export function loadSoundboardFavorites(guildId: string) {
  try {
    const raw = localStorage.getItem(`${FAVORITES_PREFIX}${guildId}`);
    if (!raw) return new Set<string>();
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set<string>();
    return new Set(parsed.filter((value): value is string => typeof value === "string"));
  } catch {
    return new Set<string>();
  }
}

export function saveSoundboardFavorites(guildId: string, ids: Set<string>) {
  try { localStorage.setItem(`${FAVORITES_PREFIX}${guildId}`, JSON.stringify(Array.from(ids))); } catch {}
}

export function soundboardMimeForFile(file: File) {
  const raw = file.type.toLowerCase().split(";")[0];
  const aliases: Record<string, string> = {
    "audio/mp3": "audio/mpeg",
    "audio/x-mp3": "audio/mpeg",
    "audio/x-wav": "audio/wav",
    "audio/wave": "audio/wav",
    "audio/vnd.wave": "audio/wav",
    "audio/x-m4a": "audio/mp4"
  };
  if (aliases[raw]) return aliases[raw];
  if (["audio/mpeg", "audio/wav", "audio/ogg", "audio/webm", "audio/mp4", "audio/aac"].includes(raw)) return raw;
  const extension = file.name.toLowerCase().split(".").pop() || "";
  if (extension === "mp3") return "audio/mpeg";
  if (extension === "wav") return "audio/wav";
  if (extension === "ogg" || extension === "oga") return "audio/ogg";
  if (extension === "webm") return "audio/webm";
  if (extension === "m4a" || extension === "mp4") return "audio/mp4";
  if (extension === "aac") return "audio/aac";
  return "";
}

export async function readSoundDurationMs(file: File, timeoutMs = 8000) {
  const url = URL.createObjectURL(file);
  try {
    return await new Promise<number>((resolve, reject) => {
      const audio = new Audio();
      let done = false;
      const finish = (value: number | Error) => {
        if (done) return;
        done = true;
        window.clearTimeout(timer);
        audio.removeAttribute("src");
        audio.load();
        if (value instanceof Error) reject(value);
        else resolve(value);
      };
      const timer = window.setTimeout(() => finish(new Error("Nao foi possivel ler a duracao do audio")), timeoutMs);
      audio.preload = "metadata";
      audio.addEventListener("loadedmetadata", () => {
        const duration = Number(audio.duration);
        if (!Number.isFinite(duration) || duration <= 0) return finish(new Error("Arquivo de audio sem duracao valida"));
        finish(Math.round(duration * 1000));
      }, { once: true });
      audio.addEventListener("error", () => finish(new Error("Arquivo de audio invalido ou nao suportado")), { once: true });
      audio.src = url;
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function formatSoundDuration(durationMs: number) {
  if (!durationMs || durationMs < 0) return "";
  const seconds = Math.max(1, Math.ceil(durationMs / 1000));
  return `${seconds}s`;
}

// Trilha efemera publicada no LiveKit para que os sons do Soundboard usem o
// mesmo caminho de audio da chamada. Isso evita depender de autoplay disparado
// por eventos Socket.IO nos clientes remotos.
export const SOUNDBOARD_TRACK_PREFIX = "ginga-soundboard:";

export function soundboardTrackName(soundId: string) {
  return `${SOUNDBOARD_TRACK_PREFIX}${soundId}:${Date.now().toString(36)}`;
}

export function isSoundboardTrackName(trackName: unknown, soundId?: string) {
  if (typeof trackName !== "string" || !trackName.startsWith(SOUNDBOARD_TRACK_PREFIX)) return false;
  return soundId ? trackName.startsWith(`${SOUNDBOARD_TRACK_PREFIX}${soundId}:`) : true;
}

const recentLocalSoundboardPublishes = new Map<string, number>();

export function soundboardIdFromTrackName(trackName: unknown) {
  if (typeof trackName !== "string" || !trackName.startsWith(SOUNDBOARD_TRACK_PREFIX)) return "";
  return trackName.slice(SOUNDBOARD_TRACK_PREFIX.length).split(":", 1)[0] || "";
}

export function hasRecentLocalSoundboardPublish(soundId: string) {
  const until = recentLocalSoundboardPublishes.get(soundId) ?? 0;
  if (until <= Date.now()) {
    recentLocalSoundboardPublishes.delete(soundId);
    return false;
  }
  return true;
}


let soundboardVoiceContext: AudioContext | null = null;

function getSoundboardVoiceContext() {
  if (typeof window === "undefined") return null;
  const Ctor = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  if (!soundboardVoiceContext || soundboardVoiceContext.state === "closed") soundboardVoiceContext = new Ctor();
  return soundboardVoiceContext;
}

export interface PublishSoundboardClipOptions {
  localVolume: number;
  outputVolume: number;
  outputDevice?: string;
}

export async function publishSoundboardClip(room: Room, sound: SoundboardSound, options: PublishSoundboardClipOptions) {
  if (room.state !== ConnectionState.Connected) throw new Error("A sala de voz ainda nao esta conectada");
  const context = getSoundboardVoiceContext();
  if (!context) throw new Error("Este navegador nao oferece Web Audio para o Soundboard");

  await context.resume();
  const sinkContext = context as AudioContext & { setSinkId?: (sinkId: string) => Promise<void> };
  if (options.outputDevice) await sinkContext.setSinkId?.(options.outputDevice).catch(() => undefined);

  const url = new URL(sound.url, window.location.href).href;
  const response = await fetch(url, { credentials: "same-origin", cache: "force-cache" });
  if (!response.ok) throw new Error(`Nao foi possivel carregar o som (${response.status})`);
  const bytes = await response.arrayBuffer();
  const buffer = await context.decodeAudioData(bytes.slice(0));
  const offsetSeconds = Math.max(0, Math.min(buffer.duration, Number(sound.trimStartMs || 0) / 1000));
  const requestedSeconds = Math.max(0.25, Math.min(12, Number(sound.durationMs || 12_000) / 1000));
  const durationSeconds = Math.min(requestedSeconds, Math.max(0.01, buffer.duration - offsetSeconds));

  const source = context.createBufferSource();
  const destination = context.createMediaStreamDestination();
  const publishGain = context.createGain();
  const localGain = context.createGain();
  source.buffer = buffer;
  publishGain.gain.value = 1;
  localGain.gain.value = Math.max(0, Math.min(2, (options.localVolume / 100) * (options.outputVolume / 100)));
  source.connect(publishGain);
  publishGain.connect(destination);
  source.connect(localGain);
  localGain.connect(context.destination);

  const mediaTrack = destination.stream.getAudioTracks()[0];
  if (!mediaTrack) throw new Error("Nao foi possivel criar a trilha do Soundboard");
  try { mediaTrack.contentHint = "music"; } catch {}

  const publication = await room.localParticipant.publishTrack(mediaTrack, {
    name: soundboardTrackName(sound.id),
    source: Track.Source.Unknown,
    dtx: false,
    red: true,
    forceStereo: true
  });
  recentLocalSoundboardPublishes.set(sound.id, Date.now() + Math.round(durationSeconds * 1000) + 2500);

  let cleaned = false;
  const cleanup = async () => {
    if (cleaned) return;
    cleaned = true;
    try { source.stop(); } catch {}
    try { source.disconnect(); } catch {}
    try { publishGain.disconnect(); } catch {}
    try { localGain.disconnect(); } catch {}
    try {
      if (publication.track) await room.localParticipant.unpublishTrack(publication.track, true);
      else await room.localParticipant.unpublishTrack(mediaTrack);
    } catch {}
    try { mediaTrack.stop(); } catch {}
  };

  source.addEventListener("ended", () => { void cleanup(); }, { once: true });
  // Pequena folga depois da publicacao da trilha para os assinantes remotos
  // receberem o track antes de o clip comecar.
  source.start(context.currentTime + 0.08, offsetSeconds, durationSeconds);
  window.setTimeout(() => { void cleanup(); }, Math.round((durationSeconds + 0.45) * 1000));
  return { durationMs: Math.round(durationSeconds * 1000), trackName: publication.trackName };
}
