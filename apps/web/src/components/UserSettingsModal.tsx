import { useEffect, useRef, useState, type CSSProperties, type FormEvent } from "react";
import { Activity, Archive, AudioLines, BellRing, Bookmark, CalendarClock, Camera, CircleCheck, Code2, Copy, Download, ExternalLink, Eye, Gamepad2, Headphones, Keyboard, KeyRound, LockKeyhole, Mic, MicOff, MonitorUp, Palette, RefreshCw, Save, ShieldCheck, Trash2, TriangleAlert, UserCog } from "lucide-react";
import { api, setToken } from "../lib/api";
import { copyTextToClipboard } from "../lib/clipboard";
import { loadDeveloperPreferences, saveDeveloperPreferences } from "../lib/developerMode";
import { prepareSquareImageAsset, prepareWideImageAsset } from "../lib/imageUpload";
import { ensureNotificationPermission, isGingaDesktop, showSystemNotification } from "../lib/notifications";
import {
  loadAppearancePreferences,
  loadNotificationPreferences,
  saveAppearancePreferences,
  saveNotificationPreferences,
  type AppearancePreferences,
  type DensityPreference,
  type NotificationPreferences,
  type ThemePreference
} from "../lib/preferences";
import type { ProfileAppearance, ProfileLink, ProfileTheme, PublicGamingProfile, User } from "../types";
import QRCode from "qrcode";
import { Avatar } from "./Avatar";
import { SettingsShell } from "./SettingsShell";
import { UserSocialPanel } from "./UserSocialPanel";
import { applyVoiceDevice, loadVoicePreferences, saveVoicePreferences, type VoicePreferences } from "../lib/voicePreferences";
import { bindingFromKeyboardEvent, bindingFromMouseEvent, formatPushToTalkBinding } from "../lib/pushToTalkBinding";
import { detectDesktopGame, isGameOverlayAvailable, loadGameOverlayPreferences, previewGameOverlay, saveGameOverlayPreferences, type DesktopDetectedGame, type GameOverlayPreferences } from "../lib/gameOverlay";

export type UserSettingsTab = "account" | "profile" | "social" | "privacy" | "voice" | "saved" | "notifications" | "appearance" | "updates" | "gaming" | "diagnostics" | "developer" | "security";

interface UserSettingsModalProps {
  user: User;
  onClose: () => void;
  onSessionUpdate: (token: string, user: User) => void;
  initialTab?: UserSettingsTab;
  socketConnected?: boolean;
}


interface AuthSessionItem { id:string; createdAt:string; lastSeenAt:string; revokedAt:string|null; ipHash:string|null; userAgent:string; current?:boolean; }
interface TrustedTwoFactorDeviceItem { id:string; userAgent:string; createdAt:string; lastUsedAt:string; expiresAt:string; current:boolean; }
interface TwoFactorStatus { available:boolean; enabled:boolean; }
interface TwoFactorSetup { secret:string; otpauthUri:string; }
interface DesktopUpdateResult { available?:boolean; version?:string; latestVersion?:string; currentVersion?:string; channel?:"stable"|"beta"; skippedPrerelease?:boolean; releaseNotes?:string; restarting?:boolean; }
interface DesktopUpdateBridge {
  isDesktop?:boolean;
  checkForUpdate?:()=>Promise<DesktopUpdateResult>;
  getUpdateChannel?:()=>Promise<{channel:"stable"|"beta"}>;
  setUpdateChannel?:(channel:"stable"|"beta")=>Promise<DesktopUpdateResult&{channel:"stable"|"beta"}>;
  restartToUpdate?:()=>Promise<DesktopUpdateResult>;
  getAutoStart?:()=>Promise<{enabled:boolean;supported:boolean}>;
  setAutoStart?:(enabled:boolean)=>Promise<{enabled:boolean;supported:boolean}>;
  getStartMinimized?:()=>Promise<{enabled:boolean;supported:boolean}>;
  setStartMinimized?:(enabled:boolean)=>Promise<{enabled:boolean;supported:boolean}>;
  getDiagnostics?:()=>Promise<DesktopDiagnostics>;
}
interface GamingProfileSettings {
  showGameActivity:boolean;
  autoDetectGame:boolean;
  gameName:string|null;
  gameDetails:string|null;
  gameSource:"NONE"|"MANUAL"|"DESKTOP";
}
interface GamingProfileResponse { profile: PublicGamingProfile & { settings: GamingProfileSettings } }
interface ServerDiagnostics {
  status:"healthy"|"degraded";
  version:string;
  timestamp:string;
  uptimeSeconds:number;
  database:{ok:boolean;latencyMs:number};
  livekit:{ok:boolean;latencyMs:number;publicUrl:string};
  websocket:{ok:boolean};
  storage:{ok:boolean;usedPercent:number};
}
interface DesktopDiagnostics {
  appVersion:string; product:string; platform:string; arch:string; osType:string; osRelease:string;
  electron:string; chrome:string; node:string; packaged:boolean; serverUrl:string; updateChannel:string;
  autoStart:{enabled:boolean;supported:boolean}; desktopPreferences:{startMinimized:boolean};
  window:{width:number;height:number;maximized:boolean;minimized:boolean;visible:boolean;zoomFactor:number}|null;
  display:{scaleFactor:number;workArea:{width:number;height:number}|null};
}
interface ClientDiagnostics {
  collectedAt:string; webVersion:string; requestLatencyMs:number; online:boolean; socketConnected:boolean; viewport:{width:number;height:number;dpr:number};
  userAgent:string; server:ServerDiagnostics; desktop:DesktopDiagnostics|null;
}

function defaultProfileAppearance(user: User): ProfileAppearance {
  return {
    accentColor: user.avatarColor || "#7c3cff",
    secondaryColor: "#2c74ff",
    profileTheme: "AURORA",
    bannerPosition: 50,
    pronouns: null,
    links: []
  };
}
function desktopUpdaterBridge():DesktopUpdateBridge|null { return typeof window === "undefined" ? null : (window as unknown as {gingaDesktop?:DesktopUpdateBridge}).gingaDesktop ?? null; }

function formatDuration(totalSeconds:number){
  const seconds=Math.max(0,Math.floor(totalSeconds||0));
  const days=Math.floor(seconds/86400); const hours=Math.floor((seconds%86400)/3600); const minutes=Math.floor((seconds%3600)/60);
  return [days?`${days}d`:"",hours?`${hours}h`:"",`${minutes}min`].filter(Boolean).join(" ");
}
function diagnosticsReport(value:ClientDiagnostics){
  const d=value.desktop;
  return [
    "GINGA - DIAGNOSTICO",
    `Coletado: ${value.collectedAt}`,
    `Web: ${value.webVersion}`,
    `API: ${value.server.version} (${value.server.status})`,
    `Compatibilidade Web/API: ${value.webVersion===value.server.version?"OK":"DIVERGENTE"}`,
    ...(d?[`Compatibilidade Desktop/API: ${d.appVersion===value.server.version?"OK":"DIVERGENTE"}`]:[]),
    `Latencia HTTP: ${value.requestLatencyMs} ms`,
    `PostgreSQL: ${value.server.database.ok?"OK":"FALHA"} (${value.server.database.latencyMs} ms)`,
    `LiveKit: ${value.server.livekit.ok?"OK":"FALHA"} (${value.server.livekit.latencyMs} ms)`,
    `WebSocket: ${value.server.websocket.ok?"OK":"FALHA"}`,
    `Armazenamento: ${value.server.storage.ok?"OK":"FALHA"} (${value.server.storage.usedPercent}% usado)`,
    `Uptime API: ${formatDuration(value.server.uptimeSeconds)}`,
    `Viewport: ${value.viewport.width}x${value.viewport.height} @ DPR ${value.viewport.dpr}`,
    `Navigator online: ${value.online?"sim":"nao"}`,
    `Socket.IO cliente: ${value.socketConnected?"conectado":"desconectado"}`,
    ...(d?[
      `Desktop: ${d.appVersion} (${d.platform}-${d.arch})`,
      `Electron: ${d.electron} | Chromium: ${d.chrome}`,
      `SO: ${d.osType} ${d.osRelease}`,
      `Servidor Desktop: ${d.serverUrl}`,
      `Canal updater: ${d.updateChannel}`,
      `Autostart: ${d.autoStart.enabled?"ativo":"inativo"} | iniciar minimizado: ${d.desktopPreferences.startMinimized?"sim":"nao"}`,
      `Janela: ${d.window?`${d.window.width}x${d.window.height} zoom ${Math.round(d.window.zoomFactor*100)}%${d.window.maximized?" maximizada":""}`:"indisponivel"}`,
      `Monitor: ${d.display.workArea?`${d.display.workArea.width}x${d.display.workArea.height}`:"indisponivel"} escala ${Math.round(d.display.scaleFactor*100)}%`
    ]: ["Desktop: navegador Web"]),
    `User-Agent: ${value.userAgent}`
  ].join("\n");
}

interface SavedMessageItem {
  messageId: string;
  createdAt: string;
  message: { id: string; content: string; createdAt: string; channel: { id: string; name: string; guildId: string; type: string }; author: User };
}

interface PersonalTaskItem {
  id: string;
  title: string;
  completed: boolean;
  dueAt: string | null;
  createdAt: string;
  sourceMessage?: { id: string; content: string; channel: { id: string; name: string; guildId: string; type: string } } | null;
}

interface ScheduledMessageItem {
  id: string;
  content: string;
  scheduledFor: string;
  channel: { id: string; name: string; guildId: string; type: string };
}

type MicrophoneHealth = "idle" | "checking" | "ok" | "silent" | "missing" | "denied" | "error";

