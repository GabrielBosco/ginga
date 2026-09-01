import type { Attachment, User } from "../types";
import { installDirectCallExperience } from "./directCalls";
import { installGamingProfileExperience } from "./gamingProfile";
import { installGameOverlayRuntime } from "./gameOverlay";
import { gingaPrompt } from "./dialogs";

// Tooltips nativos preservados para acessibilidade e descoberta de acoes.
function normalizeUiText(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
}

function installSurfacePolishMarkers() {
  if (typeof window === "undefined" || typeof document === "undefined" || typeof MutationObserver === "undefined") return;

  const mark = () => {
    const roots = Array.from(document.querySelectorAll<HTMLElement>(".main-panel, .people-view"));
    for (const root of roots) {
      root.classList.remove("ginga-surface-friends", "ginga-surface-forum", "ginga-surface-events");
      if (root.matches(".people-view") || root.querySelector(".people-tabs, .friend-search, .person-card")) {
        root.classList.add("ginga-surface-friends");
        continue;
      }

      const headingText = normalizeUiText(Array.from(root.querySelectorAll("h1,h2,h3,.content-header strong,.channel-title strong,[role='heading']"))
        .slice(0, 16)
        .map((element) => element.textContent || "")
        .join(" | "));
      const controlText = normalizeUiText(Array.from(root.querySelectorAll("button,label,a"))
        .slice(0, 80)
        .map((element) => element.textContent || element.getAttribute("aria-label") || "")
        .join(" | "));

      const forumSignal = /(^|\W)forum($|\W)|topicos?|novo topico|criar topico|respostas?|tags?/.test(`${headingText} ${controlText}`);
      const eventSignal = /(^|\W)eventos?($|\W)|criar evento|novo evento|interessado|nao vou|exportar.*ics|rsvp/.test(`${headingText} ${controlText}`);
      if (forumSignal && !eventSignal) root.classList.add("ginga-surface-forum");
      if (eventSignal) root.classList.add("ginga-surface-events");
    }
  };

  let queued = false;
  const queueMark = () => {
    if (queued) return;
    queued = true;
    window.requestAnimationFrame(() => {
      queued = false;
      mark();
    });
  };

  const start = () => {
    mark();
    const observer = new MutationObserver(queueMark);
    observer.observe(document.documentElement, { subtree: true, childList: true, characterData: true });
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true });
  else start();
}

installSurfacePolishMarkers();


export const TOKEN_KEY = "ginga.token";
let sessionInvalidated = false;
const LEGACY_TOKEN_KEYS = ["nexora.token", "orbitchat.token"];

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public field?: string,
    public details?: unknown
  ) {
    super(message);
  }
}

type DesktopSessionBridge = {
  isDesktop?: boolean;
  readSessionToken?: () => string;
  writeSessionToken?: (token: string) => boolean;
};

function desktopBridge(): DesktopSessionBridge | null {
  return (window as unknown as { gingaDesktop?: DesktopSessionBridge }).gingaDesktop ?? null;
}

export function getToken(): string | null {
  const desktop = desktopBridge();
  if (desktop?.isDesktop && desktop.readSessionToken) {
    const secure = String(desktop.readSessionToken() || '').trim();
    if (secure) {
      localStorage.removeItem(TOKEN_KEY);
      for (const key of LEGACY_TOKEN_KEYS) localStorage.removeItem(key);
      return secure;
    }
  }

  const current = localStorage.getItem(TOKEN_KEY);
  if (current) {
    if (desktop?.isDesktop && desktop.writeSessionToken?.(current)) localStorage.removeItem(TOKEN_KEY);
    return current;
  }
  for (const key of LEGACY_TOKEN_KEYS) {
    const legacy = localStorage.getItem(key);
    if (!legacy) continue;
    if (desktop?.isDesktop && desktop.writeSessionToken?.(legacy)) localStorage.removeItem(TOKEN_KEY);
    else localStorage.setItem(TOKEN_KEY, legacy);
    for (const legacyKey of LEGACY_TOKEN_KEYS) localStorage.removeItem(legacyKey);
    return legacy;
  }
  return null;
}

export function setToken(token: string | null) {
  if (token) sessionInvalidated = false;
  const desktop = desktopBridge();
  if (desktop?.isDesktop && desktop.writeSessionToken) {
    const saved = desktop.writeSessionToken(token ?? '');
    if (saved) localStorage.removeItem(TOKEN_KEY);
    else if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } else if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
  for (const key of LEGACY_TOKEN_KEYS) localStorage.removeItem(key);
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("ginga:session-changed", { detail: { authenticated: Boolean(token) } }));
  }
}


