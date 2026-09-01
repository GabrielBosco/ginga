import { formatPushToTalkBinding } from "./pushToTalkBinding";
import { loadVoicePreferences } from "./voicePreferences";

export type GameOverlayPosition = "top-left" | "top-right" | "bottom-left" | "bottom-right";

export interface GameOverlayPreferences {
  enabled: boolean;
  showGame: boolean;
  showVoice: boolean;
  showOnlyInVoice: boolean;
  position: GameOverlayPosition;
  opacity: number;
}

export interface DesktopDetectedGame {
  supported?: boolean;
  activity?: { name?: string; detectedAt?: string; focused?: boolean; windowDetected?: boolean } | null;
  error?: string;
}

export interface GameOverlayRuntimeStatus {
  supported: boolean;
  enabled: boolean;
  visible: boolean;
  shortcutRegistered: boolean;
  reason: "ready" | "unsupported_platform" | "disabled" | "game_not_detected" | "game_not_focused" | "manual_hidden" | "voice_required" | string;
  detectedGame?: DesktopDetectedGame["activity"];
}

type OverlayParticipant = {
  identity: string;
  name: string;
  speaking: boolean;
  microphoneEnabled: boolean;
  deafened: boolean;
  cameraEnabled: boolean;
  screenShareEnabled: boolean;
  avatarUrl: string | null;
  local: boolean;
};

type OverlayRuntimeState = {
  voice: {
    connected: boolean;
    channelId: string;
    channelName: string;
    deafened: boolean;
    muted: boolean;
    inputMode: "voice" | "ptt";
    pushToTalkLabel: string;
    participants: OverlayParticipant[];
  } | null;
};

type DesktopOverlayBridge = {
  isDesktop?: boolean;
  detectGameActivity?: () => Promise<DesktopDetectedGame>;
  getGameOverlaySettings?: () => Promise<GameOverlayPreferences>;
  setGameOverlaySettings?: (settings: GameOverlayPreferences) => Promise<GameOverlayPreferences>;
  updateGameOverlayState?: (state: OverlayRuntimeState) => Promise<boolean>;
  previewGameOverlay?: () => Promise<boolean>;
  getGameOverlayStatus?: () => Promise<GameOverlayRuntimeStatus>;
};

const STORAGE_KEY = "ginga.gameOverlay.preferences.v1";
const DEFAULTS: GameOverlayPreferences = {
  enabled: true,
  showGame: true,
  showVoice: true,
  showOnlyInVoice: false,
  position: "top-right",
  opacity: 0.92
};

function bridge(): DesktopOverlayBridge | null {
  if (typeof window === "undefined") return null;
  return (window as unknown as { gingaDesktop?: DesktopOverlayBridge }).gingaDesktop ?? null;
}

function normalize(input: Partial<GameOverlayPreferences> | null | undefined): GameOverlayPreferences {
  const position = input?.position;
  return {
    enabled: input?.enabled !== false,
    showGame: input?.showGame !== false,
    showVoice: input?.showVoice !== false,
    showOnlyInVoice: Boolean(input?.showOnlyInVoice),
    position: position === "top-left" || position === "bottom-left" || position === "bottom-right" ? position : "top-right",
    opacity: Math.max(0.55, Math.min(1, Number(input?.opacity) || DEFAULTS.opacity))
  };
}

export function isGameOverlayAvailable() {
  const desktop = bridge();
  return Boolean(desktop?.isDesktop && desktop.setGameOverlaySettings && desktop.updateGameOverlayState && desktop.previewGameOverlay);
}

export function loadGameOverlayPreferences(): GameOverlayPreferences {
  try {
    return normalize(JSON.parse(localStorage.getItem(STORAGE_KEY) || "null"));
  } catch {
    return { ...DEFAULTS };
  }
}

