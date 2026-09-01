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
