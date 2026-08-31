export type PresenceMode = "ONLINE" | "AWAY" | "BUSY" | "OFFLINE";
type GameSource = "NONE" | "MANUAL" | "DESKTOP";

type PublicGamingProfile = {
  user: { id: string; username: string; displayName: string; avatarColor: string };
  avatarUrl: string | null;
  bio: string | null;
  customStatus: string | null;
  presence: PresenceMode;
  activity: { type: "PLAYING"; name: string; details: string; startedAt: string | null } | null;
  updatedAt: string;
};

type OwnGamingProfile = PublicGamingProfile & {
  settings: {
    presenceMode: PresenceMode;
    autoAway: boolean;
    showGameActivity: boolean;
    autoDetectGame: boolean;
    gameName: string | null;
    gameDetails: string | null;
    gameSource: GameSource;
    idle: boolean;
    avatarAttachmentId: string | null;
  };
};

type ApiRequest = <T>(path: string, init?: RequestInit) => Promise<T>;
type HasSession = () => boolean;

let quickPresenceUpdater: ((mode: PresenceMode) => Promise<PresenceMode>) | null = null;

export async function setOwnPresenceMode(mode: PresenceMode): Promise<PresenceMode> {
  if (!quickPresenceUpdater) throw new Error("Controle de presenca ainda nao esta pronto");
  return quickPresenceUpdater(mode);
}

type DesktopGameBridge = {
  isDesktop?: boolean;
  detectGameActivity?: () => Promise<{ supported?: boolean; activity?: { name?: string; detectedAt?: string } | null; error?: string }>;
};

const HEARTBEAT_MS = 30_000;
const PROFILE_REFRESH_MS = 12_000;
const GAME_SCAN_MS = 20_000;
const IDLE_AFTER_MS = 5 * 60_000;
const MAX_AVATAR_BYTES = 8 * 1024 * 1024;
const PUBLIC_PROFILE_SELECTORS = [
  ".member-row",
  ".person-card",
  ".user-popover-card",
  ".full-profile",
  ".profile-preview-card",
  ".message-group",
  ".direct-contact-title",
  ".nav-user-card",
  ".user-panel",
  ".voice-user",
  ".voice-channel-user",
  ".participant-tile"
].join(",");

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch] || ch));
}

