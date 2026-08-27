import type { Room } from "livekit-client";

export type StreamQuality = "480p" | "720p" | "1080p";
export type InputMode = "voice" | "ptt";
export type StreamFps = 15 | 30 | 60;

export interface VoicePreferences {
  microphoneDevice: string;
  outputDevice: string;
  cameraDevice: string;
  outputVolume: number;
  noiseSuppression: boolean;
  inputMode: InputMode;
  pushToTalkKey: string;
  quality: StreamQuality;
  streamFps: StreamFps;
}

export type PersistedVoiceSession = {
  channelId: string;
  channelName?: string;
  room: Room;
  presenceJoined: boolean;
  reconnectListener?: () => void;
  deafened?: boolean;
  serverMuted?: boolean;
  serverDeafened?: boolean;
  desiredMicEnabled?: boolean;
  recovering?: boolean;
};

declare global {
  interface Window {
    __gingaVoiceSession?: PersistedVoiceSession;
  }
}

const KEYS = {
  microphoneDevice: "ginga.voice.microphoneDevice",
  outputDevice: "ginga.voice.outputDevice",
  cameraDevice: "ginga.voice.cameraDevice",
  outputVolume: "ginga.voice.outputVolume",
  noiseSuppression: "ginga.voice.noiseSuppression",
  inputMode: "ginga.voice.inputMode",
  pushToTalkKey: "ginga.voice.pushToTalkKey",
  quality: "ginga.voice.streamQuality",
  streamFps: "ginga.voice.streamFps"
} as const;

function read(key: string) {
  try { return localStorage.getItem(key) ?? ""; } catch { return ""; }
}

function boundedNumber(value: string, fallback: number, min: number, max: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(min, Math.min(max, parsed)) : fallback;
}

export function loadVoicePreferences(): VoicePreferences {
  const quality = read(KEYS.quality);
  const inputMode = read(KEYS.inputMode);
  const fps = boundedNumber(read(KEYS.streamFps), 30, 15, 60);
  return {
    microphoneDevice: read(KEYS.microphoneDevice),
    outputDevice: read(KEYS.outputDevice),
    cameraDevice: read(KEYS.cameraDevice),
    outputVolume: boundedNumber(read(KEYS.outputVolume), 100, 0, 200),
    noiseSuppression: read(KEYS.noiseSuppression) !== "false",
    inputMode: inputMode === "ptt" ? "ptt" : "voice",
    pushToTalkKey: read(KEYS.pushToTalkKey) || "KeyV",
    quality: quality === "480p" || quality === "1080p" ? quality : "720p",
    streamFps: fps >= 60 ? 60 : fps >= 30 ? 30 : 15
  };
}

export function saveVoicePreferences(next: VoicePreferences) {
  try {
    localStorage.setItem(KEYS.microphoneDevice, next.microphoneDevice);
    localStorage.setItem(KEYS.outputDevice, next.outputDevice);
    localStorage.setItem(KEYS.cameraDevice, next.cameraDevice);
    localStorage.setItem(KEYS.outputVolume, String(next.outputVolume));
    localStorage.setItem(KEYS.noiseSuppression, String(next.noiseSuppression));
    localStorage.setItem(KEYS.inputMode, next.inputMode);
    localStorage.setItem(KEYS.pushToTalkKey, next.pushToTalkKey);
    localStorage.setItem(KEYS.quality, next.quality);
    localStorage.setItem(KEYS.streamFps, String(next.streamFps));
  } catch {
    // Preferencias locais nao devem impedir o uso da call.
  }
  window.dispatchEvent(new CustomEvent("ginga:voice-preferences-changed", { detail: next }));
}

export async function applyVoiceDevice(kind: MediaDeviceKind, deviceId: string) {
  if (!deviceId || !window.__gingaVoiceSession?.room) return false;
  const room = window.__gingaVoiceSession.room as Room & {
    switchActiveDevice: (kind: MediaDeviceKind, deviceId: string) => Promise<boolean>;
  };
  return room.switchActiveDevice(kind, deviceId);
}
