export type ThemePreference = "dark" | "midnight" | "light";
export type DensityPreference = "comfortable" | "compact";

export interface AppearancePreferences {
  theme: ThemePreference;
  density: DensityPreference;
  fontScale: 90 | 100 | 110 | 120 | 130 | 140;
  reducedMotion: boolean;
}

const APPEARANCE_STORAGE_KEY = "ginga.appearance.v2";
const LEGACY_APPEARANCE_STORAGE_KEYS = ["ginga.appearance.v1", "nexora.appearance.v1"];

export const defaultAppearancePreferences: AppearancePreferences = {
  theme: "dark",
  density: "comfortable",
  fontScale: 100,
  reducedMotion: false
};

function readStoredValue(primaryKey: string, legacyKeys: string[]) {
  const direct = window.localStorage.getItem(primaryKey);
  if (direct) return direct;
  for (const key of legacyKeys) {
    const legacy = window.localStorage.getItem(key);
    if (!legacy) continue;
    window.localStorage.setItem(primaryKey, legacy);
    return legacy;
  }
  return null;
}

export function loadAppearancePreferences(): AppearancePreferences {
  try {
    const raw = readStoredValue(APPEARANCE_STORAGE_KEY, LEGACY_APPEARANCE_STORAGE_KEYS);
    if (!raw) return defaultAppearancePreferences;
    const parsed = JSON.parse(raw) as Partial<AppearancePreferences>;
    return {
      theme: parsed.theme === "midnight" || parsed.theme === "light" ? parsed.theme : "dark",
      density: parsed.density === "compact" ? "compact" : "comfortable",
      fontScale: [90,100,110,120,130,140].includes(Number(parsed.fontScale)) ? Number(parsed.fontScale) as AppearancePreferences["fontScale"] : 100,
      reducedMotion: Boolean(parsed.reducedMotion)
    };
  } catch {
    return defaultAppearancePreferences;
  }
}

export function applyAppearancePreferences(preferences: AppearancePreferences) {
  const root = document.documentElement;
  root.dataset.theme = preferences.theme;
  root.dataset.density = preferences.density;
  root.dataset.reducedMotion = preferences.reducedMotion ? "true" : "false";
  const scale = preferences.fontScale / 100;
  root.style.setProperty("--ui-font-scale", `${scale}`);
  root.style.setProperty("--ginga-fs-micro", `${(11 * scale).toFixed(2)}px`);
  root.style.setProperty("--ginga-fs-caption", `${(11.5 * scale).toFixed(2)}px`);
  root.style.setProperty("--ginga-fs-small", `${(12.5 * scale).toFixed(2)}px`);
  root.style.setProperty("--ginga-fs-ui", `${(13.5 * scale).toFixed(2)}px`);
  root.style.setProperty("--ginga-fs-body", `${(15 * scale).toFixed(2)}px`);
  root.style.setProperty("--ginga-fs-title", `${(15.5 * scale).toFixed(2)}px`);
  root.style.setProperty("--ginga-fs-heading", `${(23 * scale).toFixed(2)}px`);
}

export function saveAppearancePreferences(preferences: AppearancePreferences) {
  window.localStorage.setItem(APPEARANCE_STORAGE_KEY, JSON.stringify(preferences));
  applyAppearancePreferences(preferences);
}

export interface NotificationPreferences {
  desktopMessages: boolean;
  desktopChannelMessages: boolean;
  desktopMentions: boolean;
  desktopEveryoneMentions: boolean;
  desktopCalls: boolean;
  showPreview: boolean;
  playSound: boolean;
  soundMessages: boolean;
  soundMentions: boolean;
  soundCalls: boolean;
  soundVoiceEvents: boolean;
}

const NOTIFICATION_STORAGE_KEY = "ginga.notifications.v2";
const LEGACY_NOTIFICATION_STORAGE_KEYS = ["ginga.notifications.v1", "nexora.notifications.v1"];

export const defaultNotificationPreferences: NotificationPreferences = {
  desktopMessages: true,
  desktopChannelMessages: true,
  desktopMentions: true,
  desktopEveryoneMentions: true,
  desktopCalls: true,
  showPreview: true,
  playSound: true,
  soundMessages: true,
  soundMentions: true,
  soundCalls: true,
  soundVoiceEvents: true
};

export function loadNotificationPreferences(): NotificationPreferences {
  try {
    const raw = readStoredValue(NOTIFICATION_STORAGE_KEY, LEGACY_NOTIFICATION_STORAGE_KEYS);
    if (!raw) return defaultNotificationPreferences;
    const parsed = JSON.parse(raw) as Partial<NotificationPreferences>;
    return {
      desktopMessages: parsed.desktopMessages !== false,
      desktopChannelMessages: parsed.desktopChannelMessages !== false,
      desktopMentions: parsed.desktopMentions !== false,
      desktopEveryoneMentions: parsed.desktopEveryoneMentions !== false,
      desktopCalls: parsed.desktopCalls !== false,
      showPreview: parsed.showPreview !== false,
      playSound: parsed.playSound !== false,
      soundMessages: parsed.soundMessages !== false,
      soundMentions: parsed.soundMentions !== false,
      soundCalls: parsed.soundCalls !== false,
      soundVoiceEvents: parsed.soundVoiceEvents !== false
    };
  } catch {
    return defaultNotificationPreferences;
  }
}

export function saveNotificationPreferences(preferences: NotificationPreferences) {
  window.localStorage.setItem(NOTIFICATION_STORAGE_KEY, JSON.stringify(preferences));
}