function formatElapsed(startedAt: string | null): string {
  if (!startedAt) return "";
  const elapsed = Math.max(0, Date.now() - new Date(startedAt).getTime());
  if (!Number.isFinite(elapsed)) return "";
  const minutes = Math.floor(elapsed / 60_000);
  if (minutes < 1) return "agora";
  if (minutes < 60) return `há ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `há ${hours}h ${rest}min` : `há ${hours}h`;
}

function presenceLabel(mode: PresenceMode) {
  return ({ ONLINE: "Online", AWAY: "Ausente", BUSY: "Ocupado", OFFLINE: "Offline / Invisível" } as const)[mode];
}

function usernameFromElement(element: HTMLElement): string | null {
  const explicit = element.dataset.username || element.getAttribute("data-user-name") || element.getAttribute("data-user-username");
  if (explicit) return explicit.replace(/^@/, "").trim().toLowerCase();
  const match = (element.textContent || "").match(/@([a-zA-Z0-9_.-]{2,40})/);
  return match?.[1]?.toLowerCase() || null;
}

function avatarElement(root: HTMLElement): HTMLElement | null {
  if (root.matches(".avatar")) return root;
  return root.querySelector<HTMLElement>(".avatar, .member-avatar, .person-avatar, .profile-avatar");
}

function applyAvatar(root: HTMLElement, profile: PublicGamingProfile) {
  const avatar = avatarElement(root);
  if (!avatar) return;

  if (avatar instanceof HTMLImageElement) {
    if (!avatar.dataset.gingaOriginalSrc && avatar.getAttribute("src")) avatar.dataset.gingaOriginalSrc = avatar.getAttribute("src") || "";
    if (profile.avatarUrl) {
      avatar.src = profile.avatarUrl;
      avatar.classList.add("ginga-avatar-image-element");
      avatar.setAttribute("aria-label", `Avatar de ${profile.user.displayName}`);
    } else {
      if (avatar.dataset.gingaOriginalSrc) avatar.src = avatar.dataset.gingaOriginalSrc;
      avatar.classList.remove("ginga-avatar-image-element");
    }
  } else if (profile.avatarUrl) {
    avatar.classList.add("ginga-avatar-image");
    avatar.style.backgroundImage = `url(${JSON.stringify(profile.avatarUrl).slice(1, -1)})`;
    avatar.style.backgroundColor = profile.user.avatarColor || "#3f4650";
    avatar.setAttribute("aria-label", `Avatar de ${profile.user.displayName}`);
  } else {
    avatar.classList.remove("ginga-avatar-image");
    avatar.style.removeProperty("background-image");
  }

  const dotHost = avatar instanceof HTMLImageElement && avatar.parentElement instanceof HTMLElement ? avatar.parentElement : avatar;
  dotHost.classList.add("ginga-avatar-presence-host");
  let dot = dotHost.querySelector<HTMLElement>(":scope > .avatar-status, :scope > .ginga-profile-presence-dot");
  if (!dot) {
    dot = document.createElement("span");
    dot.className = "ginga-profile-presence-dot";
    dotHost.appendChild(dot);
  }
  dot.classList.remove("online", "away", "busy", "offline");
  dot.classList.add(profile.presence.toLowerCase());
  dot.setAttribute("aria-label", presenceLabel(profile.presence));
}

function applyRichProfile(root: HTMLElement, profile: PublicGamingProfile) {
  const richTarget = root.matches(".user-popover-card,.full-profile,.profile-preview-card")
    ? root
    : root.closest<HTMLElement>(".user-popover-card,.full-profile,.profile-preview-card");
  if (!richTarget) return;

  const nativeStatus = richTarget.querySelector<HTMLElement>(".user-popover-status,.profile-status,.full-profile-status");
  let status = nativeStatus ?? richTarget.querySelector<HTMLElement>(".ginga-profile-custom-status");
  if (profile.customStatus) {
    if (!status) {
      status = document.createElement("div");
      status.className = "ginga-profile-custom-status";
      const anchor = richTarget.querySelector(".user-popover-bio,.profile-bio,.full-profile-bio");
      if (anchor?.parentElement) anchor.insertAdjacentElement("afterend", status);
      else richTarget.appendChild(status);
    }
    status.textContent = profile.customStatus;
  } else if (status?.classList.contains("ginga-profile-custom-status")) status.remove();

  let activity = richTarget.querySelector<HTMLElement>(".ginga-profile-activity");
  if (profile.activity) {
    if (!activity) {
      activity = document.createElement("section");
      activity.className = "ginga-profile-activity";
      richTarget.appendChild(activity);
    }
    const elapsed = formatElapsed(profile.activity.startedAt);
    const fingerprint = `${profile.activity.name}|${profile.activity.details}|${elapsed}`;
    if (activity.dataset.fingerprint !== fingerprint) {
      activity.dataset.fingerprint = fingerprint;
      activity.innerHTML = `
        <span class="ginga-profile-activity-icon" aria-hidden="true"></span>
        <div><small>JOGANDO</small><strong>${escapeHtml(profile.activity.name)}</strong><span>${escapeHtml(profile.activity.details)}${elapsed ? ` · ${escapeHtml(elapsed)}` : ""}</span></div>`;
    }
  } else activity?.remove();
}

function applyPublicProfile(profile: PublicGamingProfile) {
  const username = profile.user.username.toLowerCase();
  document.querySelectorAll<HTMLElement>(PUBLIC_PROFILE_SELECTORS).forEach((root) => {
    if (usernameFromElement(root) !== username) return;
    applyAvatar(root, profile);
    applyRichProfile(root, profile);
    root.dataset.gingaPresence = profile.presence.toLowerCase();
  });
}

function applyOwnProfile(profile: PublicGamingProfile) {
  document.querySelectorAll<HTMLElement>(".nav-user-card, .user-panel").forEach((root) => {
    applyAvatar(root, profile);
    root.dataset.gingaPresence = profile.presence.toLowerCase();
  });
}

function profileModalHtml(profile: OwnGamingProfile, desktopAvailable: boolean) {
  const checked = (value: boolean) => value ? "checked" : "";
  const option = (value: PresenceMode, label: string) => `<option value="${value}" ${profile.settings.presenceMode === value ? "selected" : ""}>${label}</option>`;
  const avatar = profile.avatarUrl
    ? `<div class="ginga-profile-current-avatar ginga-avatar-image" style="background-image:url('${escapeHtml(profile.avatarUrl)}')"></div>`
    : `<div class="ginga-profile-current-avatar" style="background:${escapeHtml(profile.user.avatarColor || "#505862")}">${escapeHtml(profile.user.displayName.slice(0, 1).toUpperCase())}</div>`;
  return `
    <div class="ginga-gaming-profile-backdrop" data-ginga-profile-close="true">
      <section class="ginga-gaming-profile-modal" role="dialog" aria-modal="true" aria-label="Personalizar perfil">
        <header class="ginga-profile-modal-header">
          <div><span>Ginga Gaming & Privacy</span><h2>Perfil e presença</h2><p>Seu perfil, seu jogo e o que você decide compartilhar.</p></div>
          <button type="button" class="ginga-profile-close" data-ginga-profile-close="true" aria-label="Fechar">×</button>
        </header>
        <div class="ginga-profile-modal-scroll">
          <section class="ginga-profile-identity-grid">
            <div class="ginga-avatar-editor">
              <div class="ginga-avatar-preview-wrap">${avatar}<canvas class="ginga-avatar-crop" width="220" height="220" hidden></canvas></div>
              <input class="ginga-avatar-file" type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden />
              <div class="ginga-avatar-actions"><button type="button" class="ginga-profile-secondary ginga-avatar-pick">Trocar avatar</button>${profile.avatarUrl ? '<button type="button" class="ginga-profile-ghost" data-remove-avatar>Remover</button>' : ""}</div>
              <label class="ginga-avatar-zoom" hidden><span>Zoom</span><input type="range" min="1" max="3" step="0.01" value="1" /></label>
              <small>PNG, JPG, WebP ou GIF. GIF animado e preservado; imagens estaticas sao recortadas em WebP 512×512.</small>
            </div>
            <div class="ginga-profile-fields">
              <label><span>Sobre mim</span><textarea name="bio" maxlength="280" rows="4" placeholder="Fale um pouco sobre você...">${escapeHtml(profile.bio || "")}</textarea><small><b data-count-bio>${(profile.bio || "").length}</b>/280</small></label>
              <label><span>Status personalizado</span><input name="customStatus" maxlength="120" value="${escapeHtml(profile.customStatus || "")}" placeholder="Ex.: Fechando uma ranked" /><small><b data-count-status>${(profile.customStatus || "").length}</b>/120</small></label>
              <label><span>Presença</span><select name="presenceMode">${option("ONLINE", "Online")}${option("AWAY", "Ausente")}${option("BUSY", "Ocupado")}${option("OFFLINE", "Offline / Invisível")}</select><small>Invisível mantém o Ginga conectado, mas você aparece offline.</small></label>
              <label class="ginga-switch-row"><div><strong>Ausente automático</strong><small>Depois de 5 minutos sem atividade.</small></div><input name="autoAway" type="checkbox" ${checked(profile.settings.autoAway)} /></label>
            </div>
          </section>

          <section class="ginga-profile-game-section">
            <div class="ginga-profile-section-title"><span></span><div><h3>Atividade de jogo</h3><p>A atividade fica escondida por padrão e também some quando você estiver invisível.</p></div></div>
            <label class="ginga-switch-row"><div><strong>Mostrar o que estou jogando</strong><small>Exibe a atividade nos seus cards de perfil.</small></div><input name="showGameActivity" type="checkbox" ${checked(profile.settings.showGameActivity)} /></label>
            <label class="ginga-switch-row ${desktopAvailable ? "" : "is-disabled"}"><div><strong>Detectar jogo automaticamente</strong><small>${desktopAvailable ? "Detecção local no Desktop. Só o jogo reconhecido é enviado ao servidor." : "Disponível no aplicativo Desktop do Ginga."}</small></div><input name="autoDetectGame" type="checkbox" ${checked(profile.settings.autoDetectGame)} ${desktopAvailable ? "" : "disabled"} /></label>
            <div class="ginga-profile-game-fields">
              <label><span>Jogo</span><input name="gameName" maxlength="100" value="${escapeHtml(profile.settings.gameName || "")}" placeholder="Ex.: Counter-Strike 2" /></label>
              <label><span>Descrição</span><input name="gameDetails" maxlength="120" value="${escapeHtml(profile.settings.gameDetails || "Sobreposição de jogo")}" placeholder="Sobreposição de jogo" /></label>
            </div>
            <div class="ginga-game-actions">
              ${desktopAvailable ? '<button type="button" class="ginga-profile-secondary" data-detect-game>Detectar agora</button>' : ""}
              <button type="button" class="ginga-profile-ghost" data-clear-game>Limpar atividade</button>
              <span class="ginga-game-detect-status" aria-live="polite"></span>
            </div>
          </section>

          <section class="ginga-profile-privacy-note">
            <span class="ginga-profile-privacy-shield" aria-hidden="true"></span>
            <div><strong>Privacidade primeiro</strong><p>A detecção automática é opcional. O Desktop compara processos localmente e não envia sua lista de programas ao Ginga. Se houver correspondência, envia somente o nome público do jogo.</p></div>
          </section>
        </div>
        <footer class="ginga-profile-modal-footer">
          <span class="ginga-profile-save-status" aria-live="polite"></span>
          <button type="button" class="ginga-profile-ghost" data-ginga-profile-close="true">Cancelar</button>
          <button type="button" class="ginga-profile-primary" data-save-profile>Salvar alterações</button>
        </footer>
      </section>
    </div>`;
}


