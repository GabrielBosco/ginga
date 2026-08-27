import { loadNotificationPreferences } from "./preferences";

export type UiSound = "join" | "leave" | "ring" | "notification" | "message" | "success";

let audioContext: AudioContext | null = null;
let ringingTimer: number | null = null;

function context(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const AudioContextCtor = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioContextCtor) return null;
  if (!audioContext) audioContext = new AudioContextCtor();
  return audioContext;
}

async function ensureContext(): Promise<AudioContext | null> {
  const ctx = context();
  if (!ctx) return null;
  if (ctx.state === "suspended") {
    try { await ctx.resume(); } catch { return null; }
  }
  return ctx;
}

function tone(ctx: AudioContext, when: number, frequency: number, duration: number, gainValue = 0.045, type: OscillatorType = "sine") {
  const oscillator = ctx.createOscillator();
  const gain = ctx.createGain();
  oscillator.type = type;
  oscillator.frequency.setValueAtTime(frequency, when);
  gain.gain.setValueAtTime(0.0001, when);
  gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, gainValue), when + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001, when + duration);
  oscillator.connect(gain);
  gain.connect(ctx.destination);
  oscillator.start(when);
  oscillator.stop(when + duration + 0.025);
}

export async function unlockUiAudio() {
  await ensureContext();
}

export async function playUiSound(kind: UiSound) {
  const preferences = loadNotificationPreferences();
  if (!preferences.playSound) return;
  if (kind === "message" && !preferences.soundMessages) return;
  if (kind === "notification" && !preferences.soundMentions) return;
  if (kind === "ring" && !preferences.soundCalls) return;
  if ((kind === "join" || kind === "leave") && !preferences.soundVoiceEvents) return;
  const ctx = await ensureContext();
  if (!ctx) return;
  const now = ctx.currentTime + 0.012;

  switch (kind) {
    case "join":
      tone(ctx, now, 440, 0.11, 0.045, "sine");
      tone(ctx, now + 0.095, 660, 0.15, 0.052, "sine");
      break;
    case "leave":
      tone(ctx, now, 620, 0.10, 0.04, "sine");
      tone(ctx, now + 0.085, 390, 0.15, 0.046, "sine");
      break;
    case "ring":
      tone(ctx, now, 520, 0.18, 0.05, "triangle");
      tone(ctx, now + 0.19, 780, 0.22, 0.052, "triangle");
      break;
    case "notification":
      tone(ctx, now, 740, 0.10, 0.043, "sine");
      tone(ctx, now + 0.075, 980, 0.12, 0.047, "sine");
      break;
    case "success":
      tone(ctx, now, 540, 0.08, 0.035, "sine");
      tone(ctx, now + 0.065, 810, 0.11, 0.04, "sine");
      break;
    case "message":
    default:
      tone(ctx, now, 680, 0.085, 0.032, "sine");
      break;
  }
}

export function startRinging() {
  stopRinging();
  if (!loadNotificationPreferences().playSound) return;
  void playUiSound("ring");
  ringingTimer = window.setInterval(() => void playUiSound("ring"), 1800);
}

export function stopRinging() {
  if (ringingTimer !== null) {
    window.clearInterval(ringingTimer);
    ringingTimer = null;
  }
}