export function UserSettingsModal({ user, onClose, onSessionUpdate, initialTab = "account", socketConnected = false }: UserSettingsModalProps) {
  const [tab, setTab] = useState<UserSettingsTab>(initialTab);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [appearance, setAppearance] = useState<AppearancePreferences>(() => loadAppearancePreferences());
  const [privacy, setPrivacy] = useState({
    allowFriendRequests: user.allowFriendRequests ?? true,
    allowDirectMessages: user.allowDirectMessages ?? true
  });
  const [notifications, setNotifications] = useState<NotificationPreferences>(() => loadNotificationPreferences());
  const [developerMode, setDeveloperMode] = useState(() => loadDeveloperPreferences().enabled);
  const [bookmarks, setBookmarks] = useState<SavedMessageItem[]>([]);
  const [archives, setArchives] = useState<SavedMessageItem[]>([]);
  const [scheduled, setScheduled] = useState<ScheduledMessageItem[]>([]);
  const [tasks, setTasks] = useState<PersonalTaskItem[]>([]);
  const [savedLoading, setSavedLoading] = useState(false);
  const [voice, setVoice] = useState<VoicePreferences>(() => loadVoicePreferences());
  const [gameOverlay, setGameOverlay] = useState<GameOverlayPreferences>(() => loadGameOverlayPreferences());
  const [gamingProfile, setGamingProfile] = useState<GamingProfileSettings | null>(null);
  const [detectedGame, setDetectedGame] = useState<DesktopDetectedGame | null>(null);
  const [gamingBusy, setGamingBusy] = useState(false);
  const [pttBindingCapture, setPttBindingCapture] = useState(false);
  const [voiceDevices, setVoiceDevices] = useState<{ microphones: MediaDeviceInfo[]; speakers: MediaDeviceInfo[]; cameras: MediaDeviceInfo[] }>({ microphones: [], speakers: [], cameras: [] });
  const [voiceRefreshing, setVoiceRefreshing] = useState(false);
  const [profileAvatarUrl, setProfileAvatarUrl] = useState<string | null>(null);
  const [profileBannerUrl, setProfileBannerUrl] = useState<string | null>(null);
  const [profileBioDraft, setProfileBioDraft] = useState(user.bio ?? "");
  const [profileStatusDraft, setProfileStatusDraft] = useState(user.statusMessage ?? "");
  const [profileAppearance, setProfileAppearance] = useState<ProfileAppearance>(() => defaultProfileAppearance(user));
  const [avatarBusy, setAvatarBusy] = useState(false);
  const [bannerBusy, setBannerBusy] = useState(false);
  const [twoFactor, setTwoFactor] = useState<TwoFactorStatus | null>(null);
  const [twoFactorSetup, setTwoFactorSetup] = useState<TwoFactorSetup | null>(null);
  const [twoFactorQr, setTwoFactorQr] = useState("");
  const [twoFactorCode, setTwoFactorCode] = useState("");
  const [twoFactorPassword, setTwoFactorPassword] = useState("");
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);
  const [twoFactorBusy, setTwoFactorBusy] = useState(false);
  const [authSessions, setAuthSessions] = useState<AuthSessionItem[]>([]);
  const [trustedTwoFactorDevices, setTrustedTwoFactorDevices] = useState<TrustedTwoFactorDeviceItem[]>([]);
  const [authSessionsLoading, setAuthSessionsLoading] = useState(false);
  const [sessionActionId, setSessionActionId] = useState("");
  const [trustedDeviceActionId, setTrustedDeviceActionId] = useState("");
  const [updateChannel, setUpdateChannel] = useState<"stable"|"beta">("stable");
  const [updateStatus, setUpdateStatus] = useState<DesktopUpdateResult|null>(null);
  const [updateChecking, setUpdateChecking] = useState(false);
  const [autoStartEnabled, setAutoStartEnabled] = useState(false);
  const [autoStartSupported, setAutoStartSupported] = useState(false);
  const [autoStartBusy, setAutoStartBusy] = useState(false);
  const [startMinimizedEnabled, setStartMinimizedEnabled] = useState(false);
  const [startMinimizedBusy, setStartMinimizedBusy] = useState(false);
  const [diagnostics, setDiagnostics] = useState<ClientDiagnostics|null>(null);
  const [diagnosticsLoading, setDiagnosticsLoading] = useState(false);
  const [microphoneHealth, setMicrophoneHealth] = useState<MicrophoneHealth>("idle");
  const [microphoneLevel, setMicrophoneLevel] = useState(0);
  const [microphoneTestActive, setMicrophoneTestActive] = useState(false);
  const microphoneTestStreamRef = useRef<MediaStream | null>(null);
  const microphoneTestContextRef = useRef<AudioContext | null>(null);
  const microphoneTestFrameRef = useRef<number | null>(null);
  const microphoneTestTimerRef = useRef<number | null>(null);

  useEffect(() => {
    setProfileBioDraft(user.bio ?? "");
    setProfileStatusDraft(user.statusMessage ?? "");
  }, [user.id, user.bio, user.statusMessage]);

  const tabs = [
    { id: "account" as const, label: "Minha conta", icon: <UserCog size={18} />, group: "CONTA" },
    { id: "profile" as const, label: "Perfil", icon: <Palette size={18} /> },
    { id: "social" as const, label: "Social", icon: <Activity size={18} /> },
    { id: "privacy" as const, label: "Privacidade", icon: <Eye size={18} /> },
    { id: "voice" as const, label: "Voz e video", icon: <AudioLines size={18} />, group: "COMUNICACAO" },
    { id: "saved" as const, label: "Itens salvos", icon: <Bookmark size={18} /> },
    { id: "notifications" as const, label: "Notificacoes", icon: <BellRing size={18} />, group: "APLICATIVO" },
    { id: "appearance" as const, label: "Aparencia", icon: <Palette size={18} /> },
    ...(isGameOverlayAvailable() ? [{ id: "gaming" as const, label: "Jogos e sobreposicao", icon: <Gamepad2 size={18} />, group: "GAMING" }] : []),
    ...(isGingaDesktop() ? [{ id: "updates" as const, label: "Atualizacoes", icon: <Download size={18} /> }] : []),
    { id: "diagnostics" as const, label: "Diagnostico", icon: <Activity size={18} />, group: "SUPORTE" },
    { id: "developer" as const, label: "Desenvolvedor", icon: <Code2 size={18} />, group: "AVANCADO" },
    { id: "security" as const, label: "Seguranca", icon: <ShieldCheck size={18} />, group: "SEGURANCA" }
  ];

  useEffect(() => {
    if (!pttBindingCapture) return;

    const commitBinding = (binding: string | null) => {
      if (!binding) return;
      setPttBindingCapture(false);
      const next = { ...voice, pushToTalkKey: binding };
      setVoice(next);
      saveVoicePreferences(next);
      setNotice(`Push-to-Talk definido como ${formatPushToTalkBinding(binding)}.`);
      window.setTimeout(() => setNotice(""), 2200);
    };
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      // Durante a captura, a tecla escolhida nao deve acionar atalhos da UI.
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      commitBinding(bindingFromKeyboardEvent(event));
    };
    const onMouseDown = (event: MouseEvent) => {
      const target = event.target instanceof Element ? event.target.closest("[data-ptt-capture-control]") : null;
      if (target) return;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      commitBinding(bindingFromMouseEvent(event));
    };
    const onContextMenu = (event: MouseEvent) => {
      if (!pttBindingCapture) return;
      event.preventDefault();
      event.stopPropagation();
    };

    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("mousedown", onMouseDown, true);
    window.addEventListener("contextmenu", onContextMenu, true);
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("mousedown", onMouseDown, true);
      window.removeEventListener("contextmenu", onContextMenu, true);
    };
  }, [pttBindingCapture, voice]);


  useEffect(() => {
    if (tab !== "gaming" || !isGameOverlayAvailable()) return;
    let cancelled = false;
    setGamingBusy(true);
    Promise.all([
      api<GamingProfileResponse>("/api/gaming-profile/me"),
      detectDesktopGame()
    ]).then(([profileResult, detected]) => {
      if (cancelled) return;
      setGamingProfile(profileResult.profile.settings);
      setDetectedGame(detected);
      setGameOverlay(loadGameOverlayPreferences());
    }).catch((caught) => {
      if (!cancelled) setError(caught instanceof Error ? caught.message : "Nao foi possivel carregar jogos e sobreposicao");
    }).finally(() => { if (!cancelled) setGamingBusy(false); });
    return () => { cancelled = true; };
  }, [tab]);

  useEffect(() => {
    if (tab !== "updates") return;
    const bridge = desktopUpdaterBridge();
    if (!bridge?.isDesktop) return;
    let cancelled = false;
    setUpdateChecking(true);
    Promise.all([
      bridge.getUpdateChannel?.(),
      bridge.checkForUpdate?.(),
      bridge.getAutoStart?.(),
      bridge.getStartMinimized?.()
    ]).then(([channelResult, updateResult, autoStartResult, startMinimizedResult]) => {
      if (cancelled) return;
      if (channelResult?.channel) setUpdateChannel(channelResult.channel);
      if (updateResult) setUpdateStatus(updateResult);
      if (autoStartResult) {
        setAutoStartEnabled(Boolean(autoStartResult.enabled));
        setAutoStartSupported(Boolean(autoStartResult.supported));
      }
      if (startMinimizedResult) setStartMinimizedEnabled(Boolean(startMinimizedResult.enabled));
    }).catch((caught) => {
      if (!cancelled) setError(caught instanceof Error ? caught.message : "Falha ao carregar configuracoes do Desktop");
    }).finally(() => {
      if (!cancelled) setUpdateChecking(false);
    });
    return () => { cancelled = true; };
  }, [tab]);

  useEffect(() => {
    if (tab !== "diagnostics") return;
    void refreshDiagnostics();
  }, [tab]);

  useEffect(() => {
    if (tab !== "saved") return;
    setSavedLoading(true);
    Promise.all([
      api<{ bookmarks: SavedMessageItem[] }>("/api/bookmarks"),
      api<{ archives: SavedMessageItem[] }>("/api/archives"),
      api<{ scheduled: ScheduledMessageItem[] }>("/api/scheduled-messages"),
      api<{ tasks: PersonalTaskItem[] }>("/api/tasks")
    ]).then(([saved, archived, future, personalTasks]) => {
      setBookmarks(saved.bookmarks);
      setArchives(archived.archives);
      setScheduled(future.scheduled);
      setTasks(personalTasks.tasks);
    }).catch((caught) => setError(caught instanceof Error ? caught.message : "Nao foi possivel carregar os itens salvos"))
      .finally(() => setSavedLoading(false));
  }, [tab]);

  useEffect(() => {
    if (tab !== "voice" || !navigator.mediaDevices?.enumerateDevices) {
      stopMicrophoneTest();
      return;
    }

    let cancelled = false;
    const refresh = async () => {
      if (cancelled) return;
      await refreshVoiceDevices(false, true);
      try {
        if (navigator.permissions?.query) {
          const permission = await navigator.permissions.query({ name: "microphone" as PermissionName });
          if (!cancelled && permission.state === "denied") setMicrophoneHealth("denied");
        }
      } catch {
        // Alguns navegadores/Electron nao expoem a permissao de microfone via Permissions API.
      }
    };

    const onDeviceChange = () => { void refresh(); };
    void refresh();
    navigator.mediaDevices.addEventListener?.("devicechange", onDeviceChange);
    return () => {
      cancelled = true;
      navigator.mediaDevices.removeEventListener?.("devicechange", onDeviceChange);
      stopMicrophoneTest();
    };
  }, [tab, voice.microphoneDevice]);

  useEffect(() => {
    if (tab !== "security") return;
    let active = true;
    setAuthSessionsLoading(true);
    void Promise.all([
      api<{sessions:AuthSessionItem[]}>("/api/auth/sessions"),
      api<TwoFactorStatus>("/api/auth/2fa/status"),
      api<{devices:TrustedTwoFactorDeviceItem[]}>("/api/auth/2fa/trusted-devices")
    ]).then(([sessionResult, twoFactorResult, trustedDeviceResult]) => {
      if (!active) return;
      setAuthSessions(sessionResult.sessions);
      setTwoFactor(twoFactorResult);
      setTrustedTwoFactorDevices(trustedDeviceResult.devices);
    }).catch(() => {
      if (!active) return;
      setAuthSessions([]);
      setTrustedTwoFactorDevices([]);
      setTwoFactor(null);
    }).finally(() => { if (active) setAuthSessionsLoading(false); });
    return () => { active = false; };
  }, [tab]);


  useEffect(() => {
    if (tab !== "account" && tab !== "profile") return;
    let active = true;
    void api<GamingProfileResponse>("/api/gaming-profile/me")
      .then(({ profile }) => {
        if (!active) return;
        setProfileAvatarUrl(profile.avatarUrl);
        setProfileBannerUrl(profile.bannerUrl);
        setProfileAppearance(profile.appearance || defaultProfileAppearance(user));
      })
      .catch(() => undefined);
    return () => { active = false; };
  }, [tab]);

  async function uploadProfileAvatar(file: File | null) {
    if (!file || avatarBusy) return;
    setAvatarBusy(true);
    resetFeedback();
    try {
      const asset = await prepareSquareImageAsset(file, 512, 0.9);
      const response = await api<{ profile: { avatarUrl: string | null } }>("/api/gaming-profile/avatar", {
        method: "POST",
        headers: { "Content-Type": asset.mime },
        body: asset.blob
      });
      setProfileAvatarUrl(response.profile.avatarUrl);
      window.dispatchEvent(new CustomEvent("ginga:profile-local-update", { detail: response.profile }));
      setNotice("Avatar atualizado");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Nao foi possivel atualizar o avatar");
    } finally {
      setAvatarBusy(false);
    }
  }

  async function removeProfileAvatar() {
    if (avatarBusy) return;
    setAvatarBusy(true);
    resetFeedback();
    try {
      const response = await api<{ profile: { avatarUrl: string | null } }>("/api/gaming-profile/avatar", { method: "DELETE" });
      setProfileAvatarUrl(null);
      window.dispatchEvent(new CustomEvent("ginga:profile-local-update", { detail: response.profile }));
      setNotice("Avatar removido");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Nao foi possivel remover o avatar");
    } finally {
      setAvatarBusy(false);
    }
  }

  async function uploadProfileBanner(file: File | null) {
    if (!file || bannerBusy) return;
    setBannerBusy(true);
    resetFeedback();
    try {
      const asset = await prepareWideImageAsset(file, 1600, 600, 0.88);
      const response = await api<GamingProfileResponse>("/api/gaming-profile/banner", {
        method: "POST",
        headers: { "Content-Type": asset.mime },
        body: asset.blob
      });
      setProfileBannerUrl(response.profile.bannerUrl);
      setProfileAppearance(response.profile.appearance);
      window.dispatchEvent(new CustomEvent("ginga:profile-local-update", { detail: response.profile }));
      setNotice("Banner do perfil atualizado");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Nao foi possivel atualizar o banner");
    } finally {
      setBannerBusy(false);
    }
  }

  async function removeProfileBanner() {
    if (bannerBusy) return;
    setBannerBusy(true);
    resetFeedback();
    try {
      const response = await api<GamingProfileResponse>("/api/gaming-profile/banner", { method: "DELETE" });
      setProfileBannerUrl(null);
      setProfileAppearance(response.profile.appearance);
      window.dispatchEvent(new CustomEvent("ginga:profile-local-update", { detail: response.profile }));
      setNotice("Banner do perfil removido");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Nao foi possivel remover o banner");
    } finally {
      setBannerBusy(false);
    }
  }

  function updateProfileLink(index: number, patch: Partial<ProfileLink>) {
    setProfileAppearance((current) => ({
      ...current,
      links: current.links.map((link, linkIndex) => linkIndex === index ? { ...link, ...patch } : link)
    }));
  }

  function addProfileLink() {
    setProfileAppearance((current) => current.links.length >= 3 ? current : ({ ...current, links: [...current.links, { label: "Site", url: "https://" }] }));
  }

  function removeProfileLink(index: number) {
    setProfileAppearance((current) => ({ ...current, links: current.links.filter((_, linkIndex) => linkIndex !== index) }));
  }

  function microphoneErrorMessage(caught: unknown) {
    const name = caught instanceof DOMException ? caught.name : "";
    if (name === "NotAllowedError" || name === "PermissionDeniedError") {
      return "O Ginga nao tem permissao para usar o microfone. Libere o acesso nas configuracoes do Windows/navegador e tente novamente.";
    }
    if (name === "NotFoundError" || name === "DevicesNotFoundError") {
      return "Nenhum microfone foi encontrado. Conecte um dispositivo ou confira se ele esta habilitado no sistema.";
    }
    if (name === "NotReadableError" || name === "TrackStartError") {
      return "O microfone existe, mas nao conseguiu iniciar. Outro aplicativo pode estar usando o dispositivo ou o driver pode ter parado de responder.";
    }
    return caught instanceof Error ? caught.message : "Nao foi possivel acessar o microfone";
  }

  function stopMicrophoneTest(resetHealth = false) {
    if (microphoneTestFrameRef.current !== null) cancelAnimationFrame(microphoneTestFrameRef.current);
    microphoneTestFrameRef.current = null;
    if (microphoneTestTimerRef.current !== null) window.clearTimeout(microphoneTestTimerRef.current);
    microphoneTestTimerRef.current = null;
    microphoneTestStreamRef.current?.getTracks().forEach((track) => track.stop());
    microphoneTestStreamRef.current = null;
    void microphoneTestContextRef.current?.close().catch(() => undefined);
    microphoneTestContextRef.current = null;
    setMicrophoneTestActive(false);
    setMicrophoneLevel(0);
    if (resetHealth) setMicrophoneHealth("idle");
  }

  async function runMicrophoneTest() {
    if (microphoneTestActive) {
      stopMicrophoneTest();
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      setMicrophoneHealth("error");
      setError("Este navegador nao oferece acesso ao microfone.");
      return;
    }

    stopMicrophoneTest();
    setError("");
    setNotice("");
    setMicrophoneHealth("checking");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          deviceId: voice.microphoneDevice ? { exact: voice.microphoneDevice } : undefined,
          echoCancellation: true,
          noiseSuppression: voice.noiseSuppression,
          autoGainControl: true
        },
        video: false
      });
      const track = stream.getAudioTracks()[0];
      if (!track) throw new DOMException("Microfone sem faixa de audio", "NotFoundError");

      const context = new AudioContext();
      if (context.state === "suspended") await context.resume();
      const source = context.createMediaStreamSource(stream);
      const analyser = context.createAnalyser();
      analyser.fftSize = 512;
      analyser.smoothingTimeConstant = 0.72;
      source.connect(analyser);
      const data = new Uint8Array(analyser.fftSize);
      let bestLevel = 0;
      const startedAt = performance.now();

      microphoneTestStreamRef.current = stream;
      microphoneTestContextRef.current = context;
      setMicrophoneTestActive(true);

      track.addEventListener("ended", () => {
        setMicrophoneHealth("error");
        setError("O microfone foi desconectado ou parou de responder durante o teste.");
        stopMicrophoneTest();
      }, { once: true });

      const sample = () => {
        if (track.readyState !== "live") {
          setMicrophoneHealth("error");
          setError("O microfone parou de responder. Confira o cabo, o dispositivo padrao e o driver de audio.");
          stopMicrophoneTest();
          return;
        }
        analyser.getByteTimeDomainData(data);
        let sum = 0;
        for (const value of data) {
          const centered = (value - 128) / 128;
          sum += centered * centered;
        }
        const rms = Math.sqrt(sum / data.length);
        const level = Math.min(100, Math.round(rms * 360));
        bestLevel = Math.max(bestLevel, level);
        setMicrophoneLevel(level);
        if (bestLevel >= 5) setMicrophoneHealth("ok");
        else if (performance.now() - startedAt > 5500) setMicrophoneHealth("silent");
        microphoneTestFrameRef.current = requestAnimationFrame(sample);
      };
      sample();

      microphoneTestTimerRef.current = window.setTimeout(() => {
        if (bestLevel < 5) setMicrophoneHealth("silent");
        stopMicrophoneTest();
      }, 10000);
    } catch (caught) {
      const message = microphoneErrorMessage(caught);
      const name = caught instanceof DOMException ? caught.name : "";
      setMicrophoneHealth(name === "NotAllowedError" || name === "PermissionDeniedError" ? "denied" : name === "NotFoundError" || name === "DevicesNotFoundError" ? "missing" : "error");
      setError(message);
      stopMicrophoneTest();
    }
  }

  async function refreshVoiceDevices(requestAccess: boolean, silent = false) {
    if (!navigator.mediaDevices?.enumerateDevices) {
      setError("Este navegador nao permite selecionar dispositivos de audio e video");
      setMicrophoneHealth("error");
      return;
    }
    setVoiceRefreshing(true);
    if (!silent) setError("");
    try {
      let microphoneFailure = "";
      let cameraFailure = "";
      if (requestAccess && navigator.mediaDevices.getUserMedia) {
        try {
          const stream = await navigator.mediaDevices.getUserMedia({
            audio: { deviceId: voice.microphoneDevice ? { ideal: voice.microphoneDevice } : undefined },
            video: false
          });
          stream.getTracks().forEach((track) => track.stop());
        } catch (caught) {
          microphoneFailure = microphoneErrorMessage(caught);
          const name = caught instanceof DOMException ? caught.name : "";
          setMicrophoneHealth(name === "NotAllowedError" || name === "PermissionDeniedError" ? "denied" : name === "NotFoundError" || name === "DevicesNotFoundError" ? "missing" : "error");
        }
        try {
          const stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: true });
          stream.getTracks().forEach((track) => track.stop());
        } catch (caught) {
          cameraFailure = caught instanceof Error ? caught.message : "Camera indisponivel";
        }
      }
      const devices = await navigator.mediaDevices.enumerateDevices();
      const microphones = devices.filter((device) => device.kind === "audioinput");
      const speakers = devices.filter((device) => device.kind === "audiooutput");
      const cameras = devices.filter((device) => device.kind === "videoinput");
      setVoiceDevices({ microphones, speakers, cameras });

      const selectedMissing = Boolean(voice.microphoneDevice) && !microphones.some((device) => device.deviceId === voice.microphoneDevice);
      if (microphones.length === 0 || selectedMissing) {
        setMicrophoneHealth("missing");
      } else if (!microphoneFailure && microphoneHealth !== "ok" && microphoneHealth !== "silent") {
        setMicrophoneHealth("idle");
      }

      if (!silent) {
        if (microphoneFailure) setError(microphoneFailure);
        else if (cameraFailure) setNotice("Microfone liberado. A camera continua sem permissao ou indisponivel.");
        else setNotice(requestAccess ? "Microfone e camera liberados para o Ginga" : "Dispositivos atualizados");
      }
    } catch (caught) {
      if (!silent) setError(caught instanceof Error ? caught.message : "Nao foi possivel acessar os dispositivos");
    } finally {
      setVoiceRefreshing(false);
    }
  }

  function updateVoice(next: VoicePreferences, message = "Preferencias de voz salvas") {
    setVoice(next);
    saveVoicePreferences(next);
    setNotice(message);
    setError("");
  }

  async function changeVoiceDevice(kind: MediaDeviceKind, key: "microphoneDevice" | "outputDevice" | "cameraDevice", deviceId: string) {
    if (kind === "audioinput") {
      stopMicrophoneTest(true);
      setMicrophoneHealth("idle");
    }
    const next = { ...voice, [key]: deviceId };
    updateVoice(next, window.__gingaVoiceSession ? "Dispositivo alterado na chamada atual" : "Dispositivo salvo para a proxima chamada");
    try {
      await applyVoiceDevice(kind, deviceId);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Nao foi possivel trocar o dispositivo agora");
    }
  }

  async function updateGamingProfile(payload: Partial<GamingProfileSettings>, success: string) {
    if (gamingBusy) return;
    setGamingBusy(true); resetFeedback();
    try {
      const response = await api<GamingProfileResponse>("/api/gaming-profile/me", { method: "PATCH", body: JSON.stringify(payload) });
      setGamingProfile(response.profile.settings);
      setNotice(success);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Nao foi possivel atualizar a atividade de jogo");
    } finally { setGamingBusy(false); }
  }

  async function updateGameOverlay(next: GameOverlayPreferences, success = "Preferencias da sobreposicao salvas") {
    const saved = await saveGameOverlayPreferences(next);
    setGameOverlay(saved);
    setNotice(success); setError("");
  }

  async function refreshDetectedGame() {
    if (gamingBusy) return;
    setGamingBusy(true); resetFeedback();
    try {
      const result = await detectDesktopGame();
      setDetectedGame(result);
      setNotice(result.activity?.name ? `Jogo detectado: ${result.activity.name}` : "Nenhum jogo reconhecido em execucao agora");
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Falha ao detectar jogo"); }
    finally { setGamingBusy(false); }
  }

  async function showOverlayPreview() {
    try {
      const ok = await previewGameOverlay();
      if (ok) setNotice("Previa da sobreposicao exibida por alguns segundos");
      else setError("A sobreposicao esta disponivel apenas no Ginga Desktop");
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Nao foi possivel exibir a previa"); }
  }

  async function removeBookmark(messageId: string) {
    await api(`/api/messages/${messageId}/bookmark`, { method: "DELETE" });
    setBookmarks((items) => items.filter((item) => item.messageId !== messageId));
  }

  async function removeArchive(messageId: string) {
    await api(`/api/messages/${messageId}/archive`, { method: "DELETE" });
    setArchives((items) => items.filter((item) => item.messageId !== messageId));
  }

  async function cancelScheduled(id: string) {
    await api(`/api/scheduled-messages/${id}`, { method: "DELETE" });
    setScheduled((items) => items.filter((item) => item.id !== id));
  }

  async function toggleTask(task: PersonalTaskItem) {
    const result = await api<{ task: PersonalTaskItem }>(`/api/tasks/${task.id}`, { method: "PATCH", body: JSON.stringify({ completed: !task.completed }) });
    setTasks((items) => items.map((item) => item.id === task.id ? result.task : item));
  }

  async function deleteTask(id: string) {
    await api(`/api/tasks/${id}`, { method: "DELETE" });
    setTasks((items) => items.filter((item) => item.id !== id));
  }

  function resetFeedback() {
    setError("");
    setNotice("");
  }

  async function patchUser(payload: Record<string, unknown>, success: string) {
    setBusy(true);
    resetFeedback();
    try {
      const result = await api<{ token: string; user: User }>("/api/auth/me", {
        method: "PATCH",
        body: JSON.stringify(payload)
      });
      setToken(result.token);
      onSessionUpdate(result.token, result.user);
      setNotice(success);
      return result.user;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Nao foi possivel salvar as alteracoes");
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function saveAccount(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await patchUser({
      displayName: String(form.get("displayName") ?? "")
    }, "Conta atualizada");
  }

  async function saveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    resetFeedback();
    try {
      const account = await api<{ token: string; user: User }>("/api/auth/me", {
        method: "PATCH",
        body: JSON.stringify({
          bio: profileBioDraft,
          statusMessage: profileStatusDraft,
          avatarColor: profileAppearance.accentColor
        })
      });
      const links = profileAppearance.links
        .map((link) => ({ label: link.label.trim(), url: link.url.trim() }))
        .filter((link) => link.label && link.url && link.url !== "https://");
      const visual = await api<GamingProfileResponse>("/api/gaming-profile/me", {
        method: "PATCH",
        body: JSON.stringify({
          bio: profileBioDraft.trim() || null,
          customStatus: profileStatusDraft.trim() || null,
          accentColor: profileAppearance.accentColor,
          secondaryColor: profileAppearance.secondaryColor,
          profileTheme: profileAppearance.profileTheme,
          bannerPosition: profileAppearance.bannerPosition,
          pronouns: profileAppearance.pronouns?.trim() || null,
          profileLinks: links
        })
      });
      setToken(account.token);
      onSessionUpdate(account.token, account.user);
      setProfileAppearance(visual.profile.appearance);
      setProfileAvatarUrl(visual.profile.avatarUrl);
      setProfileBannerUrl(visual.profile.bannerUrl);
      window.dispatchEvent(new CustomEvent("ginga:profile-local-update", { detail: visual.profile }));
      setNotice("Perfil e personalizacao atualizados");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Nao foi possivel salvar o perfil");
    } finally {
      setBusy(false);
    }
  }

  async function savePrivacy(next = privacy) {
    const updated = await patchUser(next, "Privacidade atualizada");
    if (updated) {
      setPrivacy({
        allowFriendRequests: updated.allowFriendRequests ?? next.allowFriendRequests,
        allowDirectMessages: updated.allowDirectMessages ?? next.allowDirectMessages
      });
    }
  }

  function updateAppearance(next: AppearancePreferences) {
    setAppearance(next);
    saveAppearancePreferences(next);
    setNotice("Aparencia aplicada neste navegador");
    setError("");
  }

  function updateNotifications(next: NotificationPreferences) {
    setNotifications(next);
    saveNotificationPreferences(next);
    setNotice("Preferencias de notificacao salvas neste navegador");
    setError("");
  }

  async function enableDesktopNotifications() {
    const permission = await ensureNotificationPermission();
    if (permission === "granted") {
      setNotice(isGingaDesktop() ? "Notificacoes do Windows ativadas" : "Notificacoes do sistema autorizadas");
      setError("");
    } else {
      setError("O sistema nao autorizou notificacoes para o Ginga");
    }
  }

  async function testDesktopNotification() {
    const permission = await ensureNotificationPermission();
    if (permission !== "granted") {
      setError("Autorize as notificacoes antes de testar");
      return;
    }
    await showSystemNotification({
      title: "Ginga",
      body: notifications.showPreview ? "DedoMindinho: mensagem de teste das notificacoes." : "Voce recebeu uma nova mensagem.",
      silent: true,
      durationMs: 5000,
      taskbarBadge: false
    });
    setNotice("Notificacao de teste enviada");
    setError("");
  }

  async function requestOwnPasswordReset() {
    if (!user.email) {
      setError("Sua conta nao possui um e-mail disponivel para redefinicao.");
      return;
    }
    setBusy(true);
    resetFeedback();
    try {
      await api<{ ok: boolean; message: string }>("/api/auth/password-reset/request", {
        method: "POST",
        body: JSON.stringify({ email: user.email })
      });
      setNotice(`Enviamos um link de redefinicao para ${user.email}. Ele expira em 30 minutos.`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Nao foi possivel solicitar a redefinicao de senha");
    } finally {
      setBusy(false);
    }
  }

  async function logoutAllDevices() {
    setBusy(true);
    resetFeedback();
    try {
      const result = await api<{ token: string; user: User }>("/api/auth/logout-all", { method: "POST" });
      setToken(result.token);
      onSessionUpdate(result.token, result.user);
      setNotice("Todas as outras sessoes foram revogadas");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Nao foi possivel revogar as sessoes");
    } finally {
      setBusy(false);
    }
  }

  async function startTwoFactorSetup() {
    if (twoFactorBusy) return;
    setTwoFactorBusy(true); resetFeedback(); setRecoveryCodes([]);
    try {
      const setup = await api<TwoFactorSetup>("/api/auth/2fa/setup", { method: "POST" });
      setTwoFactorSetup(setup);
      setTwoFactorCode("");
      setTwoFactorQr(await QRCode.toDataURL(setup.otpauthUri, { width: 220, margin: 1, errorCorrectionLevel: "M" }));
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Nao foi possivel iniciar o 2FA"); }
    finally { setTwoFactorBusy(false); }
  }

  async function confirmTwoFactorSetup() {
    if (twoFactorBusy) return;
    const code = twoFactorCode.replace(/\D/g, "");
    if (!/^\d{6}$/.test(code)) { setError("Digite o codigo de 6 digitos do aplicativo autenticador."); return; }
    setTwoFactorBusy(true); resetFeedback();
    try {
      const result = await api<{ recoveryCodes:string[]; token:string; user:User }>("/api/auth/2fa/enable", { method: "POST", body: JSON.stringify({ code }) });
      setToken(result.token); onSessionUpdate(result.token, result.user);
      setTwoFactor({ available: true, enabled: true });
      setRecoveryCodes(result.recoveryCodes);
      setTwoFactorSetup(null); setTwoFactorQr(""); setTwoFactorCode("");
      setNotice("Verificacao em duas etapas ativada. Salve seus codigos de recuperacao.");
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Nao foi possivel ativar o 2FA"); }
    finally { setTwoFactorBusy(false); }
  }

  async function regenerateTwoFactorRecovery() {
    if (twoFactorBusy) return;
    const code = twoFactorCode.trim();
    if (code.length < 6) { setError("Informe um codigo do autenticador para gerar novos codigos de recuperacao."); return; }
    setTwoFactorBusy(true); resetFeedback();
    try {
      const result = await api<{ recoveryCodes:string[] }>("/api/auth/2fa/recovery-codes", { method: "POST", body: JSON.stringify({ code }) });
      setRecoveryCodes(result.recoveryCodes); setTwoFactorCode("");
      setNotice("Novos codigos gerados. Os anteriores deixaram de funcionar.");
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Nao foi possivel gerar novos codigos"); }
    finally { setTwoFactorBusy(false); }
  }

  async function turnOffTwoFactor() {
    if (twoFactorBusy) return;
    if (!twoFactorPassword || twoFactorCode.trim().length < 6) { setError("Informe sua senha atual e o codigo do autenticador para desativar o 2FA."); return; }
    setTwoFactorBusy(true); resetFeedback();
    try {
      const result = await api<{ token:string; user:User }>("/api/auth/2fa/disable", { method: "POST", body: JSON.stringify({ password: twoFactorPassword, code: twoFactorCode.trim() }) });
      setToken(result.token); onSessionUpdate(result.token, result.user);
      setTwoFactor({ available: true, enabled: false }); setTwoFactorPassword(""); setTwoFactorCode(""); setRecoveryCodes([]);
      setNotice("Verificacao em duas etapas desativada.");
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Nao foi possivel desativar o 2FA"); }
    finally { setTwoFactorBusy(false); }
  }

  async function revokeOwnSession(sessionId:string){if(sessionActionId)return;setSessionActionId(sessionId);resetFeedback();try{await api(`/api/auth/sessions/${encodeURIComponent(sessionId)}`,{method:"DELETE"});setAuthSessions(cur=>cur.map(i=>i.id===sessionId?{...i,revokedAt:new Date().toISOString()}:i));setNotice("Sessao desconectada");}catch(e){setError(e instanceof Error?e.message:"Falha ao desconectar sessao")}finally{setSessionActionId("")}}

  async function revokeTrustedTwoFactorDevice(deviceId:string){
    if(trustedDeviceActionId)return;
    setTrustedDeviceActionId(deviceId);resetFeedback();
    try{
      await api(`/api/auth/2fa/trusted-devices/${encodeURIComponent(deviceId)}`,{method:"DELETE"});
      setTrustedTwoFactorDevices(cur=>cur.filter(item=>item.id!==deviceId));
      setNotice("Dispositivo removido da lista de confiaveis. O 2FA sera solicitado no proximo login.");
    }catch(e){setError(e instanceof Error?e.message:"Falha ao revogar dispositivo confiavel")}finally{setTrustedDeviceActionId("")}
  }

  async function revokeAllTrustedTwoFactorDevices(){
    if(trustedDeviceActionId)return;
    setTrustedDeviceActionId("all");resetFeedback();
    try{
      await api("/api/auth/2fa/trusted-devices",{method:"DELETE"});
      setTrustedTwoFactorDevices([]);
      setNotice("Todos os dispositivos confiaveis foram revogados.");
    }catch(e){setError(e instanceof Error?e.message:"Falha ao revogar dispositivos confiaveis")}finally{setTrustedDeviceActionId("")}
  }
  async function checkDesktopUpdate(){const bridge=desktopUpdaterBridge();if(!bridge?.checkForUpdate)return;setUpdateChecking(true);try{setUpdateStatus(await bridge.checkForUpdate())}catch(e){setError(e instanceof Error?e.message:"Falha ao verificar atualizacao")}finally{setUpdateChecking(false)}}
  async function changeDesktopUpdateChannel(channel:"stable"|"beta"){const bridge=desktopUpdaterBridge();if(!bridge?.setUpdateChannel)return;setUpdateChecking(true);try{const r=await bridge.setUpdateChannel(channel);setUpdateChannel(channel);setUpdateStatus(r);setNotice(channel==="stable"?"Canal estavel selecionado":"Canal beta selecionado")}catch(e){setError(e instanceof Error?e.message:"Falha ao mudar canal")}finally{setUpdateChecking(false)}}
  async function changeDesktopAutoStart(enabled:boolean){
    const bridge=desktopUpdaterBridge();
    if(!bridge?.setAutoStart||autoStartBusy)return;
    setAutoStartBusy(true);setError("");setNotice("");
    try{
      const result=await bridge.setAutoStart(enabled);
      setAutoStartSupported(Boolean(result.supported));
      setAutoStartEnabled(Boolean(result.enabled));
      setNotice(result.enabled?"Ginga vai abrir com o Windows":"Inicializacao com o Windows desativada");
    }catch(e){setError(e instanceof Error?e.message:"Falha ao alterar a inicializacao com o Windows")}
    finally{setAutoStartBusy(false)}
  }
  async function changeDesktopStartMinimized(enabled:boolean){
    const bridge=desktopUpdaterBridge();
    if(!bridge?.setStartMinimized||startMinimizedBusy)return;
    setStartMinimizedBusy(true);setError("");setNotice("");
    try{
      const result=await bridge.setStartMinimized(enabled);
      setStartMinimizedEnabled(Boolean(result.enabled));
      setNotice(result.enabled?"O Ginga iniciara minimizado na bandeja":"O Ginga abrira a janela ao iniciar com o Windows");
    }catch(e){setError(e instanceof Error?e.message:"Falha ao alterar a inicializacao minimizada")}
    finally{setStartMinimizedBusy(false)}
  }
  async function refreshDiagnostics(){
    if(diagnosticsLoading)return;
    setDiagnosticsLoading(true);setError("");
    const started=performance.now();
    try{
      const bridge=desktopUpdaterBridge();
      const [server,desktop]=await Promise.all([
        api<ServerDiagnostics>("/api/system/diagnostics"),
        bridge?.getDiagnostics?.().catch(()=>null)??Promise.resolve(null)
      ]);
      setDiagnostics({
        collectedAt:new Date().toLocaleString("pt-BR"),
        webVersion:__GINGA_WEB_VERSION__,
        requestLatencyMs:Math.max(0,Math.round(performance.now()-started)),
        online:navigator.onLine,
        socketConnected,
        viewport:{width:window.innerWidth,height:window.innerHeight,dpr:Math.round(window.devicePixelRatio*100)/100},
        userAgent:navigator.userAgent,
        server,desktop
      });
    }catch(e){setError(e instanceof Error?e.message:"Nao foi possivel coletar o diagnostico")}
    finally{setDiagnosticsLoading(false)}
  }
  async function copyDiagnostics(){
    if(!diagnostics)return;
    try{await copyTextToClipboard(diagnosticsReport(diagnostics));setNotice("Diagnostico copiado. Pode enviar o texto ao suporte.");}
    catch{setError("Nao foi possivel copiar o diagnostico")};
  }

  return (
    <SettingsShell
      title="Configuracoes do usuario"
      subtitle={`@${user.username}`}
      tabs={tabs}
      activeTab={tab}
      onTabChange={(next) => { setTab(next); resetFeedback(); }}
      onClose={onClose}
      footer={<div className="settings-user-footer"><Avatar user={user} size="sm" /><div><strong>{user.displayName}</strong><span>@{user.username}</span></div></div>}
    >
      {error && <div className="inline-error">{error}</div>}
      {notice && <div className="inline-success"><Save size={15} /> {notice}</div>}

      {tab === "account" && (
        <form className="settings-page-section" onSubmit={saveAccount}>
          <div className="settings-page-title"><h1>Minha conta</h1><p>Dados usados para identificar sua conta em toda a plataforma.</p></div>
          <div className="account-hero-card">
            <div className="account-hero-banner" style={{ background: `linear-gradient(135deg, ${profileAppearance.accentColor}, ${profileAppearance.secondaryColor})` }}>{profileBannerUrl && <img src={profileBannerUrl} alt="" style={{ objectPosition: `50% ${profileAppearance.bannerPosition}%` }}/>}</div>
            <div className="account-hero-content"><Avatar user={user} size="xl" status="online" imageUrl={profileAvatarUrl} /><div><strong>{user.displayName}</strong><span>@{user.username}</span>{user.statusMessage && <small>{user.statusMessage}</small>}</div></div>
          </div>
          <div className="avatar-settings-card">
            <div className="avatar-settings-preview"><Avatar user={user} size="xl" imageUrl={profileAvatarUrl}/></div>
            <div className="avatar-settings-copy"><strong>Avatar do usuario</strong><span>Use PNG, JPG, WebP ou GIF. GIFs animados sao preservados; imagens estaticas sao otimizadas automaticamente.</span><small>Recomendado: imagem quadrada com pelo menos 256 x 256.</small></div>
            <div className="avatar-settings-actions">
              <label className={`secondary-button avatar-upload-button ${avatarBusy ? "disabled" : ""}`}><Camera size={16}/> {avatarBusy ? "Processando..." : "Enviar imagem"}<input type="file" accept="image/png,image/jpeg,image/webp,image/gif" disabled={avatarBusy} onChange={(event) => { const file = event.target.files?.[0] ?? null; event.currentTarget.value = ""; void uploadProfileAvatar(file); }}/></label>
              {profileAvatarUrl && <button type="button" className="ghost-danger-button" disabled={avatarBusy} onClick={() => void removeProfileAvatar()}><Trash2 size={15}/> Remover</button>}
            </div>
          </div>
          <div className="settings-form-grid">
            <label>Nome exibido<input name="displayName" defaultValue={user.displayName} minLength={2} maxLength={32} required /></label>
            <label>Nome de usuario<div className="input-prefix"><span>@</span><input value={user.username} readOnly aria-readonly="true" /></div><small>O nome de usuario e permanente e nao pode ser alterado depois do cadastro.</small></label>
            <label className="full">E-mail<input value={user.email ?? ""} readOnly /><small>Alteracao de e-mail sera adicionada com verificacao de seguranca.</small></label>
          </div>
          <div className="settings-action-row"><button className="primary-button" disabled={busy}><Save size={16} /> Salvar conta</button></div>
        </form>
      )}

      {tab === "profile" && (
        <form className="settings-page-section profile-personalization-page" onSubmit={saveProfile}>
          <div className="settings-page-title"><span className="settings-eyebrow">IDENTIDADE</span><h1>Perfil personalizado</h1><p>Monte um perfil com banner, tema, cores, recado, pronomes e links. A pre-visualizacao muda na hora.</p></div>

          <div className="profile-editor-layout profile-editor-layout-v4">
            <div className="profile-editor-fields">
              <div className="settings-section-card profile-banner-editor">
                <div className="settings-section-card-title"><Camera size={19}/><div><strong>Banner do perfil</strong><span>Imagem panoramica exibida no card e no perfil completo. Aceita GIF animado.</span></div></div>
                <div className="profile-banner-editor-preview" style={{ background: `linear-gradient(135deg, ${profileAppearance.accentColor}, ${profileAppearance.secondaryColor})` }}>
                  {profileBannerUrl && <img src={profileBannerUrl} alt="" style={{ objectPosition: `50% ${profileAppearance.bannerPosition}%` }}/>}
                </div>
                <div className="profile-banner-editor-actions">
                  <label className={`secondary-button avatar-upload-button ${bannerBusy ? "disabled" : ""}`}><Camera size={16}/> {bannerBusy ? "Processando..." : "Enviar banner"}<input type="file" accept="image/png,image/jpeg,image/webp,image/gif" disabled={bannerBusy} onChange={(event) => { const file = event.target.files?.[0] ?? null; event.currentTarget.value = ""; void uploadProfileBanner(file); }}/></label>
                  {profileBannerUrl && <button type="button" className="ghost-danger-button" disabled={bannerBusy} onClick={() => void removeProfileBanner()}><Trash2 size={15}/> Remover</button>}
                </div>
                <label>Enquadramento vertical<div className="settings-range-row"><input type="range" min="0" max="100" value={profileAppearance.bannerPosition} onChange={(event) => setProfileAppearance((current) => ({ ...current, bannerPosition: Number(event.target.value) }))}/><strong>{profileAppearance.bannerPosition}%</strong></div></label>
              </div>

              <div className="profile-personalization-grid">
                <label>Recado<input name="statusMessage" value={profileStatusDraft} onChange={(event) => setProfileStatusDraft(event.target.value)} maxLength={80} placeholder="Ex.: atendendo chamados ate 18h" /><small>Texto curto exibido logo abaixo do seu nome.</small></label>
                <label>Pronomes<input value={profileAppearance.pronouns ?? ""} maxLength={40} placeholder="Opcional" onChange={(event) => setProfileAppearance((current) => ({ ...current, pronouns: event.target.value || null }))}/></label>
                <label className="full">Sobre mim<textarea name="bio" value={profileBioDraft} onChange={(event) => setProfileBioDraft(event.target.value)} maxLength={240} rows={5} placeholder="Conte um pouco sobre voce..." /></label>
                <label>Cor principal<div className="color-input-row"><input type="color" value={profileAppearance.accentColor} onChange={(event) => setProfileAppearance((current) => ({ ...current, accentColor: event.target.value }))}/><span>{profileAppearance.accentColor}</span></div></label>
                <label>Cor secundaria<div className="color-input-row"><input type="color" value={profileAppearance.secondaryColor} onChange={(event) => setProfileAppearance((current) => ({ ...current, secondaryColor: event.target.value }))}/><span>{profileAppearance.secondaryColor}</span></div></label>
                <label>Tema do perfil<select value={profileAppearance.profileTheme} onChange={(event) => setProfileAppearance((current) => ({ ...current, profileTheme: event.target.value as ProfileTheme }))}><option value="AURORA">Aurora</option><option value="SOLID">Solido</option><option value="MIDNIGHT">Midnight</option></select></label>
              </div>

              <div className="settings-section-card profile-links-editor">
                <div className="settings-section-card-title"><ExternalLink size={19}/><div><strong>Links do perfil</strong><span>Adicione ate 3 atalhos publicos para site, portfolio ou redes.</span></div></div>
                {profileAppearance.links.map((link, index) => <div className="profile-link-editor-row" key={`${index}-${link.label}`}>
                  <input value={link.label} maxLength={24} placeholder="Nome" onChange={(event) => updateProfileLink(index, { label: event.target.value })}/>
                  <input value={link.url} maxLength={300} placeholder="https://..." onChange={(event) => updateProfileLink(index, { url: event.target.value })}/>
                  <button type="button" className="icon-button" aria-label="Remover link" onClick={() => removeProfileLink(index)}><Trash2 size={15}/></button>
                </div>)}
                {profileAppearance.links.length < 3 && <button type="button" className="secondary-button compact-button" onClick={addProfileLink}><ExternalLink size={15}/> Adicionar link</button>}
              </div>
            </div>

            <div className={`profile-preview-card profile-preview-card-v4 theme-${profileAppearance.profileTheme.toLowerCase()}`} style={{ "--profile-accent": profileAppearance.accentColor, "--profile-accent-2": profileAppearance.secondaryColor } as CSSProperties}>
              <div className="profile-preview-banner" style={{ background: `linear-gradient(135deg, ${profileAppearance.accentColor}, ${profileAppearance.secondaryColor})` }}>
                {profileBannerUrl && <img src={profileBannerUrl} alt="" style={{ objectPosition: `50% ${profileAppearance.bannerPosition}%` }}/>}
              </div>
              <Avatar user={user} size="xl" status="online" imageUrl={profileAvatarUrl} />
              <h3>{user.displayName}</h3><span>@{user.username}{profileAppearance.pronouns ? ` · ${profileAppearance.pronouns}` : ""}</span>
              {profileStatusDraft && <p className="profile-status-copy">{profileStatusDraft}</p>}
              <div className="profile-preview-about"><strong>SOBRE MIM</strong><p>{profileBioDraft || "Seu texto de apresentacao aparecera aqui."}</p></div>
              {profileAppearance.links.length > 0 && <div className="profile-preview-links">{profileAppearance.links.map((link, index) => <span key={`${link.label}-${index}`}>{link.label || "Link"}</span>)}</div>}
            </div>
          </div>
          <div className="settings-action-row"><button className="primary-button" disabled={busy}><Save size={16} /> Salvar perfil</button></div>
        </form>
      )}

      {tab === "social" && <UserSocialPanel user={user} />}

      {tab === "privacy" && (
        <section className="settings-page-section">
          <div className="settings-page-title"><h1>Privacidade</h1><p>Controle como outras pessoas podem iniciar contato com voce.</p></div>
          <div className="settings-toggle-list">
            <label className="settings-toggle-row">
              <div><strong>Solicitacoes de amizade</strong><span>Permitir que outros usuarios enviem uma solicitacao de amizade para voce.</span></div>
              <input type="checkbox" checked={privacy.allowFriendRequests} onChange={(event) => { const next = { ...privacy, allowFriendRequests: event.target.checked }; setPrivacy(next); void savePrivacy(next); }} />
            </label>
            <label className="settings-toggle-row">
              <div><strong>Novas conversas privadas</strong><span>Amigos e membros de espacos em comum podem iniciar uma nova conversa privada com voce. Conversas ja abertas continuam acessiveis.</span></div>
              <input type="checkbox" checked={privacy.allowDirectMessages} onChange={(event) => { const next = { ...privacy, allowDirectMessages: event.target.checked }; setPrivacy(next); void savePrivacy(next); }} />
            </label>
          </div>
        </section>
      )}

      {tab === "voice" && (
        <section className="settings-page-section voice-profile-settings voice-settings-v4">
          <div className="settings-page-title"><span className="settings-eyebrow">COMUNICACAO</span><h1>Voz e video</h1><p>Configure como voce fala, escuta e compartilha. O Ginga testa o microfone de verdade e avisa quando o dispositivo some, fica bloqueado ou nao entrega audio.</p></div>

          <div className="voice-settings-status-card voice-status-v4">
            <span className="voice-status-icon"><AudioLines size={22} /></span>
            <div><strong>{window.__gingaVoiceSession ? "Chamada conectada" : "Preferencias de voz"}</strong><span>{window.__gingaVoiceSession ? "Trocas de microfone e saida sao aplicadas na chamada atual." : "Estas preferencias entram automaticamente quando voce conectar em um canal."}</span></div>
            <button className="secondary-button compact-button" type="button" disabled={voiceRefreshing} onClick={() => void refreshVoiceDevices(true)}><RefreshCw className={voiceRefreshing ? "spin" : ""} size={15}/> Revisar permissoes</button>
          </div>

          {(microphoneHealth === "missing" || microphoneHealth === "denied" || microphoneHealth === "silent" || microphoneHealth === "error") && (
            <div className={`microphone-health-alert state-${microphoneHealth}`}>
              <span className="microphone-health-icon">{microphoneHealth === "denied" ? <LockKeyhole size={20}/> : microphoneHealth === "missing" ? <MicOff size={20}/> : <TriangleAlert size={20}/>}</span>
              <div>
                <strong>{microphoneHealth === "denied" ? "O Ginga nao consegue acessar seu microfone" : microphoneHealth === "missing" ? "Seu microfone nao esta disponivel" : microphoneHealth === "silent" ? "Nao estamos recebendo audio do seu microfone" : "Seu microfone parou de responder"}</strong>
                <span>{microphoneHealth === "denied" ? "Libere a permissao de microfone no Windows ou no navegador e clique em Revisar permissoes." : microphoneHealth === "missing" ? "Confira se o dispositivo esta conectado, habilitado no Windows e selecionado abaixo." : microphoneHealth === "silent" ? "Fale durante o teste. Se a barra continuar parada, confira mute fisico, dispositivo padrao, volume de entrada e driver." : "Tente outro dispositivo ou reconecte o microfone. Se continuar, revise o driver de audio."}</span>
              </div>
              <button type="button" className="secondary-button compact-button" onClick={() => void runMicrophoneTest()}>{microphoneTestActive ? "Parar teste" : "Testar novamente"}</button>
            </div>
          )}

          <div className="settings-section-card voice-diagnostic-card">
            <div className="settings-section-card-title"><Activity size={19}/><div><strong>Teste do microfone</strong><span>Fale normalmente por alguns segundos. A barra precisa reagir a sua voz.</span></div></div>
            <div className="microphone-diagnostic-row">
              <div className={`microphone-meter-shell state-${microphoneHealth}`}>
                <div className="microphone-meter-track"><i style={{ width: `${Math.max(2, microphoneLevel)}%` }} /></div>
                <div className="microphone-meter-copy">
                  <strong>{microphoneHealth === "checking" ? "Ouvindo..." : microphoneHealth === "ok" ? "Microfone funcionando" : microphoneHealth === "silent" ? "Sem audio detectado" : microphoneHealth === "missing" ? "Microfone ausente" : microphoneHealth === "denied" ? "Permissao bloqueada" : microphoneHealth === "error" ? "Falha no microfone" : "Pronto para testar"}</strong>
                  <span>{microphoneTestActive ? `${microphoneLevel}% de nivel detectado` : microphoneHealth === "ok" ? "O Ginga recebeu sinal de audio neste dispositivo." : "Clique em testar e fale perto do microfone."}</span>
                </div>
              </div>
              <button type="button" className={microphoneTestActive ? "secondary-button" : "primary-button"} onClick={() => void runMicrophoneTest()}>{microphoneTestActive ? <MicOff size={16}/> : <Mic size={16}/>} {microphoneTestActive ? "Parar" : "Testar microfone"}</button>
            </div>
          </div>

          <div className="settings-section-card">
            <div className="settings-section-card-title"><Mic size={19}/><div><strong>Dispositivos</strong><span>Escolha de onde o Ginga captura sua voz e onde reproduz o som.</span></div></div>
            <div className="settings-form-grid voice-device-settings-grid">
              <label>Microfone<select value={voice.microphoneDevice} onChange={(event) => void changeVoiceDevice("audioinput", "microphoneDevice", event.target.value)}><option value="">Padrao do sistema</option>{voiceDevices.microphones.map((device, index) => <option key={device.deviceId || `mic-${index}`} value={device.deviceId}>{device.label || `Microfone ${index + 1}`}</option>)}</select><small>{voiceDevices.microphones.length ? `${voiceDevices.microphones.length} dispositivo(s) de entrada detectado(s).` : "Nenhum microfone detectado agora."}</small></label>
              <label>Saida de audio<select value={voice.outputDevice} onChange={(event) => void changeVoiceDevice("audiooutput", "outputDevice", event.target.value)}><option value="">Padrao do sistema</option>{voiceDevices.speakers.map((device, index) => <option key={device.deviceId || `speaker-${index}`} value={device.deviceId}>{device.label || `Saida ${index + 1}`}</option>)}</select></label>
              <label>Camera<select value={voice.cameraDevice} onChange={(event) => void changeVoiceDevice("videoinput", "cameraDevice", event.target.value)}><option value="">Padrao do sistema</option>{voiceDevices.cameras.map((device, index) => <option key={device.deviceId || `camera-${index}`} value={device.deviceId}>{device.label || `Camera ${index + 1}`}</option>)}</select></label>
              <label>Volume geral<div className="settings-range-row"><input type="range" min="0" max="200" step="5" value={voice.outputVolume} onChange={(event) => updateVoice({ ...voice, outputVolume: Number(event.target.value) })}/><strong>{voice.outputVolume}%</strong></div><small>100% e o volume original. Acima disso aplica ganho local.</small></label>
            </div>
          </div>

          <div className="settings-section-card voice-input-card-v4">
            <div className="settings-section-card-title"><Headphones size={19}/><div><strong>Modo de entrada</strong><span>Voce escolhe como o microfone transmite durante chamadas.</span></div></div>
            <div className="voice-input-choice-grid" role="radiogroup" aria-label="Modo de entrada de voz">
              <button type="button" role="radio" aria-checked={voice.inputMode === "voice"} className={voice.inputMode === "voice" ? "active" : ""} onClick={() => updateVoice({ ...voice, inputMode: "voice" })}>
                <span className="voice-choice-icon"><Activity size={19}/></span><span><strong>Atividade de voz</strong><small>O microfone transmite automaticamente enquanto estiver ativado.</small></span><i />
              </button>
              <button type="button" role="radio" aria-checked={voice.inputMode === "ptt"} className={voice.inputMode === "ptt" ? "active" : ""} onClick={() => updateVoice({ ...voice, inputMode: "ptt" })}>
                <span className="voice-choice-icon"><Keyboard size={19}/></span><span><strong>Push-to-Talk</strong><small>O microfone so transmite enquanto voce segura a tecla escolhida.</small></span><i />
              </button>
            </div>
            {voice.inputMode === "ptt" && <div className={`voice-ptt-config-v4 ${pttBindingCapture ? "is-capturing" : ""}`}>
              <div><Keyboard size={17}/><span><strong>Atalho do Push-to-Talk</strong><small>Use qualquer tecla ou botao do mouse. Clique em alterar e pressione o controle que voce quer usar.</small></span></div>
              <div className="voice-ptt-binding-actions" data-ptt-capture-control>
                <kbd className="voice-ptt-current-binding">{pttBindingCapture ? "Pressione uma tecla ou botao..." : formatPushToTalkBinding(voice.pushToTalkKey)}</kbd>
                <button type="button" className={pttBindingCapture ? "secondary-button compact-button active" : "secondary-button compact-button"} onClick={() => setPttBindingCapture((current) => !current)}>{pttBindingCapture ? "Cancelar" : "Alterar"}</button>
              </div>
              <small className="voice-ptt-binding-hint">Teclas de letras, numeros, F1-F24, modificadores, setas, teclado numerico e botoes Mouse 1, 2, 3, 4, 5 ou adicionais sao aceitos. Mouse 1/2 pode interferir com cliques enquanto o PTT estiver ativo.</small>
            </div>}
            <div className="settings-toggle-list voice-processing-toggle">
              <label className="settings-toggle-row"><div><strong>Reducao de ruido</strong><span>Usa supressao de ruido, cancelamento de eco e ganho automatico do WebRTC.</span></div><input type="checkbox" checked={voice.noiseSuppression} onChange={(event) => updateVoice({ ...voice, noiseSuppression: event.target.checked })}/></label>
            </div>
          </div>

          <div className="settings-section-card">
            <div className="settings-section-card-title"><MonitorUp size={19}/><div><strong>Camera e transmissao</strong><span>Qualidade padrao para camera e compartilhamento de tela.</span></div></div>
            <div className="settings-form-grid">
              <label>Qualidade<select value={voice.quality} onChange={(event) => updateVoice({ ...voice, quality: event.target.value as VoicePreferences["quality"] })}><option value="480p">480p · leve</option><option value="720p">720p · equilibrado</option><option value="1080p">1080p · alta qualidade</option></select></label>
              <label>FPS<select value={voice.streamFps} onChange={(event) => updateVoice({ ...voice, streamFps: Number(event.target.value) as VoicePreferences["streamFps"] })}><option value={15}>15 FPS · economico</option><option value={30}>30 FPS · padrao</option><option value={60}>60 FPS · fluido</option></select></label>
            </div>
            <div className="voice-quality-note"><Camera size={17}/><span>720p/30 FPS continua sendo o equilibrio recomendado. 1080p/60 FPS exige mais upload e processamento.</span></div>
          </div>
        </section>
      )}

      {tab === "gaming" && (
        <section className="settings-page-section game-overlay-settings-page">
          <div className="settings-page-title"><span className="settings-eyebrow">GINGA GAMING</span><h1>Jogos e sobreposicao</h1><p>Mostre o jogo que voce esta jogando e acompanhe sua chamada sem precisar sair da partida.</p></div>

          <div className="settings-section-card game-presence-card">
            <div className="settings-section-card-title"><Gamepad2 size={19}/><div><strong>Presenca de jogo</strong><span>A deteccao acontece localmente no Desktop. O servidor recebe somente o nome do jogo reconhecido.</span></div></div>
            <div className="game-detection-status">
              <div className={detectedGame?.activity?.name ? "game-detection-icon active" : "game-detection-icon"}><Gamepad2 size={22}/></div>
              <div><small>DETECTADO AGORA</small><strong>{gamingBusy ? "Verificando..." : detectedGame?.activity?.name || "Nenhum jogo reconhecido"}</strong><span>{detectedGame?.activity?.name ? "A presenca pode aparecer no seu perfil se a opcao abaixo estiver ativa." : "Abra um jogo reconhecido e clique em Detectar agora."}</span></div>
              <button type="button" className="secondary-button compact-button" disabled={gamingBusy} onClick={() => void refreshDetectedGame()}><RefreshCw size={15}/> Detectar agora</button>
            </div>
            <div className="settings-toggle-list">
              <label className="settings-toggle-row"><div><strong>Mostrar o que estou jogando</strong><span>Exibe “Jogando ...” no seu perfil e para seus amigos. Ao ficar invisivel, a atividade some.</span></div><input type="checkbox" checked={Boolean(gamingProfile?.showGameActivity)} disabled={!gamingProfile || gamingBusy} onChange={(event) => void updateGamingProfile({ showGameActivity:event.target.checked }, event.target.checked ? "Atividade de jogo visivel" : "Atividade de jogo ocultada")}/></label>
              <label className="settings-toggle-row"><div><strong>Detectar automaticamente</strong><span>O Ginga Desktop verifica jogos conhecidos em segundo plano sem enviar sua lista de processos.</span></div><input type="checkbox" checked={Boolean(gamingProfile?.autoDetectGame)} disabled={!gamingProfile || gamingBusy} onChange={(event) => void updateGamingProfile({ autoDetectGame:event.target.checked }, event.target.checked ? "Deteccao automatica ativada" : "Deteccao automatica desativada")}/></label>
            </div>
          </div>

          <div className="settings-section-card game-overlay-card">
            <div className="settings-section-card-title"><MonitorUp size={19}/><div><strong>Sobreposicao no jogo</strong><span>Uma camada leve do Ginga fica acima do jogo mostrando chamada e atividade. Nao injeta codigo no processo do jogo.</span></div></div>
            <div className="settings-toggle-list">
              <label className="settings-toggle-row"><div><strong>Ativar sobreposicao</strong><span>Aparece automaticamente quando um jogo reconhecido estiver aberto. Atalho global: Ctrl + Shift + O.</span></div><input type="checkbox" checked={gameOverlay.enabled} onChange={(event) => void updateGameOverlay({ ...gameOverlay, enabled:event.target.checked })}/></label>
              <label className="settings-toggle-row"><div><strong>Mostrar jogo</strong><span>Mostra o nome do jogo detectado no topo da sobreposicao.</span></div><input type="checkbox" checked={gameOverlay.showGame} disabled={!gameOverlay.enabled} onChange={(event) => void updateGameOverlay({ ...gameOverlay, showGame:event.target.checked })}/></label>
              <label className="settings-toggle-row"><div><strong>Mostrar chamada de voz</strong><span>Mostra participantes, destaque de quem esta falando, mute e Push-to-Talk.</span></div><input type="checkbox" checked={gameOverlay.showVoice} disabled={!gameOverlay.enabled} onChange={(event) => void updateGameOverlay({ ...gameOverlay, showVoice:event.target.checked })}/></label>
              <label className="settings-toggle-row"><div><strong>Somente durante uma chamada</strong><span>Esconde a sobreposicao quando voce estiver jogando sem estar conectado a uma sala de voz.</span></div><input type="checkbox" checked={gameOverlay.showOnlyInVoice} disabled={!gameOverlay.enabled} onChange={(event) => void updateGameOverlay({ ...gameOverlay, showOnlyInVoice:event.target.checked })}/></label>
            </div>
            <div className="settings-form-grid game-overlay-form-grid">
              <label>Posicao<select value={gameOverlay.position} disabled={!gameOverlay.enabled} onChange={(event) => void updateGameOverlay({ ...gameOverlay, position:event.target.value as GameOverlayPreferences["position"] })}><option value="top-left">Superior esquerdo</option><option value="top-right">Superior direito</option><option value="bottom-left">Inferior esquerdo</option><option value="bottom-right">Inferior direito</option></select></label>
              <label>Opacidade<div className="settings-range-row"><input type="range" min="55" max="100" step="5" disabled={!gameOverlay.enabled} value={Math.round(gameOverlay.opacity * 100)} onChange={(event) => void updateGameOverlay({ ...gameOverlay, opacity:Number(event.target.value) / 100 }, "Opacidade atualizada")}/><strong>{Math.round(gameOverlay.opacity * 100)}%</strong></div></label>
            </div>
            <div className="game-overlay-actions"><button type="button" className="secondary-button" onClick={() => void showOverlayPreview()} disabled={!gameOverlay.enabled}><Eye size={16}/> Testar sobreposicao</button><span>Funciona melhor em jogos em janela ou janela sem borda. Alguns jogos em fullscreen exclusivo/anti-cheat podem impedir camadas externas.</span></div>
          </div>
        </section>
      )}

      {tab === "saved" && (
        <section className="settings-page-section">
          <div className="settings-page-title"><h1>Itens salvos</h1></div>
          {savedLoading && <div className="saved-empty">Carregando...</div>}
          {!savedLoading && <div className="saved-items-grid">
            <div className="saved-items-block"><header><Bookmark size={17}/><strong>Salvos</strong><span>{bookmarks.length}</span></header>{bookmarks.length === 0 ? <div className="saved-empty">Nenhuma mensagem salva.</div> : bookmarks.map((item)=><article key={item.messageId}><div><strong>#{item.message.channel.name} · {item.message.author.displayName}</strong><p>{item.message.content || "Mensagem com anexo"}</p></div><button onClick={()=>void removeBookmark(item.messageId)} aria-label="Remover dos salvos"><Trash2 size={15}/></button></article>)}</div>
            <div className="saved-items-block"><header><Archive size={17}/><strong>Arquivadas</strong><span>{archives.length}</span></header>{archives.length === 0 ? <div className="saved-empty">Nenhuma mensagem arquivada.</div> : archives.map((item)=><article key={item.messageId}><div><strong>#{item.message.channel.name} · {item.message.author.displayName}</strong><p>{item.message.content || "Mensagem com anexo"}</p></div><button onClick={()=>void removeArchive(item.messageId)} aria-label="Desarquivar"><Trash2 size={15}/></button></article>)}</div>
            <div className="saved-items-block full"><header><CalendarClock size={17}/><strong>Agendadas</strong><span>{scheduled.length}</span></header>{scheduled.length === 0 ? <div className="saved-empty">Nenhuma mensagem agendada.</div> : scheduled.map((item)=><article key={item.id}><div><strong>#{item.channel.name} · {new Date(item.scheduledFor).toLocaleString("pt-BR")}</strong><p>{item.content}</p></div><button onClick={()=>void cancelScheduled(item.id)} aria-label="Cancelar agendamento"><Trash2 size={15}/></button></article>)}</div>
          </div>}
        </section>
      )}

      {tab === "notifications" && (
        <section className="settings-page-section">
          <div className="settings-page-title"><h1>Notificacoes</h1></div>
          <div className="settings-toggle-list">
            <label className="settings-toggle-row">
              <div><strong>Mensagens privadas</strong><span>Avisar quando chegar uma DM enquanto o Ginga estiver em segundo plano.</span></div>
              <input type="checkbox" checked={notifications.desktopMessages} onChange={(event) => updateNotifications({ ...notifications, desktopMessages: event.target.checked })} />
            </label>
            <label className="settings-toggle-row">
              <div><strong>Mensagens dos servidores</strong><span>Avisar sobre novas mensagens dos servidores em segundo plano. O modo do servidor pode limitar para mencoes ou Silencioso.</span></div>
              <input type="checkbox" checked={notifications.desktopChannelMessages} onChange={(event) => updateNotifications({ ...notifications, desktopChannelMessages: event.target.checked })} />
            </label>
            <label className="settings-toggle-row">
              <div><strong>Mencoes diretas</strong><span>Avisar quando alguem escrever @seuusuario.</span></div>
              <input type="checkbox" checked={notifications.desktopMentions} onChange={(event) => updateNotifications({ ...notifications, desktopMentions: event.target.checked })} />
            </label>
            <label className="settings-toggle-row">
              <div><strong>@todos</strong><span>Avisar quando alguem com permissao mencionar todos no espaco.</span></div>
              <input type="checkbox" checked={notifications.desktopEveryoneMentions} onChange={(event) => updateNotifications({ ...notifications, desktopEveryoneMentions: event.target.checked })} />
            </label>
            <label className="settings-toggle-row">
              <div><strong>Chamadas privadas</strong><span>Mostrar quem esta chamando mesmo com a janela minimizada.</span></div>
              <input type="checkbox" checked={notifications.desktopCalls} onChange={(event) => updateNotifications({ ...notifications, desktopCalls: event.target.checked })} />
            </label>
            <label className="settings-toggle-row">
              <div><strong>Previa da mensagem</strong><span>Exibir um trecho curto da mensagem na notificacao do Windows.</span></div>
              <input type="checkbox" checked={notifications.showPreview} onChange={(event) => updateNotifications({ ...notifications, showPreview: event.target.checked })} />
            </label>
            <label className="settings-toggle-row">
              <div><strong>Sons do Ginga</strong><span>Mensagens, mencoes, chamadas e entrada/saida de voz. O modo Silencioso de cada servidor continua sendo respeitado.</span></div>
              <input type="checkbox" checked={notifications.playSound} onChange={(event) => updateNotifications({ ...notifications, playSound: event.target.checked })} />
            </label><div className="notification-sound-grid">{[["soundMessages","Mensagens"],["soundMentions","Mencoes"],["soundCalls","Chamadas"],["soundVoiceEvents","Entrada/saida de voz"]].map(([key,label])=><label key={key}><span>{label}</span><input type="checkbox" disabled={!notifications.playSound} checked={Boolean(notifications[key as keyof NotificationPreferences])} onChange={e=>updateNotifications({...notifications,[key]:e.target.checked})}/></label>)}</div>
          </div>
          <div className="notification-permission-card">
            <BellRing size={24} />
            <div><strong>{isGingaDesktop() ? "Notificacoes do Windows" : "Permissao do navegador"}</strong><span>{isGingaDesktop() ? "O Ginga Desktop usa as notificacoes nativas do Windows e fecha o aviso automaticamente em cerca de 5 segundos." : ("Notification" in window ? `Estado atual: ${Notification.permission}` : "Nao suportado neste navegador")}</span></div>
            <div className="notification-actions">
              {!isGingaDesktop() && "Notification" in window && Notification.permission !== "granted" && <button className="secondary-button" type="button" onClick={() => void enableDesktopNotifications()}>Autorizar</button>}
              <button className="secondary-button" type="button" onClick={() => void testDesktopNotification()}>Testar</button>
            </div>
          </div>
        </section>
      )}

      {tab === "appearance" && (
        <section className="settings-page-section">
          <div className="settings-page-title"><h1>Aparencia</h1><p>Preferencias locais salvas somente neste navegador.</p></div>
          <div className="appearance-card-grid">
            {(["dark", "midnight", "light"] as ThemePreference[]).map((theme) => (
              <button key={theme} className={`appearance-choice ${appearance.theme === theme ? "active" : ""}`} onClick={() => updateAppearance({ ...appearance, theme })}>
                <span className={`theme-preview theme-${theme}`}><i /><i /><i /></span>
                <strong>{theme === "dark" ? "Escuro" : theme === "midnight" ? "Meia-noite" : "Claro"}</strong>
              </button>
            ))}
          </div>
          <div className="settings-control-block">
            <label>Densidade<select value={appearance.density} onChange={(event) => updateAppearance({ ...appearance, density: event.target.value as DensityPreference })}><option value="comfortable">Confortavel</option><option value="compact">Compacta</option></select></label>
            <label>Escala do texto<select value={appearance.fontScale} onChange={(event) => updateAppearance({ ...appearance, fontScale: Number(event.target.value) as 90 | 100 | 110 | 120 | 130 | 140 })}><option value={90}>90% · Compacto</option><option value={100}>100% · Padrao</option><option value={110}>110% · Confortavel</option><option value={120}>120% · Grande</option><option value={130}>130% · Muito grande</option><option value={140}>140% · Acessibilidade</option></select><small>Amplia somente os textos do Ginga, sem usar o zoom do navegador e sem quebrar o layout.</small></label>
            <label className="settings-toggle-row compact-toggle"><div><strong>Reduzir animacoes</strong><span>Diminui transicoes e movimentos na interface.</span></div><input type="checkbox" checked={appearance.reducedMotion} onChange={(event) => updateAppearance({ ...appearance, reducedMotion: event.target.checked })} /></label>
          </div>
        </section>
      )}

      {tab === "updates" && (
        <section className="settings-page-section desktop-update-settings">
          <div className="settings-page-title"><h1>Desktop e atualizacoes</h1><p>Inicializacao com o Windows, canal de release e verificacao manual.</p></div>
          <div className="desktop-startup-card">
            <span className="desktop-startup-icon"><MonitorUp size={22}/></span>
            <div><strong>Abrir Ginga com o Windows</strong><span>Inicia automaticamente o aplicativo quando voce entrar na sua conta do Windows.</span></div>
            <label className="desktop-startup-switch" title={autoStartSupported ? "Abrir Ginga com o Windows" : "Disponivel somente no Ginga Desktop para Windows"}>
              <input type="checkbox" checked={autoStartEnabled} disabled={!autoStartSupported || autoStartBusy} onChange={(event)=>void changeDesktopAutoStart(event.target.checked)}/><i/>
            </label>
          </div>
          <div className={`desktop-startup-card ${!autoStartEnabled?"disabled":""}`}>
            <span className="desktop-startup-icon"><Download size={22}/></span>
            <div><strong>Iniciar minimizado</strong><span>Quando o Ginga abrir junto com o Windows, mantem a janela na bandeja ate voce clicar no icone.</span></div>
            <label className="desktop-startup-switch" title={autoStartEnabled ? "Iniciar minimizado" : "Ative primeiro Abrir com o Windows"}>
              <input type="checkbox" checked={startMinimizedEnabled} disabled={!autoStartSupported || !autoStartEnabled || startMinimizedBusy} onChange={(event)=>void changeDesktopStartMinimized(event.target.checked)}/><i/>
            </label>
          </div>
          <div className="desktop-update-hero"><Download size={24}/><div><strong>{updateStatus?.available?`Ginga ${updateStatus.version} disponivel`:updateChecking?"Verificando...":"Ginga atualizado"}</strong><span>Versao atual {updateStatus?.currentVersion??"-"}</span></div><button type="button" className="secondary-button" disabled={updateChecking} onClick={()=>void checkDesktopUpdate()}><RefreshCw size={15}/> Verificar</button></div>
          <div className="update-channel-choice"><button type="button" className={updateChannel==="stable"?"active":""} onClick={()=>void changeDesktopUpdateChannel("stable")}><strong>Estavel</strong><span>Somente releases finais</span></button><button type="button" className={updateChannel==="beta"?"active":""} onClick={()=>void changeDesktopUpdateChannel("beta")}><strong>Beta</strong><span>Recebe prereleases assinadas</span></button></div>
          {updateStatus?.releaseNotes&&<pre className="update-release-notes">{updateStatus.releaseNotes}</pre>}
        </section>
      )}

      {tab === "diagnostics" && (
        <section className="settings-page-section diagnostics-settings">
          <div className="settings-page-title"><span className="settings-eyebrow">SUPORTE</span><h1>Diagnostico do Ginga</h1><p>Veja rapidamente se Web, API, banco, voz e Desktop estao conversando corretamente.</p></div>
          <div className="diagnostics-actions"><button type="button" className="secondary-button" disabled={diagnosticsLoading} onClick={()=>void refreshDiagnostics()}><RefreshCw size={15}/>{diagnosticsLoading?" Testando...":" Testar novamente"}</button><button type="button" className="primary-button" disabled={!diagnostics} onClick={()=>void copyDiagnostics()}><Copy size={15}/> Copiar diagnostico</button></div>
          {diagnosticsLoading&&!diagnostics&&<div className="diagnostics-loading"><Activity size={18}/><span>Consultando servidor e cliente...</span></div>}
          {diagnostics&&<>
            <div className="diagnostics-summary">
              <article className={diagnostics.server.status==="healthy"&&diagnostics.server.version===diagnostics.webVersion?"ok":"warn"}><Activity size={20}/><div><small>API / WEB</small><strong>{diagnostics.server.version!==diagnostics.webVersion?"Versoes divergentes":diagnostics.server.status==="healthy"?"Saudavel":"Degradada"}</strong><span>API {diagnostics.server.version} · Web {diagnostics.webVersion} · {diagnostics.requestLatencyMs} ms</span></div></article>
              <article className={diagnostics.server.database.ok?"ok":"danger"}><ShieldCheck size={20}/><div><small>POSTGRESQL</small><strong>{diagnostics.server.database.ok?"Conectado":"Falha"}</strong><span>{diagnostics.server.database.latencyMs} ms</span></div></article>
              <article className={diagnostics.server.livekit.ok?"ok":"danger"}><Headphones size={20}/><div><small>VOZ / LIVEKIT</small><strong>{diagnostics.server.livekit.ok?"Disponivel":"Indisponivel"}</strong><span>{diagnostics.server.livekit.latencyMs} ms</span></div></article>
              <article className={!diagnostics.online?"danger":diagnostics.desktop&&diagnostics.desktop.appVersion!==diagnostics.server.version?"warn":"ok"}><MonitorUp size={20}/><div><small>CLIENTE</small><strong>{diagnostics.desktop?`Desktop ${diagnostics.desktop.appVersion}`:"Web"}{diagnostics.desktop&&diagnostics.desktop.appVersion!==diagnostics.server.version?" · versao divergente":""}</strong><span>{diagnostics.viewport.width}x{diagnostics.viewport.height} · DPR {diagnostics.viewport.dpr}</span></div></article>
            </div>
            <div className="diagnostics-detail-grid">
              <div className="settings-section-card"><div className="settings-section-card-title"><Activity size={18}/><div><strong>Servidor</strong><span>Informacoes seguras para suporte.</span></div></div><dl><div><dt>Web</dt><dd>{diagnostics.webVersion}</dd></div><div><dt>API</dt><dd>{diagnostics.server.version}</dd></div><div><dt>Uptime</dt><dd>{formatDuration(diagnostics.server.uptimeSeconds)}</dd></div><div><dt>Socket.IO cliente</dt><dd>{diagnostics.socketConnected?"Conectado":"Desconectado"}</dd></div><div><dt>Armazenamento</dt><dd>{diagnostics.server.storage.ok?`${diagnostics.server.storage.usedPercent}% usado`:"Falha"}</dd></div></dl></div>
              <div className="settings-section-card"><div className="settings-section-card-title"><MonitorUp size={18}/><div><strong>Cliente</strong><span>{diagnostics.desktop?"Electron Desktop":"Navegador Web"}</span></div></div><dl>{diagnostics.desktop?<><div><dt>Plataforma</dt><dd>{diagnostics.desktop.platform}-{diagnostics.desktop.arch}</dd></div><div><dt>Electron</dt><dd>{diagnostics.desktop.electron}</dd></div><div><dt>Zoom</dt><dd>{diagnostics.desktop.window?`${Math.round(diagnostics.desktop.window.zoomFactor*100)}%`:"-"}</dd></div><div><dt>Escala do monitor</dt><dd>{Math.round(diagnostics.desktop.display.scaleFactor*100)}%</dd></div><div><dt>Updater</dt><dd>{diagnostics.desktop.updateChannel}</dd></div></>:<><div><dt>Navegador</dt><dd>{navigator.userAgent.split(" ").slice(-2).join(" ")}</dd></div><div><dt>Online</dt><dd>{diagnostics.online?"Sim":"Nao"}</dd></div></>}</dl></div>
            </div>
            <div className="diagnostics-footnote"><TriangleAlert size={15}/><span>O relatorio nao inclui senha, token de sessao, chave 2FA ou conteudo de mensagens.</span></div>
          </>}
        </section>
      )}

      {tab === "developer" && (
        <section className="settings-page-section developer-user-settings">
          <div className="settings-page-title"><span className="settings-eyebrow">AVANCADO</span><h1>Desenvolvedor</h1><p>Ferramentas para criar bots e integracoes sem depender de nomes que podem mudar.</p></div>
          <div className="developer-mode-hero">
            <span className="developer-mode-icon"><Code2 size={24}/></span>
            <div><strong>Modo Desenvolvedor</strong><span>Quando ativado, o Ginga exibe acoes de copiar ID nos menus de servidor, canal, categoria, usuario, conversa e cargo.</span></div>
            <label className="developer-mode-switch"><input type="checkbox" checked={developerMode} onChange={(event) => { const enabled = event.target.checked; setDeveloperMode(enabled); saveDeveloperPreferences({ enabled }); setNotice(enabled ? "Modo Desenvolvedor ativado" : "Modo Desenvolvedor desativado"); }}/><span /></label>
          </div>
          <div className="developer-id-principle">
            <div><strong>IDs sao fixos</strong><p>Renomear canais, servidores, cargos ou o nome exibido de um usuario nao altera seus IDs. O @usuario da conta e permanente.</p></div>
            <button type="button" className="secondary-button compact-button" onClick={() => void copyTextToClipboard(user.id).then(() => setNotice("Seu ID foi copiado")).catch(() => setError("Nao foi possivel copiar seu ID"))}><Copy size={15}/> Copiar meu ID</button>
          </div>
          <div className="developer-id-grid">
            <article><strong>Usuario</strong><code>{user.id}</code><span>O ID e permanente. O @usuario tambem nao pode ser alterado depois do cadastro.</span></article>
            <article><strong>Canal</strong><code>channel.id</code><span>Mover de categoria ou renomear o canal nao muda o identificador.</span></article>
            <article><strong>Cargo</strong><code>role.id</code><span>Cor, nome, posicao e permissoes podem mudar sem quebrar o bot.</span></article>
            <article><strong>Servidor</strong><code>guild.id</code><span>O ID identifica o servidor durante toda a vida dele.</span></article>
          </div>
          <div className="inline-alert info developer-id-tip"><Code2 size={17}/><div><strong>Como pegar um ID</strong><span>Ative o modo acima, clique com o botao direito no objeto e use <b>Copiar ID</b>. Em Cargos e permissoes, o ID aparece no editor do cargo selecionado.</span></div></div>
        </section>
      )}

      {tab === "security" && (
        <section className="settings-page-section user-security-page">
          <div className="settings-page-title"><span className="settings-eyebrow">PROTECAO DA CONTA</span><h1>Seguranca</h1><p>Proteja seu acesso, confira dispositivos conectados e recupere a conta com seguranca.</p></div>

          <div className={`two-factor-security-card ${twoFactor?.enabled ? "enabled" : ""}`}>
            <span className="two-factor-security-icon"><ShieldCheck size={26}/></span>
            <div className="two-factor-security-copy">
              <small>VERIFICACAO EM DUAS ETAPAS</small>
              <strong>{twoFactor?.enabled ? "2FA ativado" : "Proteja sua conta contra invasoes"}</strong>
              <p>{twoFactor?.enabled ? "Mesmo que alguem descubra sua senha, ainda precisara do codigo do seu aplicativo autenticador para entrar." : "Ative o 2FA para impedir que uma senha vazada ou roubada seja suficiente para invadir sua conta."}</p>
            </div>
            {!twoFactor?.enabled && <button type="button" className="primary-button" disabled={twoFactorBusy || twoFactor?.available === false} onClick={() => void startTwoFactorSetup()}><KeyRound size={16}/> Ativar 2FA</button>}
          </div>

          {twoFactor?.available === false && <div className="inline-alert warning"><TriangleAlert size={17}/><div><strong>2FA ainda nao esta disponivel</strong><span>O administrador precisa concluir a configuracao de seguranca desta instalacao.</span></div></div>}

          {twoFactorSetup && <div className="two-factor-setup-panel">
            <div className="two-factor-setup-steps"><b>1</b><div><strong>Abra seu autenticador</strong><span>Google Authenticator, Microsoft Authenticator, Authy ou outro aplicativo compativel com TOTP.</span></div></div>
            <div className="two-factor-setup-body">
              {twoFactorQr && <img src={twoFactorQr} alt="QR Code para configurar o autenticador"/>}
              <div><strong>Escaneie o QR Code</strong><span>Se preferir configurar manualmente, use esta chave:</span><code>{twoFactorSetup.secret}</code><button type="button" className="secondary-button compact-button" onClick={() => void copyTextToClipboard(twoFactorSetup.secret).then(() => setNotice("Chave do 2FA copiada"))}><Copy size={14}/> Copiar chave</button></div>
            </div>
            <div className="two-factor-setup-steps"><b>2</b><div><strong>Confirme o codigo</strong><span>Digite o codigo de 6 digitos que aparece no aplicativo.</span></div></div>
            <div className="two-factor-inline-form"><input value={twoFactorCode} onChange={(event) => setTwoFactorCode(event.target.value.replace(/\D/g, "").slice(0, 6))} inputMode="numeric" autoComplete="one-time-code" placeholder="000000"/><button type="button" className="primary-button" disabled={twoFactorBusy} onClick={() => void confirmTwoFactorSetup()}>Confirmar e ativar</button><button type="button" className="secondary-button" disabled={twoFactorBusy} onClick={() => { setTwoFactorSetup(null); setTwoFactorQr(""); setTwoFactorCode(""); }}>Cancelar</button></div>
          </div>}

          {recoveryCodes.length > 0 && <div className="two-factor-recovery-panel"><div><strong>Codigos de recuperacao</strong><span>Guarde estes codigos em um lugar seguro. Cada codigo funciona uma unica vez caso voce perca o autenticador.</span></div><div className="two-factor-recovery-grid">{recoveryCodes.map((code) => <code key={code}>{code}</code>)}</div><button type="button" className="secondary-button compact-button" onClick={() => void copyTextToClipboard(recoveryCodes.join("\n")).then(() => setNotice("Codigos de recuperacao copiados"))}><Copy size={14}/> Copiar todos</button></div>}

          {twoFactor?.enabled && !twoFactorSetup && <div className="two-factor-manage-grid">
            <section><strong>Gerar novos codigos de recuperacao</strong><span>Informe um codigo atual do autenticador. Os codigos de recuperacao antigos serao cancelados.</span><div className="two-factor-inline-form"><input value={twoFactorCode} onChange={(event) => setTwoFactorCode(event.target.value.slice(0, 32))} placeholder="Codigo do autenticador"/><button type="button" className="secondary-button" disabled={twoFactorBusy} onClick={() => void regenerateTwoFactorRecovery()}><RefreshCw size={14}/> Gerar novos</button></div></section>
            <section className="two-factor-disable-card"><strong>Desativar 2FA</strong><span>Use apenas se voce realmente nao quiser mais a segunda camada de protecao.</span><input type="password" value={twoFactorPassword} onChange={(event) => setTwoFactorPassword(event.target.value)} placeholder="Senha atual"/><input value={twoFactorCode} onChange={(event) => setTwoFactorCode(event.target.value.slice(0, 32))} placeholder="Codigo do autenticador"/><button type="button" className="danger-button" disabled={twoFactorBusy} onClick={() => void turnOffTwoFactor()}>Desativar 2FA</button></section>
          </div>}

          {twoFactor?.enabled && <div className="trusted-device-block">
            <div className="trusted-device-heading"><div><strong>Dispositivos confiaveis do 2FA</strong><span>Estes dispositivos podem entrar por ate 30 dias sem pedir um novo codigo, desde que a senha esteja correta.</span></div>{trustedTwoFactorDevices.length>0&&<button type="button" className="danger-button compact-button" disabled={Boolean(trustedDeviceActionId)} onClick={()=>void revokeAllTrustedTwoFactorDevices()}><Trash2 size={14}/> Revogar todos</button>}</div>
            {authSessionsLoading?<div className="security-session-empty">Carregando...</div>:trustedTwoFactorDevices.length===0?<div className="security-session-empty">Nenhum dispositivo confiavel ativo.</div>:<div className="trusted-device-list">{trustedTwoFactorDevices.map(device=><article key={device.id} className={`trusted-device-row ${device.current?"current":""}`}><ShieldCheck size={18}/><div><strong>{device.userAgent}</strong><span>Usado por ultimo em {new Date(device.lastUsedAt).toLocaleString("pt-BR")}</span><small>Confiavel ate {new Date(device.expiresAt).toLocaleString("pt-BR")}{device.current?" · este navegador":""}</small></div><button type="button" className="danger-button compact-button" disabled={Boolean(trustedDeviceActionId)} onClick={()=>void revokeTrustedTwoFactorDevice(device.id)}><Trash2 size={14}/> Revogar</button></article>)}</div>}
          </div>}

          <div className="security-panel"><KeyRound size={28} /><div><strong>Alterar senha</strong><span>O Ginga envia um link de uso unico para o seu e-mail. Senhas encontradas em vazamentos conhecidos sao recusadas.</span></div></div>
          <div className="inline-alert info"><ShieldCheck size={17}/><div><strong>Senha e e-mail protegidos</strong><span>O cadastro exige confirmacao por e-mail e verifica se a senha apareceu em bases publicas de vazamentos sem enviar sua senha para esses servicos.</span></div></div>
          <div className="security-sessions-block"><strong>Sessoes e dispositivos</strong>{authSessionsLoading?<div className="security-session-empty">Carregando...</div>:<div className="security-session-list">{authSessions.filter(i=>!i.revokedAt||i.current).map(session=><article key={session.id} className={`security-session-row ${session.current?"current":""}`}><MonitorUp size={18}/><div><strong>{session.userAgent}</strong><span>Ultima atividade {new Date(session.lastSeenAt).toLocaleString("pt-BR")}</span><small>Rede #{session.ipHash?.slice(0,10)??"-"}</small></div>{!session.current&&!session.revokedAt&&<button type="button" className="danger-button compact-button" onClick={()=>void revokeOwnSession(session.id)} disabled={Boolean(sessionActionId)}><Trash2 size={14}/> Desconectar</button>}</article>)}</div>}</div>
          <div className="settings-action-row"><button type="button" className="primary-button" disabled={busy} onClick={() => void requestOwnPasswordReset()}><KeyRound size={16} /> Enviar link para alterar senha</button><button type="button" className="secondary-button" disabled={busy} onClick={() => void logoutAllDevices()}><ShieldCheck size={16} /> Revogar outras sessoes</button></div>
        </section>
      )}

    </SettingsShell>
  );
}