export function installGamingProfileExperience(api: ApiRequest, hasSession: HasSession) {
  if (typeof window === "undefined" || typeof document === "undefined") return;
  const lifecycleWindow = window as typeof window & { __gingaGamingProfileInstalled?: boolean };
  if (lifecycleWindow.__gingaGamingProfileInstalled) return;
  lifecycleWindow.__gingaGamingProfileInstalled = true;

  const bridge = (window as unknown as { gingaDesktop?: DesktopGameBridge }).gingaDesktop;
  let ownProfile: OwnGamingProfile | null = null;
  let lastActivityAt = Date.now();
  let lastDetectedGame = "";
  let lastDesktopGamePulseAt = 0;
  let desktopMisses = 0;
  let publicRefreshRunning = false;
  let lastPublicRefreshAt = 0;
  let publicRefreshTimer: number | null = null;
  let modalOpen = false;
  let profileLoadPromise: Promise<OwnGamingProfile | null> | null = null;

  const desktopAvailable = Boolean(bridge?.isDesktop && bridge.detectGameActivity);

  const loadOwnProfile = async (force = false) => {
    if (!hasSession()) return null;
    if (!force && ownProfile) return ownProfile;
    if (!force && profileLoadPromise) return profileLoadPromise;
    profileLoadPromise = api<{ profile: OwnGamingProfile }>("/api/gaming-profile/me")
      .then(({ profile }) => {
        ownProfile = profile;
        applyPublicProfile(profile);
        applyOwnProfile(profile);
        return profile;
      })
      .catch(() => null)
      .finally(() => { profileLoadPromise = null; });
    return profileLoadPromise;
  };

  const patchOwnProfile = async (payload: Record<string, unknown>) => {
    const response = await api<{ profile: OwnGamingProfile }>("/api/gaming-profile/me", {
      method: "PATCH",
      body: JSON.stringify(payload)
    });
    ownProfile = response.profile;
    applyPublicProfile(response.profile);
    applyOwnProfile(response.profile);
    window.dispatchEvent(new CustomEvent("ginga:profile-local-update", { detail: response.profile }));
    return response.profile;
  };

  quickPresenceUpdater = async (mode: PresenceMode) => {
    const response = await api<{ profile: OwnGamingProfile }>("/api/gaming-profile/presence", {
      method: "PATCH",
      body: JSON.stringify({ presenceMode: mode })
    });
    ownProfile = response.profile;
    applyPublicProfile(response.profile);
    applyOwnProfile(response.profile);
    window.dispatchEvent(new CustomEvent("ginga:profile-local-update", { detail: response.profile }));
    return response.profile.presence;
  };

  const heartbeat = async () => {
    if (!hasSession()) return;
    // Jogo detectado localmente conta como atividade real: o usuario nao deve
    // virar "Ausente" no meio de uma partida so porque nao clicou no Ginga.
    const gamingActive = ownProfile?.settings.gameSource === "DESKTOP" && Boolean(ownProfile.activity);
    const idle = !gamingActive && Date.now() - lastActivityAt >= IDLE_AFTER_MS;
    try {
      const response = await api<{ presence: PresenceMode; activity: PublicGamingProfile["activity"] }>("/api/gaming-profile/heartbeat", {
        method: "POST",
        body: JSON.stringify({ idle })
      });
      if (ownProfile) {
        ownProfile = { ...ownProfile, presence: response.presence, activity: response.activity, settings: { ...ownProfile.settings, idle } };
        applyPublicProfile(ownProfile);
        applyOwnProfile(ownProfile);
      }
    } catch { /* Sessao pode ter expirado; o fluxo de auth cuida disso. */ }
  };

  const scanDesktopGame = async (force = false) => {
    const profile = await loadOwnProfile();
    if (!profile || !desktopAvailable || !bridge?.detectGameActivity) return null;
    if (profile.settings.presenceMode === "OFFLINE" && !force) return null;
    if (!force && (!profile.settings.autoDetectGame || !profile.settings.showGameActivity)) return null;
    try {
      const result = await bridge.detectGameActivity();
      const name = String(result?.activity?.name || "").trim();
      if (name) {
        desktopMisses = 0;
        const needsPulse = Date.now() - lastDesktopGamePulseAt >= 45_000;
        if (name !== lastDetectedGame || profile.settings.gameSource !== "DESKTOP" || profile.settings.gameName !== name || needsPulse) {
          lastDetectedGame = name;
          lastDesktopGamePulseAt = Date.now();
          await patchOwnProfile({
            gameName: name,
            gameDetails: "Sobreposição de jogo",
            gameSource: "DESKTOP",
            showGameActivity: true
          });
        }
        return name;
      }
      desktopMisses += 1;
      if (desktopMisses >= 2 && profile.settings.gameSource === "DESKTOP" && profile.settings.gameName) {
        lastDetectedGame = "";
        lastDesktopGamePulseAt = 0;
        desktopMisses = 0;
        await patchOwnProfile({ gameName: null, gameDetails: null, gameSource: "NONE", resetGameStartedAt: true });
      }
      return null;
    } catch {
      return null;
    }
  };

  const refreshVisibleProfiles = async () => {
    if (!hasSession() || publicRefreshRunning || Date.now() - lastPublicRefreshAt < 4_000) return;
    publicRefreshRunning = true;
    lastPublicRefreshAt = Date.now();
    try {
      const usernames = Array.from(document.querySelectorAll<HTMLElement>(PUBLIC_PROFILE_SELECTORS))
        .map(usernameFromElement)
        .filter((value): value is string => Boolean(value));
      if (ownProfile?.user.username) usernames.push(ownProfile.user.username.toLowerCase());
      const unique = Array.from(new Set(usernames)).slice(0, 80);
      if (!unique.length) return;
      const response = await api<{ profiles: PublicGamingProfile[] }>(`/api/gaming-profile/batch?usernames=${encodeURIComponent(unique.join(","))}`);
      response.profiles.forEach(applyPublicProfile);
    } catch { /* Melhor esforço; a UI base continua funcional. */ }
    finally { publicRefreshRunning = false; }
  };

  const addProfileEntryPoints = () => {
    const candidates = document.querySelectorAll<HTMLElement>(".nav-user-card .avatar, .user-panel .avatar");
    candidates.forEach((avatar) => {
      if (avatar.dataset.gingaProfileEntry === "true") return;
      avatar.dataset.gingaProfileEntry = "true";
      avatar.classList.add("ginga-profile-own-avatar");
      avatar.setAttribute("role", "button");
      avatar.setAttribute("aria-label", "Personalizar perfil");
      avatar.tabIndex = 0;
      const open = (event: Event) => {
        event.preventDefault();
        event.stopPropagation();
        void openProfileModal();
      };
      avatar.addEventListener("click", open);
      avatar.addEventListener("keydown", (event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        open(event);
      });
    });
  };

  const openProfileModal = async () => {
    if (modalOpen) return;
    const profile = await loadOwnProfile(true);
    if (!profile) return;
    modalOpen = true;
    const host = document.createElement("div");
    host.className = "ginga-gaming-profile-host";
    host.innerHTML = profileModalHtml(profile, desktopAvailable);
    document.body.appendChild(host);
    document.documentElement.classList.add("ginga-profile-modal-open");

    const backdrop = host.querySelector<HTMLElement>(".ginga-gaming-profile-backdrop")!;
    const cropCanvas = host.querySelector<HTMLCanvasElement>(".ginga-avatar-crop")!;
    const currentAvatar = host.querySelector<HTMLElement>(".ginga-profile-current-avatar")!;
    const fileInput = host.querySelector<HTMLInputElement>(".ginga-avatar-file")!;
    const zoomRow = host.querySelector<HTMLElement>(".ginga-avatar-zoom")!;
    const zoomInput = host.querySelector<HTMLInputElement>(".ginga-avatar-zoom input")!;
    const saveButton = host.querySelector<HTMLButtonElement>("[data-save-profile]")!;
    const saveStatus = host.querySelector<HTMLElement>(".ginga-profile-save-status")!;
    const detectStatus = host.querySelector<HTMLElement>(".ginga-game-detect-status")!;
    const bio = host.querySelector<HTMLTextAreaElement>('textarea[name="bio"]')!;
    const customStatus = host.querySelector<HTMLInputElement>('input[name="customStatus"]')!;
    const gameName = host.querySelector<HTMLInputElement>('input[name="gameName"]')!;
    const gameDetails = host.querySelector<HTMLInputElement>('input[name="gameDetails"]')!;
    const showGameActivity = host.querySelector<HTMLInputElement>('input[name="showGameActivity"]')!;
    const autoDetectGame = host.querySelector<HTMLInputElement>('input[name="autoDetectGame"]')!;
    const presenceMode = host.querySelector<HTMLSelectElement>('select[name="presenceMode"]')!;
    const autoAway = host.querySelector<HTMLInputElement>('input[name="autoAway"]')!;

    let image: HTMLImageElement | null = null;
    let selectedAvatarFile: File | null = null;
    let imageObjectUrl = "";
    let zoom = 1;
    let offsetX = 0;
    let offsetY = 0;
    let dragging = false;
    let pendingRemoveAvatar = false;
    let modalGameSource: GameSource = profile.settings.gameSource;
    let lastPointerX = 0;
    let lastPointerY = 0;

    const close = () => {
      if (!modalOpen) return;
      modalOpen = false;
      if (imageObjectUrl) URL.revokeObjectURL(imageObjectUrl);
      host.remove();
      document.documentElement.classList.remove("ginga-profile-modal-open");
      document.removeEventListener("keydown", onKeyDown, true);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        close();
      }
    };
    document.addEventListener("keydown", onKeyDown, true);
    backdrop.addEventListener("click", (event) => {
      const target = event.target as HTMLElement | null;
      if (target?.dataset.gingaProfileClose === "true") close();
    });

    const updateCount = (input: HTMLInputElement | HTMLTextAreaElement, selector: string) => {
      const element = host.querySelector<HTMLElement>(selector);
      if (element) element.textContent = String(input.value.length);
    };
    bio.addEventListener("input", () => updateCount(bio, "[data-count-bio]"));
    customStatus.addEventListener("input", () => updateCount(customStatus, "[data-count-status]"));

    const drawCrop = () => {
      if (!image) return;
      const ctx = cropCanvas.getContext("2d");
      if (!ctx) return;
      const size = cropCanvas.width;
      const baseScale = Math.max(size / image.naturalWidth, size / image.naturalHeight);
      const scale = baseScale * zoom;
      const width = image.naturalWidth * scale;
      const height = image.naturalHeight * scale;
      const maxX = Math.max(0, (width - size) / 2);
      const maxY = Math.max(0, (height - size) / 2);
      offsetX = Math.max(-maxX, Math.min(maxX, offsetX));
      offsetY = Math.max(-maxY, Math.min(maxY, offsetY));
      ctx.clearRect(0, 0, size, size);
      ctx.drawImage(image, (size - width) / 2 + offsetX, (size - height) / 2 + offsetY, width, height);
    };

    const loadAvatarFile = (file: File | null) => {
      if (!file) return;
      pendingRemoveAvatar = false;
      if (!["image/png", "image/jpeg", "image/webp", "image/gif"].includes(file.type)) {
        saveStatus.textContent = "Use uma imagem PNG, JPG, WebP ou GIF.";
        return;
      }
      if (file.size > MAX_AVATAR_BYTES) {
        saveStatus.textContent = "A imagem pode ter no máximo 8 MB.";
        return;
      }
      selectedAvatarFile = file;
      if (imageObjectUrl) URL.revokeObjectURL(imageObjectUrl);
      imageObjectUrl = URL.createObjectURL(file);
      const next = new Image();
      next.onload = () => {
        if (next.naturalWidth > 8192 || next.naturalHeight > 8192 || next.naturalWidth * next.naturalHeight > 40_000_000) {
          saveStatus.textContent = "A imagem tem resolução grande demais. Use até 8192×8192.";
          URL.revokeObjectURL(imageObjectUrl);
          imageObjectUrl = "";
          image = null;
          return;
        }
        image = next;
        zoom = 1;
        offsetX = 0;
        offsetY = 0;
        zoomInput.value = "1";
        if (file.type === "image/gif") {
          cropCanvas.hidden = true;
          zoomRow.hidden = true;
          currentAvatar.hidden = false;
          currentAvatar.textContent = "";
          currentAvatar.classList.add("ginga-avatar-image");
          currentAvatar.style.backgroundImage = `url(${JSON.stringify(imageObjectUrl)})`;
          currentAvatar.style.backgroundPosition = "center";
          currentAvatar.style.backgroundSize = "cover";
          saveStatus.textContent = "GIF animado pronto. Ele sera enviado sem conversao para manter a animacao.";
        } else {
          currentAvatar.hidden = true;
          cropCanvas.hidden = false;
          zoomRow.hidden = false;
          drawCrop();
          saveStatus.textContent = "Arraste a imagem para ajustar o enquadramento.";
        }
      };
      next.onerror = () => { saveStatus.textContent = "Não foi possível abrir a imagem."; };
      next.src = imageObjectUrl;
    };

    host.querySelector(".ginga-avatar-pick")?.addEventListener("click", () => fileInput.click());
    fileInput.addEventListener("change", () => loadAvatarFile(fileInput.files?.[0] || null));
    zoomInput.addEventListener("input", () => {
      zoom = Number(zoomInput.value) || 1;
      drawCrop();
    });
    cropCanvas.addEventListener("pointerdown", (event) => {
      if (!image) return;
      dragging = true;
      lastPointerX = event.clientX;
      lastPointerY = event.clientY;
      cropCanvas.setPointerCapture(event.pointerId);
    });
    cropCanvas.addEventListener("pointermove", (event) => {
      if (!dragging || !image) return;
      const scale = cropCanvas.width / cropCanvas.getBoundingClientRect().width;
      offsetX += (event.clientX - lastPointerX) * scale;
      offsetY += (event.clientY - lastPointerY) * scale;
      lastPointerX = event.clientX;
      lastPointerY = event.clientY;
      drawCrop();
    });
    cropCanvas.addEventListener("pointerup", () => { dragging = false; });
    cropCanvas.addEventListener("pointercancel", () => { dragging = false; });

    const dropTarget = host.querySelector<HTMLElement>(".ginga-avatar-editor")!;
    ["dragenter", "dragover"].forEach((type) => dropTarget.addEventListener(type, (event) => {
      event.preventDefault();
      dropTarget.classList.add("is-dragging");
    }));
    ["dragleave", "drop"].forEach((type) => dropTarget.addEventListener(type, (event) => {
      event.preventDefault();
      dropTarget.classList.remove("is-dragging");
    }));
    dropTarget.addEventListener("drop", (event) => loadAvatarFile(event.dataTransfer?.files?.[0] || null));
    host.addEventListener("paste", (event) => {
      const item = Array.from(event.clipboardData?.items || []).find((entry) => entry.type.startsWith("image/"));
      if (item) loadAvatarFile(item.getAsFile());
    });

    const renderAvatarFile = async (): Promise<File | null> => {
      if (!image || !selectedAvatarFile) return null;
      if (selectedAvatarFile.type === "image/gif") return selectedAvatarFile;
      const size = 512;
      const output = document.createElement("canvas");
      output.width = size;
      output.height = size;
      const ctx = output.getContext("2d");
      if (!ctx) return null;
      const previewSize = cropCanvas.width;
      const baseScale = Math.max(previewSize / image.naturalWidth, previewSize / image.naturalHeight);
      const previewScale = baseScale * zoom;
      const ratio = size / previewSize;
      const width = image.naturalWidth * previewScale * ratio;
      const height = image.naturalHeight * previewScale * ratio;
      ctx.drawImage(image, (size - width) / 2 + offsetX * ratio, (size - height) / 2 + offsetY * ratio, width, height);
      const blob = await new Promise<Blob | null>((resolve) => output.toBlob(resolve, "image/webp", 0.88));
      return blob ? new File([blob], "ginga-avatar.webp", { type: "image/webp" }) : null;
    };

    host.querySelector("[data-remove-avatar]")?.addEventListener("click", () => {
      pendingRemoveAvatar = true;
      image = null;
      selectedAvatarFile = null;
      if (imageObjectUrl) { URL.revokeObjectURL(imageObjectUrl); imageObjectUrl = ""; }
      cropCanvas.hidden = true;
      zoomRow.hidden = true;
      currentAvatar.hidden = false;
      currentAvatar.classList.remove("ginga-avatar-image");
      currentAvatar.style.removeProperty("background-image");
      currentAvatar.style.background = ownProfile?.user.avatarColor || "#505862";
      currentAvatar.textContent = ownProfile?.user.displayName.slice(0, 1).toUpperCase() || "G";
      saveStatus.textContent = "O avatar será removido ao salvar.";
    });

    gameName.addEventListener("input", () => { modalGameSource = gameName.value.trim() ? "MANUAL" : "NONE"; });
    gameDetails.addEventListener("input", () => { if (gameName.value.trim()) modalGameSource = "MANUAL"; });
    autoDetectGame.addEventListener("change", () => {
      if (!autoDetectGame.checked && modalGameSource === "DESKTOP" && gameName.value.trim()) modalGameSource = "MANUAL";
    });

    host.querySelector("[data-clear-game]")?.addEventListener("click", () => {
      gameName.value = "";
      gameDetails.value = "";
      modalGameSource = "NONE";
      detectStatus.textContent = "A atividade será removida ao salvar.";
    });

    host.querySelector("[data-detect-game]")?.addEventListener("click", async () => {
      if (!bridge?.detectGameActivity) return;
      detectStatus.textContent = "Procurando jogo em execução...";
      const result = await bridge.detectGameActivity().catch(() => null);
      const detected = String(result?.activity?.name || "").trim();
      if (detected) {
        gameName.value = detected;
        gameDetails.value = "Sobreposição de jogo";
        modalGameSource = "DESKTOP";
        showGameActivity.checked = true;
        autoDetectGame.checked = true;
        detectStatus.textContent = `${detected} detectado localmente.`;
      } else {
        detectStatus.textContent = "Nenhum jogo reconhecido agora.";
      }
    });

    saveButton.addEventListener("click", async () => {
      saveButton.disabled = true;
      saveStatus.textContent = "Salvando...";
      try {
        const avatarFile = await renderAvatarFile();
        if (avatarFile) {
          saveStatus.textContent = "Salvando avatar...";
          const avatarResponse = await api<{ profile: OwnGamingProfile }>("/api/gaming-profile/avatar", {
            method: "POST",
            headers: { "Content-Type": avatarFile.type || "image/webp" },
            body: avatarFile
          });
          ownProfile = avatarResponse.profile;
          applyPublicProfile(avatarResponse.profile);
          applyOwnProfile(avatarResponse.profile);
        } else if (pendingRemoveAvatar) {
          const avatarResponse = await api<{ profile: OwnGamingProfile }>("/api/gaming-profile/avatar", { method: "DELETE" });
          ownProfile = avatarResponse.profile;
          applyPublicProfile(avatarResponse.profile);
          applyOwnProfile(avatarResponse.profile);
        }
        const nextGameName = gameName.value.trim() || null;
        const nextGameDetails = gameDetails.value.trim() || (nextGameName ? "Sobreposição de jogo" : null);
        await patchOwnProfile({
          bio: bio.value.trim() || null,
          customStatus: customStatus.value.trim() || null,
          presenceMode: presenceMode.value,
          autoAway: autoAway.checked,
          showGameActivity: showGameActivity.checked,
          autoDetectGame: desktopAvailable ? autoDetectGame.checked : profile.settings.autoDetectGame,
          gameName: nextGameName,
          gameDetails: nextGameDetails,
          gameSource: nextGameName ? modalGameSource : "NONE",
          resetGameStartedAt: !nextGameName
        });
        lastActivityAt = Date.now();
        await heartbeat();
        saveStatus.textContent = "Perfil atualizado.";
        window.setTimeout(close, 450);
      } catch (error) {
        saveStatus.textContent = error instanceof Error ? error.message : "Não foi possível salvar.";
        saveButton.disabled = false;
      }
    });
  };

  const activityEvent = () => { lastActivityAt = Date.now(); };
  ["pointerdown", "keydown", "touchstart"].forEach((eventName) => window.addEventListener(eventName, activityEvent, { passive: true }));
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) lastActivityAt = Date.now();
  });

  const start = () => {
    const bootstrapAuthenticated = () => {
      if (!hasSession()) return;
      void loadOwnProfile(true).then(() => {
        addProfileEntryPoints();
        void heartbeat();
        void refreshVisibleProfiles();
        if (desktopAvailable) void scanDesktopGame();
      });
    };

    bootstrapAuthenticated();

    const queuePublicRefresh = () => {
      if (publicRefreshTimer !== null) window.clearTimeout(publicRefreshTimer);
      publicRefreshTimer = window.setTimeout(() => {
        publicRefreshTimer = null;
        void refreshVisibleProfiles();
      }, 700);
    };
    const observer = new MutationObserver(() => {
      addProfileEntryPoints();
      queuePublicRefresh();
    });
    observer.observe(document.body, { childList: true, subtree: true });

    window.addEventListener("ginga:session-changed", ((event: Event) => {
      const authenticated = Boolean((event as CustomEvent<{ authenticated?: boolean }>).detail?.authenticated);
      if (!authenticated) {
        ownProfile = null;
        lastDetectedGame = "";
        lastDesktopGamePulseAt = 0;
        return;
      }
      bootstrapAuthenticated();
    }) as EventListener);

    const scheduleLoop=(task:()=>void|Promise<unknown>,activeMs:number,hiddenMs:number)=>{let timer=0;const run=()=>{if(hasSession())void task();timer=window.setTimeout(run,document.hidden?hiddenMs:activeMs)};timer=window.setTimeout(run,activeMs);return()=>window.clearTimeout(timer)};
    scheduleLoop(heartbeat,HEARTBEAT_MS,Math.max(HEARTBEAT_MS*3,90_000));
    scheduleLoop(refreshVisibleProfiles,PROFILE_REFRESH_MS,Math.max(PROFILE_REFRESH_MS*4,120_000));
    if(desktopAvailable)scheduleLoop(scanDesktopGame,GAME_SCAN_MS,Math.max(GAME_SCAN_MS*4,60_000));

    window.addEventListener("ginga:profile:update", ((event: Event) => {
      const profile = (event as CustomEvent<PublicGamingProfile>).detail;
      if (profile?.user?.username) {
        applyPublicProfile(profile);
        if (ownProfile?.user.username.toLowerCase() === profile.user.username.toLowerCase()) applyOwnProfile(profile);
      }
    }) as EventListener);
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true });
  else start();
}
