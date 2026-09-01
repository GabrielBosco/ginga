export type PersistedUnreadState = {
  channels: Record<string, number>;
  direct: Record<string, number>;
  mentions: string[];
};

const UNREAD_STATE_KEY_PREFIX = "ginga.unread.v2:";

function cleanCounts(value: unknown): Record<string, number> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).flatMap(([id, raw]) => {
    const count = Math.max(0, Math.min(99, Number(raw) || 0));
    return id && count ? [[id, count]] : [];
  }));
}

export function loadPersistedUnreadState(userId: string): PersistedUnreadState {
  const empty: PersistedUnreadState = { channels: {}, direct: {}, mentions: [] };
  try {
    const parsed = JSON.parse(localStorage.getItem(`${UNREAD_STATE_KEY_PREFIX}${userId}`) || "null") as Partial<PersistedUnreadState> | null;
    if (!parsed || typeof parsed !== "object") return empty;
    return {
      channels: cleanCounts(parsed.channels),
      direct: cleanCounts(parsed.direct),
      mentions: Array.isArray(parsed.mentions)
        ? parsed.mentions.filter((id): id is string => typeof id === "string" && Boolean(id)).slice(0, 500)
        : []
    };
  } catch {
    return empty;
  }
}

export function savePersistedUnreadState(userId: string, state: PersistedUnreadState) {
  try {
    localStorage.setItem(`${UNREAD_STATE_KEY_PREFIX}${userId}`, JSON.stringify(state));
  } catch {
    // Sem localStorage, os contadores continuam validos somente nesta sessao.
  }
}
