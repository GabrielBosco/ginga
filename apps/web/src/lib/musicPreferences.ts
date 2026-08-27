export interface MusicUserPreferences {
  volume: number;
  muted: boolean;
}

export const MUSIC_PREFERENCES_EVENT = "ginga:music-user-preferences";

function clampVolume(value: number) {
  if (!Number.isFinite(value)) return 70;
  return Math.max(0, Math.min(100, Math.round(value)));
}

function storageKey(userId: string, guildId: string) {
  return `ginga.music.preferences.${userId}.${guildId}`;
}

export function loadMusicUserPreferences(userId: string, guildId: string, defaultVolume = 70): MusicUserPreferences {
  const fallback: MusicUserPreferences = { volume: clampVolume(defaultVolume), muted: false };
  if (!userId || !guildId) return fallback;
  try {
    const raw = localStorage.getItem(storageKey(userId, guildId));
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Partial<MusicUserPreferences>;
    return {
      volume: clampVolume(typeof parsed.volume === "number" ? parsed.volume : fallback.volume),
      muted: Boolean(parsed.muted)
    };
  } catch {
    return fallback;
  }
}

export function saveMusicUserPreferences(
  userId: string,
  guildId: string,
  next: Partial<MusicUserPreferences>,
  defaultVolume = 70
): MusicUserPreferences {
  const current = loadMusicUserPreferences(userId, guildId, defaultVolume);
  const preferences: MusicUserPreferences = {
    volume: clampVolume(next.volume ?? current.volume),
    muted: next.muted ?? current.muted
  };
  if (userId && guildId) {
    try { localStorage.setItem(storageKey(userId, guildId), JSON.stringify(preferences)); } catch { /* Preferencia local opcional. */ }
    window.dispatchEvent(new CustomEvent(MUSIC_PREFERENCES_EVENT, { detail: { userId, guildId, preferences } }));
  }
  return preferences;
}