export async function saveGameOverlayPreferences(next: GameOverlayPreferences) {
  const value = normalize(next);
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(value)); } catch {}
  try { await bridge()?.setGameOverlaySettings?.(value); } catch {}
  window.dispatchEvent(new CustomEvent("ginga:game-overlay-preferences", { detail: value }));
  return value;
}

export async function detectDesktopGame() {
  return bridge()?.detectGameActivity?.() ?? { supported: false, activity: null };
}

export async function previewGameOverlay() {
  return Boolean(await bridge()?.previewGameOverlay?.());
}

export async function getGameOverlayStatus(): Promise<GameOverlayRuntimeStatus | null> {
  return await bridge()?.getGameOverlayStatus?.() ?? null;
}

function voiceSnapshot(): OverlayRuntimeState["voice"] {
  const session = window.__gingaVoiceSession;
  if (!session?.room) return null;
  const room = session.room;
  const preferences = loadVoicePreferences();
  const local = room.localParticipant;
  const participants: OverlayParticipant[] = [{
    identity: String(local.identity || "local"),
    name: String(local.name || "Você"),
    speaking: Boolean(local.isSpeaking),
    microphoneEnabled: Boolean(local.isMicrophoneEnabled),
    deafened: Boolean(session.deafened || session.serverDeafened),
    cameraEnabled: Boolean(local.isCameraEnabled),
    screenShareEnabled: Boolean(local.isScreenShareEnabled),
    avatarUrl: null,
    local: true
  }];
  room.remoteParticipants.forEach((participant) => {
    participants.push({
      identity: String(participant.identity || participant.sid || "remote"),
      name: String(participant.name || participant.identity || "Participante"),
      speaking: Boolean(participant.isSpeaking),
      microphoneEnabled: Boolean(participant.isMicrophoneEnabled),
      deafened: false,
      cameraEnabled: Boolean(participant.isCameraEnabled),
      screenShareEnabled: Boolean(participant.isScreenShareEnabled),
      avatarUrl: null,
      local: false
    });
  });
  participants.sort((a, b) => Number(b.speaking) - Number(a.speaking) || Number(b.local) - Number(a.local) || a.name.localeCompare(b.name, "pt-BR"));
  return {
    connected: true,
    channelId: session.channelId,
    channelName: session.channelName || "Canal de voz",
    deafened: Boolean(session.deafened || session.serverDeafened),
    muted: !local.isMicrophoneEnabled || Boolean(session.serverMuted || session.serverDeafened),
    inputMode: preferences.inputMode,
    pushToTalkLabel: formatPushToTalkBinding(preferences.pushToTalkKey),
    participants: participants.slice(0, 12)
  };
}

export function installGameOverlayRuntime() {
  if (typeof window === "undefined" || !bridge()?.isDesktop || !bridge()?.updateGameOverlayState) return;
  const lifecycle = window as typeof window & { __gingaGameOverlayRuntimeInstalled?: boolean };
  if (lifecycle.__gingaGameOverlayRuntimeInstalled) return;
  lifecycle.__gingaGameOverlayRuntimeInstalled = true;

  void bridge()?.setGameOverlaySettings?.(loadGameOverlayPreferences());

  let lastFingerprint = "";
  let disposed = false;
  const push = () => {
    if (disposed) return;
    const state: OverlayRuntimeState = { voice: voiceSnapshot() };
    const fingerprint = JSON.stringify(state);
    if (fingerprint === lastFingerprint) return;
    lastFingerprint = fingerprint;
    void bridge()?.updateGameOverlayState?.(state).catch(() => {});
  };

  const timer = window.setInterval(push, 500);
  const events = [
    "ginga:voice-local-mic-state",
    "ginga:voice-presence-changed",
    "ginga:voice-preferences-changed",
    "ginga:voice-session-changed"
  ];
  events.forEach((name) => window.addEventListener(name, push as EventListener));
  push();

  window.addEventListener("beforeunload", () => {
    disposed = true;
    window.clearInterval(timer);
    events.forEach((name) => window.removeEventListener(name, push as EventListener));
  }, { once: true });
}
