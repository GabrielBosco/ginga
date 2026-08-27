import { useEffect, useState } from "react";
import { api } from "./api";

const cache = new Map<string, string | null>();
const listeners = new Map<string, Set<(value: string | null) => void>>();
const queued = new Set<string>();
let flushTimer: number | null = null;

function publish(userId: string, value: string | null) {
  cache.set(userId, value);
  listeners.get(userId)?.forEach((listener) => listener(value));
}

async function flush() {
  flushTimer = null;
  const ids = Array.from(queued).slice(0, 100);
  ids.forEach((id) => queued.delete(id));
  if (!ids.length) return;
  try {
    const result = await api<{ avatars: Record<string, string | null> }>(`/api/gaming-profile/avatars?ids=${encodeURIComponent(ids.join(","))}`);
    ids.forEach((id) => publish(id, result.avatars[id] ?? null));
  } catch {
    // Avatar e decorativo: falha de rede nunca deve derrubar a interface.
    ids.forEach((id) => { if (!cache.has(id)) publish(id, null); });
  }
  if (queued.size && flushTimer === null) flushTimer = window.setTimeout(() => void flush(), 20);
}

function queue(userId: string) {
  if (!userId || cache.has(userId)) return;
  queued.add(userId);
  if (flushTimer === null) flushTimer = window.setTimeout(() => void flush(), 20);
}

export function setCachedUserAvatar(userId: string, avatarUrl: string | null) {
  if (!userId) return;
  publish(userId, avatarUrl);
}

export function useUserAvatar(userId?: string, explicitUrl?: string | null) {
  const [value, setValue] = useState<string | null>(() => explicitUrl ?? (userId ? cache.get(userId) ?? null : null));

  useEffect(() => {
    if (explicitUrl !== undefined) {
      setValue(explicitUrl ?? null);
      if (userId) publish(userId, explicitUrl ?? null);
      return;
    }
    if (!userId) { setValue(null); return; }
    const existing = cache.get(userId);
    if (existing !== undefined) setValue(existing);
    let userListeners = listeners.get(userId);
    if (!userListeners) { userListeners = new Set(); listeners.set(userId, userListeners); }
    userListeners.add(setValue);
    queue(userId);
    return () => {
      userListeners?.delete(setValue);
      if (userListeners?.size === 0) listeners.delete(userId);
    };
  }, [explicitUrl, userId]);

  return value;
}

if (typeof window !== "undefined") {
  window.addEventListener("ginga:profile-local-update", ((event: Event) => {
    const detail = (event as CustomEvent<{ user?: { id?: string }; userId?: string; avatarUrl?: string | null }>).detail;
    const userId = detail?.userId ?? detail?.user?.id;
    if (userId && Object.prototype.hasOwnProperty.call(detail ?? {}, "avatarUrl")) setCachedUserAvatar(userId, detail?.avatarUrl ?? null);
  }) as EventListener);
}
