export interface SystemNotificationOptions {
  title: string;
  body: string;
  silent?: boolean;
  durationMs?: number;
  unreadCount?: number;
  taskbarBadge?: boolean;
  flashTaskbar?: boolean;
}

interface GingaDesktopBridge {
  isDesktop?: boolean;
  notify?: (payload: SystemNotificationOptions) => Promise<boolean>;
  showMainWindow?: () => Promise<boolean>;
  setTaskbarBadge?: (count: number) => Promise<number>;
  clearTaskbarBadge?: () => Promise<number>;
}

function desktopBridge(): GingaDesktopBridge | undefined {
  return (window as unknown as { gingaDesktop?: GingaDesktopBridge }).gingaDesktop;
}

export function isGingaDesktop() {
  return Boolean(desktopBridge()?.isDesktop);
}

export async function setDesktopUnreadCount(count: number, flash = false) {
  const bridge = desktopBridge();
  if (!bridge?.setTaskbarBadge) return false;
  try {
    await bridge.setTaskbarBadge(Math.max(0, Math.min(999, Math.floor(Number(count) || 0))));
    if (!flash || count <= 0) return true;
    return true;
  } catch {
    return false;
  }
}

export async function clearDesktopUnreadCount() {
  const bridge = desktopBridge();
  if (!bridge?.clearTaskbarBadge) return false;
  try {
    await bridge.clearTaskbarBadge();
    return true;
  } catch {
    return false;
  }
}

export async function showSystemNotification(options: SystemNotificationOptions) {
  const payload = {
    title: options.title.slice(0, 90),
    body: options.body.replace(/\s+/g, " ").trim().slice(0, 220),
    silent: Boolean(options.silent),
    durationMs: Math.max(2500, Math.min(15_000, options.durationMs ?? 5000)),
    unreadCount: typeof options.unreadCount === "number" ? Math.max(0, Math.min(999, Math.floor(options.unreadCount))) : undefined,
    taskbarBadge: options.taskbarBadge !== false,
    flashTaskbar: options.flashTaskbar !== false
  };

  const bridge = desktopBridge();
  if (bridge?.notify) {
    try {
      return await bridge.notify(payload);
    } catch {
      // Cai para a API Web Notification quando o bridge nao responder.
    }
  }

  if (!("Notification" in window) || Notification.permission !== "granted") return false;
  const notification = new Notification(payload.title, {
    body: payload.body,
    icon: "/favicon.svg",
    silent: payload.silent
  });
  window.setTimeout(() => notification.close(), payload.durationMs);
  return true;
}

export async function ensureNotificationPermission() {
  if (isGingaDesktop()) return "granted" as NotificationPermission;
  if (!("Notification" in window)) return "denied" as NotificationPermission;
  if (Notification.permission === "granted") return "granted";
  return Notification.requestPermission();
}
