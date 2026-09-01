import { Track, type AudioProcessorOptions, type Room, type TrackProcessor } from "livekit-client";

export type StreamQuality = "480p" | "720p" | "1080p";
export type InputMode = "voice" | "ptt";
export type StreamFps = 15 | 30 | 60;

export interface VoicePreferences {
  microphoneDevice: string;
  outputDevice: string;
  cameraDevice: string;
  outputVolume: number;
  microphoneSensitivity: number;
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
  mediaPermissions?: { canShareScreen: boolean; canUseVideo: boolean };
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
  microphoneSensitivity: "ginga.voice.microphoneSensitivity",
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
    microphoneSensitivity: boundedNumber(read(KEYS.microphoneSensitivity), 50, 0, 100),
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
    localStorage.setItem(KEYS.microphoneSensitivity, String(next.microphoneSensitivity));
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


export function microphoneSensitivityGain(value: number) {
  const sensitivity = Math.max(0, Math.min(100, Number.isFinite(value) ? value : 50));
  // 50% preserva o volume original. A curva acima de 50 privilegia vozes
  // mais baixas sem transformar o controle em um boost agressivo demais.
  if (sensitivity <= 50) return 0.6 + (sensitivity / 50) * 0.4;
  return 1 + ((sensitivity - 50) / 50) * 1.4;
}

class MicrophoneSensitivityProcessor implements TrackProcessor<Track.Kind.Audio, AudioProcessorOptions> {
  readonly name = "ginga-microphone-sensitivity";
  processedTrack?: MediaStreamTrack;
  private input?: MediaStreamAudioSourceNode;
  private gainNode?: GainNode;
  private destination?: MediaStreamAudioDestinationNode;
  private sensitivity = 50;

  constructor(sensitivity: number) {
    this.sensitivity = sensitivity;
  }

  setSensitivity(sensitivity: number) {
    this.sensitivity = Math.max(0, Math.min(100, Math.round(sensitivity)));
    if (this.gainNode) this.gainNode.gain.value = microphoneSensitivityGain(this.sensitivity);
  }

  private releaseGraph() {
    try { this.input?.disconnect(); } catch {}
    try { this.gainNode?.disconnect(); } catch {}
    try { this.processedTrack?.stop(); } catch {}
    this.input = undefined;
    this.gainNode = undefined;
    this.destination = undefined;
    this.processedTrack = undefined;
  }

  async init(options: AudioProcessorOptions) {
    this.releaseGraph();
    const stream = new MediaStream([options.track]);
    this.input = options.audioContext.createMediaStreamSource(stream);
    this.gainNode = options.audioContext.createGain();
    this.destination = options.audioContext.createMediaStreamDestination();
    this.gainNode.gain.value = microphoneSensitivityGain(this.sensitivity);
    this.input.connect(this.gainNode);
    this.gainNode.connect(this.destination);
    this.processedTrack = this.destination.stream.getAudioTracks()[0];
    if (!this.processedTrack) throw new Error("Nao foi possivel aplicar a sensibilidade do microfone.");
  }

  async restart(options: AudioProcessorOptions) {
    await this.init(options);
  }

  async destroy() {
    this.releaseGraph();
  }
}

export async function applyMicrophoneSensitivity(room: Room | undefined, sensitivity: number) {
  if (!room || !room.localParticipant.isMicrophoneEnabled) return false;
  const publication = room.localParticipant.getTrackPublication(Track.Source.Microphone);
  const audioTrack = publication?.audioTrack;
  if (!audioTrack) return false;
  const existing = audioTrack.getProcessor();
  if (existing instanceof MicrophoneSensitivityProcessor) {
    existing.setSensitivity(sensitivity);
    return true;
  }
  // Nao substitui um processador externo que outra funcao do Ginga possa usar.
  if (existing) return false;
  await audioTrack.setProcessor(new MicrophoneSensitivityProcessor(sensitivity));
  return true;
}