function invalidateAuthenticatedSession() {
  if (sessionInvalidated) return;
  sessionInvalidated = true;
  setToken(null);
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("ginga:session-invalid", { detail: { reason: "unauthorized" } }));
  }
}

type RestoredRememberedSession = { token: string; user: User; remembered?: boolean };
let rememberRestorePromise: Promise<RestoredRememberedSession | null> | null = null;

export async function restoreRememberedSession(): Promise<RestoredRememberedSession | null> {
  if (rememberRestorePromise) return rememberRestorePromise;
  rememberRestorePromise = (async () => {
    try {
      const response = await fetch("/api/auth/session/restore", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Accept": "application/json" }
      });
      if (!response.ok) return null;
      const result = await response.json() as RestoredRememberedSession;
      if (!result?.token || !result?.user) return null;
      setToken(result.token);
      if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent("ginga:session-restored", { detail: result }));
      }
      return result;
    } catch {
      return null;
    } finally {
      rememberRestorePromise = null;
    }
  })();
  return rememberRestorePromise;
}

async function apiRequest<T>(path: string, init: RequestInit, allowRememberRestore: boolean): Promise<T> {
  const token = getToken();
  const headers = new Headers(init.headers);
  if (token) headers.set("Authorization", `Bearer ${token}`);
  if (init.body && !(init.body instanceof FormData) && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  let response: Response;
  try {
    response = await fetch(path, { ...init, headers, credentials: init.credentials ?? "same-origin" });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    throw new ApiError("Nao foi possivel conectar ao servidor. Verifique sua conexao e tente novamente.", 0);
  }
  const contentType = response.headers.get("content-type") ?? "";
  let body: any = null;
  if (contentType.includes("application/json")) {
    try { body = await response.json(); } catch { body = null; }
  }

  if (!response.ok) {
    const canRestore = response.status === 401
      && Boolean(token)
      && allowRememberRestore
      && !path.startsWith("/api/auth/login")
      && path !== "/api/auth/session/restore";
    if (canRestore) {
      const restored = await restoreRememberedSession();
      if (restored?.token && restored.token !== token) {
        return apiRequest<T>(path, init, false);
      }
    }
    if (response.status === 401 && token) invalidateAuthenticatedSession();
    const fallback = response.status >= 500
      ? "O servidor encontrou um problema. Tente novamente em alguns instantes."
      : response.status === 404
        ? "O recurso solicitado nao foi encontrado."
        : response.status === 403
          ? "Voce nao tem permissao para realizar esta acao."
          : response.status === 401
            ? "Sua sessao expirou ou nao e valida. Entre novamente."
            : `Nao foi possivel concluir a operacao (HTTP ${response.status}).`;
    throw new ApiError(body?.error ?? fallback, response.status, body?.field ?? body?.details?.field, body?.details);
  }

  return body as T;
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  return apiRequest<T>(path, init, true);
}

export async function uploadFile(file: File, onProgress?: (percent: number) => void): Promise<Attachment> {
  if (!onProgress || typeof XMLHttpRequest === "undefined") {
    const form = new FormData();
    form.append("file", file);
    const response = await api<{ attachment: Attachment }>("/api/uploads", { method: "POST", body: form });
    return response.attachment;
  }

  return await new Promise<Attachment>((resolve, reject) => {
    const form = new FormData();
    form.append("file", file);
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/uploads", true);
    const token = getToken();
    if (token) xhr.setRequestHeader("Authorization", `Bearer ${token}`);
    xhr.upload.addEventListener("progress", (event) => {
      if (!event.lengthComputable || event.total <= 0) return;
      onProgress(Math.max(0, Math.min(100, Math.round((event.loaded / event.total) * 100))));
    });
    xhr.addEventListener("load", () => {
      let body: { attachment?: Attachment; error?: string } | null = null;
      try { body = xhr.responseText ? JSON.parse(xhr.responseText) as { attachment?: Attachment; error?: string } : null; } catch { body = null; }
      if (xhr.status >= 200 && xhr.status < 300 && body?.attachment) {
        onProgress(100);
        resolve(body.attachment);
        return;
      }
      if (xhr.status === 401 && token) invalidateAuthenticatedSession();
      reject(new ApiError(body?.error ?? `Falha HTTP ${xhr.status || 0}`, xhr.status || 0));
    });
    xhr.addEventListener("error", () => reject(new ApiError("Falha de rede durante o upload", 0)));
    xhr.addEventListener("abort", () => reject(new ApiError("Upload cancelado", 0)));
    xhr.send(form);
  });
}

// Busca rapida, tooltips e chamadas agora sao controlados pelos componentes React.
// O estado visual de Developer/Admin agora e controlado pelo React em App.tsx.
// Evitamos mutar formularios, botoes e a arvore inteira via MutationObserver:
// isso causava duplicacao de helpers e layouts imprevisiveis no Developer Portal.

// Convites exibem um identificador amigável na UI. O endereço real copiado é
// escolhido pelas origens públicas configuradas na API, evitando vazar IP de LAN/CGNAT.
function installInviteExperience() {
  if (typeof window === "undefined" || typeof document === "undefined" || typeof MutationObserver === "undefined") return;

  const isPrivateHostname = (hostname: string) => {
    const host = hostname.replace(/^\[|\]$/g, "").toLowerCase();
    if (host === "localhost" || host === "::1" || host.endsWith(".local")) return true;
    if (/^127\./.test(host) || /^10\./.test(host) || /^192\.168\./.test(host) || /^169\.254\./.test(host)) return true;
    const v4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
    if (!v4) return false;
    const first = Number(v4[1]);
    const second = Number(v4[2]);
    if (first === 172 && second >= 16 && second <= 31) return true;
    if (first === 100 && second >= 64 && second <= 127) return true;
    return false;
  };

  let publicOriginPromise: Promise<string> | null = null;
  const publicOrigin = () => {
    if (publicOriginPromise) return publicOriginPromise;
    publicOriginPromise = api<{ appOrigins?: string[] }>("/api/system/network")
      .then(({ appOrigins = [] }) => {
        const candidates = appOrigins.flatMap((value) => {
          try { return [new URL(value)]; } catch { return []; }
        });
        const external = candidates
          .filter((url) => !isPrivateHostname(url.hostname))
          .sort((a, b) => Number(b.protocol === "https:") - Number(a.protocol === "https:"));
        return (external[0] ?? candidates[0] ?? new URL(window.location.origin)).origin;
      })
      .catch(() => window.location.origin);
    return publicOriginPromise;
  };

  const bindCopy = (row: HTMLElement, code: string) => {
    const button = row.querySelector<HTMLButtonElement>("button");
    if (!button || button.dataset.gingaInviteCopyBound === "true") return;
    button.dataset.gingaInviteCopyBound = "true";
    button.addEventListener("click", async (event) => {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      const origin = await publicOrigin();
      const link = `${origin}/invite/${encodeURIComponent(code)}`;
      try {
        await navigator.clipboard.writeText(link);
        button.dataset.copied = "true";
        button.setAttribute("aria-label", "Convite copiado");
        window.setTimeout(() => {
          delete button.dataset.copied;
          button.setAttribute("aria-label", "Copiar convite");
        }, 1500);
      } catch {
        void gingaPrompt("Copie o link abaixo:", link, { title: "Copiar convite", confirmLabel: "Fechar" });
      }
    }, true);
  };

  const polish = () => {
    document.documentElement.toggleAttribute("data-ginga-invite-landing", /^\/invite\//i.test(window.location.pathname));
    document.querySelectorAll<HTMLElement>(".invite-code-row code").forEach((element) => {
      const raw = String(element.dataset.gingaInviteOriginal || element.textContent || "").trim();
      if (!element.dataset.gingaInviteOriginal) element.dataset.gingaInviteOriginal = raw;
      const match = raw.match(/\/invite\/([^/?#\s]+)/i) ?? raw.match(/(?:^|\s)([A-Za-z0-9_-]{5,})(?:\s|$)/);
      const code = match?.[1];
      if (!code) return;
      const row = element.closest<HTMLElement>(".invite-code-row");
      if (!row) return;
      row.classList.add("ginga-friendly-invite");
      row.dataset.inviteCode = code;
      element.textContent = code;
      element.setAttribute("aria-label", `Código de convite ${code}`);
      bindCopy(row, code);
    });
  };

  let queued = false;
  const queue = () => {
    if (queued) return;
    queued = true;
    window.requestAnimationFrame(() => { queued = false; polish(); });
  };
  const start = () => {
    polish();
    const observer = new MutationObserver(queue);
    observer.observe(document.documentElement, { subtree: true, childList: true, characterData: true });
    window.addEventListener("popstate", queue);
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true });
  else start();
}

installInviteExperience();


// Comunicacao 1.5.5 + perfil, presenca e atividade de jogo da 1.5.4.
installGamingProfileExperience(api, () => Boolean(getToken()));
installGameOverlayRuntime();

// Historico e sincronizacao das chamadas privadas da 1.5.3.
installDirectCallExperience(api, () => Boolean(getToken()));
