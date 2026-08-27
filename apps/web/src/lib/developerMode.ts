import { useEffect, useState } from "react";

export interface DeveloperPreferences {
  enabled: boolean;
}

const STORAGE_KEY = "ginga.developer.v1";
export const DEVELOPER_MODE_EVENT = "ginga:developer-mode-changed";

export function loadDeveloperPreferences(): DeveloperPreferences {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return { enabled: false };
    const parsed = JSON.parse(raw) as Partial<DeveloperPreferences>;
    return { enabled: parsed.enabled === true };
  } catch {
    return { enabled: false };
  }
}

export function isDeveloperModeEnabled(): boolean {
  return loadDeveloperPreferences().enabled;
}

export function saveDeveloperPreferences(preferences: DeveloperPreferences): void {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ enabled: preferences.enabled === true }));
  window.dispatchEvent(new CustomEvent(DEVELOPER_MODE_EVENT, { detail: { enabled: preferences.enabled === true } }));
}

export function builtinGuildRoleId(guildId: string, role: "OWNER" | "ADMIN" | "MODERATOR" | "MEMBER"): string {
  return `grole:${guildId}:${role.toLowerCase()}`;
}

export function useDeveloperMode(): boolean {
  const [enabled, setEnabled] = useState(() => loadDeveloperPreferences().enabled);
  useEffect(() => {
    const sync = () => setEnabled(loadDeveloperPreferences().enabled);
    window.addEventListener(DEVELOPER_MODE_EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(DEVELOPER_MODE_EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);
  return enabled;
}
