import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent
} from "react";
import {
  Video,
  VideoOff,
  Ban,
  Check,
  ChevronRight,
  Clock3,
  Gauge,
  Headphones,
  Keyboard,
  Copy,
  Eye,
  LoaderCircle,
  LogOut,
  Maximize2,
  Mic,
  MicOff,
  MessageCircle,
  Music2,
  ScreenShare,
  Phone,
  PhoneOff,
  Radio,
  RefreshCw,
  Settings2,
  Shield,
  ShieldCheck,
  Sparkles,
  UserMinus,
  UserRound,
  Users,
  Volume2,
  VolumeX,
  X
} from "lucide-react";
import {
  ConnectionState,
  Participant,
  Room,
  RoomEvent,
  Track,
  TrackPublication
} from "livekit-client";
import type { Socket } from "socket.io-client";
import { api } from "../lib/api";
import { useDeveloperMode } from "../lib/developerMode";
import { playUiSound, unlockUiAudio } from "../lib/sounds";
import { loadNotificationPreferences } from "../lib/preferences";
import { isGuildSilent, loadGuildPreferences } from "../lib/serverPreferences";
import { applyMicrophoneSensitivity, loadVoicePreferences, microphoneSensitivityGain, type PersistedVoiceSession, type VoicePreferences } from "../lib/voicePreferences";
import { setVoiceScreenShare, switchVoiceScreenSource } from "../lib/voiceScreenShare";
import { formatPushToTalkBinding } from "../lib/pushToTalkBinding";
import type { Channel, LiveKitCredentials } from "../types";
import { Avatar } from "./Avatar";
import { ContextMenu } from "./ContextMenu";
import { GingaMusicPanel } from "./GingaMusicPanel";
import { Modal } from "./Modal";
import { SoundboardPanel } from "./SoundboardPanel";
import type { SoundboardPlayedEvent } from "../lib/soundboard";

interface VoiceRoomProps {
  channel: Channel;
  currentUserId: string;
  voiceChannels?: Channel[];
  onLeave: () => void;
  // Mantem compatibilidade com o Workspace 1.5.x. Os callbacks sao
  // opcionais para o pacote incremental continuar compilando sobre a base atual.
  socket?: Socket;
  onKickParticipant?: (userId: string) => void | Promise<void>;
  onBanParticipant?: (userId: string, options?: { duration: "PERMANENT" | "1H" | "24H" | "7D" | "30D"; reason: string }) => void | Promise<void>;
  onMoveParticipant?: (userId: string, targetChannelId: string) => void | Promise<void>;
  onDisconnectParticipant?: (userId: string) => void | Promise<void>;
  onTimeoutParticipant?: (userId: string, options: { durationMinutes: number; reason: string }) => void | Promise<void>;
  onServerMuteParticipant?: (userId: string, muted: boolean) => void | Promise<void>;
  onServerDeafenParticipant?: (userId: string, deafened: boolean) => void | Promise<void>;
  onManageParticipantRoles?: (userId: string) => void | Promise<void>;
  onOpenParticipantProfile?: (userId: string) => void | Promise<void>;
  onMessageParticipant?: (userId: string) => void | Promise<void>;
  onCallParticipant?: (userId: string) => void | Promise<void>;
  canKickParticipants?: boolean;
  canMoveParticipants?: boolean;
  canBanParticipants?: boolean;
  canTimeoutParticipants?: boolean;
  canMuteParticipants?: boolean;
  canDeafenParticipants?: boolean;
  canManageParticipantRoles?: boolean;
  canShareScreen?: boolean;
  canUseVideo?: boolean;
  canManageSoundboard?: boolean;
  autoWatchUserId?: string;
  onOpenVoiceSettings?: () => void;
}

type PermissionState = "unknown" | "requesting" | "granted" | "denied" | "unavailable";
type StreamQuality = "480p" | "720p" | "1080p";

type DeviceOption = {
  deviceId: string;
  label: string;
};


const QUALITY_KEY = "ginga.voice.streamQuality";
const NOISE_KEY = "ginga.voice.noiseSuppression";
const MIC_DEVICE_KEY = "ginga.voice.microphoneDevice";
const CAMERA_DEVICE_KEY = "ginga.voice.cameraDevice";
const OUTPUT_DEVICE_KEY = "ginga.voice.outputDevice";
const OUTPUT_VOLUME_KEY = "ginga.voice.outputVolume";
const INPUT_MODE_KEY = "ginga.voice.inputMode";
const PTT_KEY = "ginga.voice.pushToTalkKey";
const STREAM_FPS_KEY = "ginga.voice.streamFps";
const PARTICIPANT_VOLUME_KEY = "ginga.voice.participantVolumes";
const PARTICIPANT_MUTE_KEY = "ginga.voice.participantMutes";

const qualityPresets: Record<StreamQuality, { width: number; height: number; frameRate: number }> = {
  "480p": { width: 854, height: 480, frameRate: 30 },
  "720p": { width: 1280, height: 720, frameRate: 30 },
  "1080p": { width: 1920, height: 1080, frameRate: 30 }
};

function storedQuality(): StreamQuality {
  try {
    const value = localStorage.getItem(QUALITY_KEY);
    if (value === "480p" || value === "720p" || value === "1080p") return value;
  } catch {
    // Preferencia opcional.
  }
  return "720p";
}

function storedBoolean(key: string, fallback: boolean) {
  try {
    const value = localStorage.getItem(key);
    if (value === "true") return true;
    if (value === "false") return false;
  } catch {
    // Preferencia opcional.
  }
  return fallback;
}

function storedString(key: string) {
  try { return localStorage.getItem(key) ?? ""; } catch { return ""; }
}
function storedNumber(key: string, fallback: number, min: number, max: number) {
  try {
    const value = Number(localStorage.getItem(key));
    if (Number.isFinite(value)) return Math.max(min, Math.min(max, value));
  } catch {
    // Preferencia opcional.
  }
  return fallback;
}

type InputMode = "voice" | "ptt";

function storedInputMode(): InputMode {
  try { return localStorage.getItem(INPUT_MODE_KEY) === "ptt" ? "ptt" : "voice"; } catch { return "voice"; }
}

function storedStreamFps(): 15 | 30 | 60 {
  const value = storedNumber(STREAM_FPS_KEY, 30, 15, 60);
  return value >= 60 ? 60 : value >= 30 ? 30 : 15;
}

function storedParticipantVolumes(): Record<string, number> {
  try {
    const raw = localStorage.getItem(PARTICIPANT_VOLUME_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const result: Record<string, number> = {};
    for (const [identity, value] of Object.entries(parsed)) {
      if (typeof value !== "number" || !Number.isFinite(value)) continue;
      result[identity] = Math.max(0, Math.min(200, Math.round(value)));
    }
    return result;
  } catch {
    return {};
  }
}

function storedParticipantMutes(): Record<string, boolean> {
  try {
    const raw = localStorage.getItem(PARTICIPANT_MUTE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const result: Record<string, boolean> = {};
    for (const [identity, value] of Object.entries(parsed)) {
      if (value === true) result[identity] = true;
    }
    return result;
  } catch {
    return {};
  }
}

function notifyParticipantAudioPreference(identity: string, volume: number, muted: boolean) {
  window.dispatchEvent(new CustomEvent("ginga:voice-participant-audio-changed", {
    detail: { identity, volume, muted }
  }));
}

function notifyVoicePreferencesChanged() {
  window.dispatchEvent(new CustomEvent("ginga:voice-preferences-changed", { detail: loadVoicePreferences() }));
}

function participantMetadata(participant: Participant): Record<string, unknown> {
  if (!participant.metadata) return {};
  try {
    const parsed = JSON.parse(participant.metadata);
    return parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function participantRoles(participant: Participant): Array<{ name: string; color?: string }> {
  const metadata = participantMetadata(participant);
  const output: Array<{ name: string; color?: string }> = [];
  const pushRole = (value: unknown) => {
    if (typeof value === "string" && value.trim()) output.push({ name: value.trim() });
    if (value && typeof value === "object") {
      const role = value as { name?: unknown; color?: unknown };
      if (typeof role.name === "string" && role.name.trim()) {
        output.push({ name: role.name.trim(), color: typeof role.color === "string" ? role.color : undefined });
      }
    }
  };
  const roleValues = [metadata.roles, metadata.roleNames, metadata.guildRoles];
  for (const value of roleValues) {
    if (Array.isArray(value)) value.forEach(pushRole);
  }
  pushRole(metadata.role);
  const seen = new Set<string>();
  return output.filter((role) => {
    const key = role.name.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 12);
}

function participantUserId(participant: Participant): string {
  const metadata = participantMetadata(participant);
  return typeof metadata.userId === "string" && metadata.userId ? metadata.userId : participant.identity;
}

function participantServerVoiceState(participant: Participant) {
  const metadata = participantMetadata(participant);
  return {
    muted: metadata.serverMuted === "1" || metadata.serverMuted === true,
    deafened: metadata.serverDeafened === "1" || metadata.serverDeafened === true
  };
}

function participantColor(participant: Participant): string {
  if (!participant.metadata) return "#5865f2";
  try {
    const metadata = JSON.parse(participant.metadata) as { avatarColor?: string };
    return metadata.avatarColor ?? "#5865f2";
  } catch {
    return "#5865f2";
  }
}

function AttachedTrack({ publication, muted = false, sinkId = "", volume = 100, className = "" }: { publication: TrackPublication; muted?: boolean; sinkId?: string; volume?: number; className?: string }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const isVideo = publication.kind === Track.Kind.Video;

  useEffect(() => {
    const element = isVideo ? videoRef.current : audioRef.current;
    const track = publication.track;
    if (!element || !track) return;
    track.attach(element);
    return () => { track.detach(element); };
  }, [isVideo, publication.track]);

  useEffect(() => {
    if (isVideo || !sinkId || !audioRef.current) return;
    const media = audioRef.current as HTMLAudioElement & { setSinkId?: (deviceId: string) => Promise<void> };
    void media.setSinkId?.(sinkId).catch(() => undefined);
  }, [isVideo, sinkId]);

  useEffect(() => {
    if (isVideo || !audioRef.current) return;
    audioRef.current.volume = Math.max(0, Math.min(1, volume / 100));
  }, [isVideo, volume]);

  if (isVideo) return <video className={className} ref={videoRef} autoPlay playsInline muted={muted} />;
  return <audio className={className} ref={audioRef} autoPlay muted={muted || volume <= 0} />;
}

function ParticipantTile({
  participant,
  onContextMenu,
  onActivate,
  onWatchStream,
  deafened = false,
  viewerCount = 0,
  compact = false,
  preferCamera = false,
  active = false
}: {
  participant: Participant;
  onContextMenu?: (event: ReactMouseEvent<HTMLElement>) => void;
  onActivate?: (event: ReactMouseEvent<HTMLElement> | ReactKeyboardEvent<HTMLElement>) => void;
  onWatchStream?: () => void;
  deafened?: boolean;
  viewerCount?: number;
  compact?: boolean;
  preferCamera?: boolean;
  active?: boolean;
}) {
  // Participant pode ser local ou remoto. Converter para a classe base evita a uniao
  // de iteradores LocalTrackPublication/RemoteTrackPublication que quebrava o TS.
  const videoPublications = Array.from(participant.videoTrackPublications.values()) as TrackPublication[];
  const activeVideo = videoPublications.filter((publication) => Boolean(publication.track) && !publication.isMuted);
  const screenPublication = activeVideo.find((publication) => publication.source === Track.Source.ScreenShare);
  const cameraPublication = activeVideo.find((publication) => publication.source === Track.Source.Camera);
  const publication = preferCamera ? cameraPublication : (screenPublication ?? cameraPublication);
  const displayName = participant.name || participant.identity;
  const userId = participantUserId(participant);
  const [profileVisual, setProfileVisual] = useState<{ avatarUrl: string | null; presence: string } | null>(null);

  useEffect(() => {
    let active = true;
    void api<{ profile: { avatarUrl: string | null; presence: string } }>(`/api/gaming-profile/user/${encodeURIComponent(userId)}`)
      .then(({ profile }) => { if (active) setProfileVisual({ avatarUrl: profile.avatarUrl, presence: profile.presence }); })
      .catch(() => undefined);
    const onLocalProfile = (event: Event) => {
      const detail = (event as CustomEvent<{ user?: { id?: string }; avatarUrl?: string | null; presence?: string }>).detail;
      if (detail?.user?.id !== userId || !active) return;
      setProfileVisual({ avatarUrl: detail.avatarUrl ?? null, presence: detail.presence || "ONLINE" });
    };
    window.addEventListener("ginga:profile-local-update", onLocalProfile as EventListener);
    return () => {
      active = false;
      window.removeEventListener("ginga:profile-local-update", onLocalProfile as EventListener);
    };
  }, [userId]);

  const interactive = Boolean(screenPublication && onWatchStream) || (!participant.isLocal && Boolean(onActivate));

  return (
    <article
      className={`participant-tile ${publication ? "with-video" : "without-video"} ${screenPublication && !preferCamera ? "screen-tile" : ""} ${compact ? "participant-stack-card" : ""} ${active ? "active-stream-card" : ""} ${participant.isSpeaking ? "speaking" : ""} ${participant.isLocal ? "local-participant" : "remote-participant"}`}
      onPointerDown={(event) => {
        if (event.button !== 2 || !onContextMenu) return;
        event.preventDefault();
        event.stopPropagation();
        onContextMenu(event as unknown as ReactMouseEvent<HTMLElement>);
      }}
      onContextMenu={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onContextMenu?.(event);
      }}
      onClick={interactive ? (event) => {
        event.stopPropagation();
        if (screenPublication) onWatchStream?.(); else onActivate?.(event);
      } : undefined}
      onKeyDown={interactive ? (event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        if (screenPublication) onWatchStream?.(); else onActivate?.(event);
      } : undefined}
      role={interactive ? "button" : undefined}
      tabIndex={interactive ? 0 : undefined}
      aria-label={interactive ? (screenPublication ? `Assistir transmissao de ${displayName}` : `Abrir controles de ${displayName}`) : undefined}
    >
      {publication ? (
        <AttachedTrack publication={publication} muted={participant.isLocal} />
      ) : (
        <div className="participant-placeholder">
          {profileVisual?.avatarUrl ? (
            <div className="participant-profile-avatar" style={{ backgroundImage: `url(${JSON.stringify(profileVisual.avatarUrl)})` }} aria-label={`Avatar de ${displayName}`}>
              <span className={`participant-profile-presence ${profileVisual.presence.toLowerCase()}`} />
            </div>
          ) : (
            <Avatar name={displayName} color={participantColor(participant)} size="xl" />
          )}
        </div>
      )}
      <div className="participant-label">
        <span>{displayName}{participant.isLocal ? " (voce)" : ""}</span>
        {participant.isLocal && deafened ? <VolumeX size={14} /> : participant.isMicrophoneEnabled ? <Mic size={14} /> : <MicOff size={14} />}
      </div>
      {screenPublication && <span className="screen-badge live"><Radio size={13} /> AO VIVO {viewerCount > 0 && <><Eye size={12}/>{viewerCount}</>}</span>}
    </article>
  );
}

function StreamViewerAvatar({ participant }: { participant: Participant }) {
  const userId = participantUserId(participant);
  const displayName = participant.name || participant.identity;
  return <span className="voice-stream-viewer-avatar" title={displayName}>
    <Avatar user={{ id: userId, displayName, avatarColor: participantColor(participant) }} size="sm" />
  </span>;
}

function StreamViewerStack({ viewers, totalCount }: { viewers: Participant[]; totalCount: number }) {
  const [expanded, setExpanded] = useState(false);
  const visible = viewers.slice(0, 3);
  const hiddenCount = Math.max(0, totalCount - visible.length);
  if (totalCount <= 0) return null;

  const names = viewers.map((viewer) => viewer.name || viewer.identity);
  const label = totalCount === 1 ? "1 pessoa assistindo" : `${totalCount} pessoas assistindo`;

  return <div className={`voice-stream-viewers ${expanded ? "expanded" : ""}`}>
    <button
      type="button"
      className="voice-stream-viewers-trigger"
      onClick={(event) => { event.stopPropagation(); setExpanded((value) => !value); }}
      onBlur={() => setExpanded(false)}
      aria-expanded={expanded}
      aria-label={`${label}. ${names.join(", ")}`}
      title={label}
    >
      <span className="voice-stream-viewers-avatars" aria-hidden="true">
        {visible.map((viewer) => <StreamViewerAvatar key={viewer.sid || viewer.identity} participant={viewer} />)}
        {hiddenCount > 0 && <span className="voice-stream-viewers-more">+{hiddenCount}</span>}
      </span>
      <span className="voice-stream-viewers-count"><Eye size={13}/>{totalCount}</span>
    </button>
    {expanded && <div className="voice-stream-viewers-popover" role="status">
      <strong>{label}</strong>
      <div className="voice-stream-viewers-list">
        {viewers.slice(0, 12).map((viewer) => <span key={viewer.sid || viewer.identity}>{viewer.name || viewer.identity}</span>)}
        {totalCount > viewers.length && <span>+{totalCount - viewers.length} espectador{totalCount - viewers.length === 1 ? "" : "es"}</span>}
        {viewers.length > 12 && <span>+{viewers.length - 12} pessoa{viewers.length - 12 === 1 ? "" : "s"}</span>}
      </div>
    </div>}
  </div>;
}

function StreamFocusPanel({ participant, sinkId = "", viewerCount = 0, viewers = [] }: { participant: Participant; sinkId?: string; viewerCount?: number; viewers?: Participant[] }) {
  const containerRef = useRef<HTMLElement>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const volumeKey = `ginga.voice.streamVolume.${participant.identity}`;
  const [volume, setVolume] = useState(() => storedNumber(volumeKey, 100, 0, 100));
  const displayName = participant.name || participant.identity;
  const videoPublications = Array.from(participant.videoTrackPublications.values()) as TrackPublication[];
  const audioPublications = Array.from(participant.audioTrackPublications.values()) as TrackPublication[];
  const screenPublication = videoPublications.find((publication) => publication.source === Track.Source.ScreenShare && publication.track && !publication.isMuted);
  const screenAudioPublication = audioPublications.find((publication) => publication.source === Track.Source.ScreenShareAudio && publication.track && !publication.isMuted);

  useEffect(() => {
    const onFullscreen = () => setFullscreen(document.fullscreenElement === containerRef.current);
    document.addEventListener("fullscreenchange", onFullscreen);
    return () => document.removeEventListener("fullscreenchange", onFullscreen);
  }, []);

  async function toggleFullscreen() {
    try {
      if (document.fullscreenElement === containerRef.current) await document.exitFullscreen();
      else {
        if (document.fullscreenElement) await document.exitFullscreen();
        await containerRef.current?.requestFullscreen();
      }
    } catch {
      // O stage continua utilizavel mesmo quando o SO/WebView bloqueia fullscreen.
    }
  }

  function changeVolume(nextValue: number) {
    const next = Math.max(0, Math.min(100, Math.round(nextValue)));
    setVolume(next);
    try { localStorage.setItem(volumeKey, String(next)); } catch {}
  }

  if (!screenPublication) return null;

  return <section className="voice-stream-focus-panel" ref={containerRef} onContextMenu={(event) => { event.preventDefault(); event.stopPropagation(); }}>
    <header className="voice-stream-focus-header">
      <div className="voice-stream-focus-identity">
        <span className="stream-live-pill"><Radio size={13}/> AO VIVO</span>
        <span><strong>{displayName}</strong><small>Compartilhamento de tela{viewerCount > 0 ? ` · ${viewerCount} assistindo` : ""}</small></span>
      </div>
      <button type="button" className="voice-stream-fullscreen" onClick={() => void toggleFullscreen()} aria-label={fullscreen ? "Sair da tela cheia" : "Tela cheia"} title={fullscreen ? "Sair da tela cheia" : "Tela cheia"}><Maximize2 size={18}/></button>
    </header>
    <div className="voice-stream-focus-video">
      <AttachedTrack publication={screenPublication} muted className="voice-stream-focus-track" />
      {screenAudioPublication && <AttachedTrack publication={screenAudioPublication} sinkId={sinkId} volume={volume} className="voice-stream-focus-audio" />}
      <StreamViewerStack viewers={viewers} totalCount={viewerCount} />
    </div>
    <footer className="voice-stream-focus-footer">
      {screenAudioPublication ? <label className="voice-stream-volume-control">
        {volume <= 0 ? <VolumeX size={16}/> : <Volume2 size={16}/>}
        <span>Volume</span>
        <input type="range" min="0" max="100" step="5" value={volume} onChange={(event) => changeVolume(Number(event.target.value))}/>
        <strong>{volume}%</strong>
      </label> : <span className="voice-stream-no-audio"><VolumeX size={15}/> Esta transmissao nao compartilha audio.</span>}
      <span className="voice-stream-focus-tip">Clique em outro card AO VIVO para trocar a transmissao principal.</span>
    </footer>
  </section>;
}

function PermissionPill({ state, label }: { state: PermissionState; label: string }) {
  const text = state === "granted" ? "Permitido" : state === "denied" ? "Bloqueado" : state === "requesting" ? "Aguardando" : state === "unavailable" ? "Indisponivel" : "Nao verificado";
  return <span className={`permission-pill permission-${state}`}>{state === "granted" ? <Check size={12} /> : null}<strong>{label}</strong>{text}</span>;
}

export function VoiceRoom({
  channel,
  currentUserId,
  voiceChannels = [],
  onLeave,
  socket,
  onKickParticipant,
  onBanParticipant,
  onMoveParticipant,
  onDisconnectParticipant,
  onTimeoutParticipant,
  onServerMuteParticipant,
  onServerDeafenParticipant,
  onManageParticipantRoles,
  onOpenParticipantProfile,
  onMessageParticipant,
  onCallParticipant,
  canKickParticipants = false,
  canMoveParticipants = false,
  canBanParticipants = false,
  canTimeoutParticipants = false,
  canMuteParticipants = false,
  canDeafenParticipants = false,
  canManageParticipantRoles = false,
  canShareScreen = true,
  canUseVideo = true,
  canManageSoundboard = false,
  autoWatchUserId = "",
  onOpenVoiceSettings
}: VoiceRoomProps) {
  const [room, setRoom] = useState<Room | null>(null);
  const [revision, setRevision] = useState(0);
  const [status, setStatus] = useState<ConnectionState>(ConnectionState.Disconnected);
  const [error, setError] = useState("");
  const [mediaWarning, setMediaWarning] = useState("");
  const [microphoneProblem, setMicrophoneProblem] = useState("");
  const [busy, setBusy] = useState(false);
  const [micEnabled, setMicEnabled] = useState(false);
  const [cameraEnabled, setCameraEnabled] = useState(false);
  const [screenEnabled, setScreenEnabled] = useState(false);
  const [screenMenuOpen, setScreenMenuOpen] = useState(false);
  const [soundboardOpen, setSoundboardOpen] = useState(false);
  const [soundboardNotice, setSoundboardNotice] = useState<SoundboardPlayedEvent | null>(null);
  const [streamViewerCounts, setStreamViewerCounts] = useState<Record<string, number>>({});
  const [streamViewerIds, setStreamViewerIds] = useState<Record<string, string[]>>({});
  const [mediaPermissions, setMediaPermissions] = useState({ canShareScreen, canUseVideo });
  const [watchingStreamIdentity, setWatchingStreamIdentity] = useState("");
  const [audioBlocked, setAudioBlocked] = useState(false);
  const [networkStats, setNetworkStats] = useState<{ pingMs: number | null; jitterMs: number | null; packetLossPercent: number | null }>({ pingMs: null, jitterMs: null, packetLossPercent: null });
  const [deafened, setDeafened] = useState(() => Boolean(window.__gingaVoiceSession?.deafened));
  const [quality, setQuality] = useState<StreamQuality>(storedQuality);
  const [noiseSuppression, setNoiseSuppression] = useState(() => storedBoolean(NOISE_KEY, true));
  const [micPermission, setMicPermission] = useState<PermissionState>("unknown");
  const [cameraPermission, setCameraPermission] = useState<PermissionState>("unknown");
  const [microphones, setMicrophones] = useState<DeviceOption[]>([]);
  const [cameras, setCameras] = useState<DeviceOption[]>([]);
  const [microphoneDevice, setMicrophoneDevice] = useState(() => storedString(MIC_DEVICE_KEY));
  const [cameraDevice, setCameraDevice] = useState(() => storedString(CAMERA_DEVICE_KEY));
  const [speakers, setSpeakers] = useState<DeviceOption[]>([]);
  const [outputDevice, setOutputDevice] = useState(() => storedString(OUTPUT_DEVICE_KEY));
  const [outputVolume, setOutputVolume] = useState(() => storedNumber(OUTPUT_VOLUME_KEY, 100, 0, 200));
  const [microphoneSensitivity, setMicrophoneSensitivity] = useState(() => loadVoicePreferences().microphoneSensitivity);
  const [inputMode, setInputMode] = useState<InputMode>(storedInputMode);
  const [pushToTalkKey, setPushToTalkKey] = useState(() => storedString(PTT_KEY) || "KeyV");
  const [streamFps, setStreamFps] = useState<15 | 30 | 60>(storedStreamFps);
  const [micTestActive, setMicTestActive] = useState(false);
  const [micTestLevel, setMicTestLevel] = useState(0);
  const [participantVolumes, setParticipantVolumes] = useState<Record<string, number>>(storedParticipantVolumes);
  const [locallyMutedParticipants, setLocallyMutedParticipants] = useState<Record<string, boolean>>(storedParticipantMutes);
  const [participantMenu, setParticipantMenu] = useState<{ identity: string; x: number; y: number } | null>(null);
  const developerMode = useDeveloperMode();
  const [rolesExpanded, setRolesExpanded] = useState(false);
  const [moderationTarget, setModerationTarget] = useState<{ action: "kick" | "ban" | "timeout"; identity: string } | null>(null);
  const [banDuration, setBanDuration] = useState<"PERMANENT" | "1H" | "24H" | "7D" | "30D">("7D");
  const [banReason, setBanReason] = useState("");
  const [timeoutDurationMinutes, setTimeoutDurationMinutes] = useState(10);
  const [timeoutReason, setTimeoutReason] = useState("");
  const [moderationBusy, setModerationBusy] = useState(false);
  const explicitLeaveRef = useRef(false);
  const desiredScreenEnabledRef = useRef(false);
  const micTestStreamRef = useRef<MediaStream | null>(null);
  const micTestContextRef = useRef<AudioContext | null>(null);
  const micTestFrameRef = useRef<number | null>(null);
  const connectedServerRailRef = useRef<HTMLElement | null>(null);
  const persistedSessionRef = useRef<PersistedVoiceSession | null>(null);
  const lastAutoWatchRef = useRef("");

  useEffect(() => {
    setMediaPermissions((current) => ({
      canShareScreen: current.canShareScreen && canShareScreen,
      canUseVideo: current.canUseVideo && canUseVideo
    }));
  }, [canShareScreen, canUseVideo]);

  useEffect(() => {
    setSoundboardOpen(false);
  }, [channel.id]);

  useEffect(() => {
    let timer = 0;
    const onSoundboardPlayed = (event: Event) => {
      const detail = (event as CustomEvent<SoundboardPlayedEvent>).detail;
      if (!detail || detail.channelId !== channel.id) return;
      setSoundboardNotice(detail);
      window.clearTimeout(timer);
      timer = window.setTimeout(() => setSoundboardNotice(null), 2200);
    };
    window.addEventListener("ginga:soundboard-played", onSoundboardPlayed as EventListener);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("ginga:soundboard-played", onSoundboardPlayed as EventListener);
    };
  }, [channel.id]);

  function playVoiceEventSound(kind: "join" | "leave" | "mute" | "unmute" | "deafen" | "undeafen" | "cameraOn" | "cameraOff" | "streamStart" | "streamStop") {
    const notificationPreferences = loadNotificationPreferences();
    if (!notificationPreferences.playSound) return;
    const guildPreferences = loadGuildPreferences(channel.guildId);
    if (isGuildSilent(guildPreferences)) return;
    void playUiSound(kind);
  }

  function clearVoiceServerRailIndicator() {
    connectedServerRailRef.current?.removeAttribute("data-voice-connected");
    connectedServerRailRef.current = null;
  }

  function markVoiceServerRailIndicator() {
    const activeServer = document.querySelector<HTMLElement>(
      ".app-rail .rail-space.active, .server-rail .server-button.active"
    );
    if (!activeServer) return;
    if (connectedServerRailRef.current && connectedServerRailRef.current !== activeServer) {
      connectedServerRailRef.current.removeAttribute("data-voice-connected");
    }
    activeServer.setAttribute("data-voice-connected", "true");
    connectedServerRailRef.current = activeServer;
  }


function syncLocalVoiceIndicators(targetRoom: Room | null = room, nextDeafened = deafened) {
  if (!targetRoom) return;
  const local = targetRoom.localParticipant;
  const identity = local.identity.trim().toLocaleLowerCase();
  const displayName = (local.name || local.identity).trim().toLocaleLowerCase();
  document.querySelectorAll<HTMLElement>(".voice-channel-user").forEach((row) => {
    const rowIdentity = (row.dataset.identity || row.dataset.participantIdentity || row.dataset.userId || "").trim().toLocaleLowerCase();
    const rowText = (row.textContent || "").trim().toLocaleLowerCase();
    const isLocal = Boolean(rowIdentity && (rowIdentity === identity || rowIdentity === participantUserId(local).toLocaleLowerCase()))
      || Boolean(displayName && (rowText === displayName || rowText.includes(displayName)));
    if (!isLocal) return;
    row.dataset.localVoice = "true";
    row.dataset.micMuted = local.isMicrophoneEnabled ? "false" : "true";
    row.dataset.deafened = nextDeafened ? "true" : "false";
  });
  window.dispatchEvent(new CustomEvent("ginga:voice-local-state", {
    detail: {
      channelId: channel.id,
      micMuted: !local.isMicrophoneEnabled,
      deafened: nextDeafened
    }
  }));
}

  function microphoneFailureMessage(caught: unknown) {
    const name = caught instanceof DOMException ? caught.name : "";
    if (name === "NotAllowedError" || name === "PermissionDeniedError") return "O Ginga nao tem permissao para usar seu microfone. Libere o acesso nas configuracoes do Windows/navegador.";
    if (name === "NotFoundError" || name === "DevicesNotFoundError") return "Nenhum microfone foi encontrado. Confira se ele esta conectado e habilitado no sistema.";
    if (name === "NotReadableError" || name === "TrackStartError") return "O microfone foi encontrado, mas nao conseguiu iniciar. Feche outros apps de audio ou confira o driver.";
    return caught instanceof Error ? caught.message : "O microfone nao respondeu como esperado.";
  }

  async function refreshDevices() {
    if (!navigator.mediaDevices?.enumerateDevices) return;
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const audioInputs = devices
        .filter((device) => device.kind === "audioinput")
        .map((device, index) => ({ deviceId: device.deviceId, label: device.label || `Microfone ${index + 1}` }));
      const videoInputs = devices
        .filter((device) => device.kind === "videoinput")
        .map((device, index) => ({ deviceId: device.deviceId, label: device.label || `Camera ${index + 1}` }));
      const audioOutputs = devices
        .filter((device) => device.kind === "audiooutput")
        .map((device, index) => ({ deviceId: device.deviceId, label: device.label || `Saida de audio ${index + 1}` }));
      setMicrophones(audioInputs);
      setCameras(videoInputs);
      setSpeakers(audioOutputs);
      if (audioInputs.length === 0) {
        setMicrophoneProblem("Nenhum microfone foi detectado. Conecte ou habilite um dispositivo de entrada para falar no canal.");
      } else if (microphoneDevice && !audioInputs.some((device) => device.deviceId === microphoneDevice)) {
        setMicrophoneProblem("O microfone selecionado nao esta mais disponivel. Escolha outro dispositivo em Voz e video.");
      } else {
        setMicrophoneProblem((current) => current.includes("microfone") && (current.includes("detectado") || current.includes("disponivel")) ? "" : current);
      }
      if (!microphoneDevice && audioInputs[0]?.deviceId) setMicrophoneDevice(audioInputs[0].deviceId);
      if (!cameraDevice && videoInputs[0]?.deviceId) setCameraDevice(videoInputs[0].deviceId);
      if (!outputDevice && audioOutputs[0]?.deviceId) setOutputDevice(audioOutputs[0].deviceId);
    } catch {
      // Enumeracao nao deve impedir a chamada.
    }
  }

  async function requestMediaPermission(kind: "microphone" | "camera") {
    if (!navigator.mediaDevices?.getUserMedia) {
      if (kind === "microphone") setMicPermission("unavailable");
      else setCameraPermission("unavailable");
      return false;
    }

    const setPermission = kind === "microphone" ? setMicPermission : setCameraPermission;
    setPermission("requesting");
    try {
      const resolution = qualityPresets[quality];
      const stream = await navigator.mediaDevices.getUserMedia(kind === "microphone"
        ? {
            audio: {
              deviceId: microphoneDevice ? { ideal: microphoneDevice } : undefined,
              echoCancellation: true,
              noiseSuppression,
              autoGainControl: true
            },
            video: false
          }
        : {
            audio: false,
            video: {
              deviceId: cameraDevice ? { ideal: cameraDevice } : undefined,
              width: { ideal: resolution.width },
              height: { ideal: resolution.height },
              frameRate: { ideal: streamFps, max: streamFps }
            }
          });
      stream.getTracks().forEach((track) => track.stop());
      setPermission("granted");
      await refreshDevices();
      return true;
    } catch (caught) {
      const name = caught instanceof DOMException ? caught.name : "";
      setPermission(name === "NotFoundError" || name === "DevicesNotFoundError" ? "unavailable" : "denied");
      if (kind === "microphone") setMicrophoneProblem(microphoneFailureMessage(caught));
      return false;
    }
  }

  async function requestInitialMediaPermissions() {
    if (!navigator.mediaDevices?.getUserMedia) {
      setMicPermission("unavailable");
      setCameraPermission("unavailable");
      return false;
    }

    setMicPermission("requesting");
    setCameraPermission("requesting");
    const resolution = qualityPresets[quality];
    try {
      // Solicita os dois de uma vez para o navegador exibir a permissao nativa
      // logo na entrada da sala. As tracks sao fechadas em seguida; quem publica
      // audio/video de fato e o LiveKit.
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          deviceId: microphoneDevice ? { ideal: microphoneDevice } : undefined,
          echoCancellation: true,
          noiseSuppression,
          autoGainControl: true
        },
        video: {
          deviceId: cameraDevice ? { ideal: cameraDevice } : undefined,
          width: { ideal: resolution.width },
          height: { ideal: resolution.height },
          frameRate: { ideal: streamFps, max: streamFps }
        }
      });
      stream.getTracks().forEach((track) => track.stop());
      setMicPermission("granted");
      setCameraPermission("granted");
      await refreshDevices();
      return true;
    } catch {
      // Alguns navegadores tratam camera e microfone separadamente. Nesse caso,
      // tenta cada permissao para mostrar ao usuario exatamente o que foi bloqueado.
      setMicPermission("unknown");
      setCameraPermission("unknown");
      const microphoneAllowed = await requestMediaPermission("microphone");
      await requestMediaPermission("camera");
      return microphoneAllowed;
    }
  }

  async function enableMicrophone(targetRoom: Room, enabled: boolean) {
    const fn = targetRoom.localParticipant.setMicrophoneEnabled as unknown as (enabled: boolean, options?: Record<string, unknown>) => Promise<unknown>;
    const options = (deviceId?: string) => ({
      deviceId: deviceId || undefined,
      echoCancellation: true,
      noiseSuppression,
      autoGainControl: true
    });
    try {
      await fn.call(targetRoom.localParticipant, enabled, enabled ? options(microphoneDevice) : undefined);
      if (enabled) await applyMicrophoneSensitivity(targetRoom, microphoneSensitivity).catch(() => false);
    } catch (caught) {
      if (!enabled || !microphoneDevice) throw caught;
      // IDs de dispositivos mudam no Windows depois de reconectar USB/Bluetooth.
      // Se o microfone salvo sumiu, entra usando o padrao em vez de derrubar a voz.
      await fn.call(targetRoom.localParticipant, true, options());
      await applyMicrophoneSensitivity(targetRoom, microphoneSensitivity).catch(() => false);
      setMicrophoneDevice("");
      try { localStorage.removeItem(MIC_DEVICE_KEY); } catch {}
      // Sincroniza o fallback com o audio persistente e com qualquer tela de
      // configuracoes aberta. Sem isso, outra camada podia tentar reabrir o
      // mesmo deviceId invalido alguns milissegundos depois.
      notifyVoicePreferencesChanged();
      setMicrophoneProblem("O microfone salvo nao estava disponivel. O Ginga mudou para o dispositivo padrao.");
      window.dispatchEvent(new CustomEvent("ginga:voice-device-fallback", { detail: { channelId: channel.id, kind: "audioinput" } }));
    }
  }

  async function enableCamera(targetRoom: Room, enabled: boolean) {
    const resolution = qualityPresets[quality];
    const fn = targetRoom.localParticipant.setCameraEnabled as unknown as (enabled: boolean, options?: Record<string, unknown>) => Promise<unknown>;
    await fn.call(targetRoom.localParticipant, enabled, enabled ? {
      deviceId: cameraDevice || undefined,
      resolution: { ...resolution, frameRate: streamFps }
    } : undefined);
  }

  async function enableScreen(targetRoom: Room, enabled: boolean) {
    desiredScreenEnabledRef.current = enabled;
    try {
      await setVoiceScreenShare(targetRoom, enabled);
    } catch (caught) {
      if (enabled) desiredScreenEnabledRef.current = false;
      throw caught;
    }
  }

  useEffect(() => {
    let cancelled = false;
    let presenceJoined = false;
    explicitLeaveRef.current = false;

    const voiceSocket = socket as {
      connected?: boolean;
      emit?: (event: string, payload: { channelId: string; micMuted?: boolean; deafened?: boolean; streaming?: boolean }, ack?: (response?: { ok?: boolean; restored?: boolean; error?: string }) => void) => void;
      on?: (event: string, listener: () => void) => void;
      off?: (event: string, listener: () => void) => void;
    } | undefined;

    const existingSession = window.__gingaVoiceSession;
    if (existingSession && existingSession.channelId !== channel.id) {
      // Ao trocar/mover de sala, remova tambem o listener de reconexao da sala
      // antiga. Sem isso um reconnect futuro podia republicar a presenca no
      // canal anterior e deixar a sidebar divergente do LiveKit.
      if (existingSession.reconnectListener) voiceSocket?.off?.("connect", existingSession.reconnectListener);
      existingSession.presenceJoined = false;
      try { existingSession.room.disconnect(); } catch {}
      if (window.__gingaVoiceSession === existingSession) window.__gingaVoiceSession = undefined;
    }
    const activeRoom = existingSession?.channelId === channel.id
      ? existingSession.room
      : new Room({ adaptiveStream: true, dynacast: true });
    persistedSessionRef.current = existingSession?.channelId === channel.id ? existingSession : null;
    if (persistedSessionRef.current?.mediaPermissions) setMediaPermissions(persistedSessionRef.current.mediaPermissions);

    const publishPresence = (joined: boolean) => {
      if (joined === presenceJoined) return;
      presenceJoined = joined;
      if (persistedSessionRef.current) persistedSessionRef.current.presenceJoined = joined;
      const eventName = joined ? "voice:sync" : "voice:leave";
      const payload = joined
        ? {
            channelId: channel.id,
            micMuted: !activeRoom.localParticipant.isMicrophoneEnabled,
            deafened: Boolean(persistedSessionRef.current?.deafened ?? deafened),
            streaming: activeRoom.localParticipant.isScreenShareEnabled
          }
        : { channelId: channel.id };
      try {
        voiceSocket?.emit?.(eventName, payload, (response) => {
          if (response?.ok === false && !cancelled) setMediaWarning(response.error || "Nao foi possivel sincronizar a presenca da sala");
        });
      } catch {
        // O LiveKit continua funcional mesmo se a presenca lateral estiver indisponivel.
      }
      if (joined) {
        // O rail ja existe quando a sala e aberta. O segundo passe cobre uma
        // eventual renderizacao do React logo depois da conexao do LiveKit.
        markVoiceServerRailIndicator();
        window.setTimeout(markVoiceServerRailIndicator, 80);
      } else {
        clearVoiceServerRailIndicator();
      }
      window.dispatchEvent(new CustomEvent("ginga:voice-presence", {
        detail: { channelId: channel.id, connected: joined }
      }));
    };

    const publishPresenceAgain = () => {
      if (!presenceJoined) return;
      // Reconexao do Socket.IO: reapresenta a sala atual para o servidor.
      presenceJoined = false;
      publishPresence(true);
    };
    if (persistedSessionRef.current?.reconnectListener) voiceSocket?.off?.("connect", persistedSessionRef.current.reconnectListener);
    voiceSocket?.on?.("connect", publishPresenceAgain);
    setRoom(activeRoom);
    setError("");
    setMediaWarning("");
    setStatus(persistedSessionRef.current ? activeRoom.state : ConnectionState.Connecting);

    const refresh = () => {
      if (cancelled) return;
      setRevision((value) => value + 1);
      setMicEnabled(activeRoom.localParticipant.isMicrophoneEnabled);
      setCameraEnabled(activeRoom.localParticipant.isCameraEnabled);
      setScreenEnabled(activeRoom.localParticipant.isScreenShareEnabled);
      syncLocalVoiceIndicators(activeRoom, deafened);
    };

    const onState = (nextState: ConnectionState) => {
      if (cancelled) return;
      setStatus(nextState);
      if (nextState === ConnectionState.Connected) publishPresence(true);
      if (nextState === ConnectionState.Disconnected) publishPresence(false);
    };

    const onAudioPlaybackChanged = () => {
      if (!cancelled) setAudioBlocked(!activeRoom.canPlaybackAudio);
    };

    const onParticipantConnected = () => {
      refresh();
    };
    const onParticipantDisconnected = () => {
      refresh();
    };

    activeRoom.on(RoomEvent.TrackSubscribed, refresh);
    activeRoom.on(RoomEvent.TrackUnsubscribed, refresh);
    activeRoom.on(RoomEvent.TrackPublished, refresh);
    activeRoom.on(RoomEvent.TrackUnpublished, refresh);
    activeRoom.on(RoomEvent.TrackMuted, refresh);
    activeRoom.on(RoomEvent.TrackUnmuted, refresh);
    const onLocalTrackUnpublished = (publication?: TrackPublication) => {
      refresh();
      if (publication?.source === Track.Source.ScreenShare && desiredScreenEnabledRef.current) {
        desiredScreenEnabledRef.current = false;
        if (!cancelled) setMediaWarning("A transmissao de tela foi interrompida. A voz continua conectada; clique em Compartilhar tela para escolher a fonte novamente.");
      }
    };
    activeRoom.on(RoomEvent.LocalTrackPublished, refresh);
    activeRoom.on(RoomEvent.LocalTrackUnpublished, onLocalTrackUnpublished);
    activeRoom.on(RoomEvent.ActiveSpeakersChanged, refresh);
    activeRoom.on(RoomEvent.ParticipantConnected, onParticipantConnected);
    activeRoom.on(RoomEvent.ParticipantDisconnected, onParticipantDisconnected);
    activeRoom.on(RoomEvent.ConnectionStateChanged, onState);
    activeRoom.on(RoomEvent.AudioPlaybackStatusChanged, onAudioPlaybackChanged);


if (persistedSessionRef.current && activeRoom.state !== ConnectionState.Disconnected) {
  persistedSessionRef.current.channelName = channel.name;
  if (window.__gingaVoiceSession?.channelId === channel.id) window.__gingaVoiceSession.channelName = channel.name;
  setStatus(activeRoom.state);
  refresh();
  if (activeRoom.state === ConnectionState.Connected) {
    publishPresence(true);
    if (!cancelled) setAudioBlocked(!activeRoom.canPlaybackAudio);
  }
} else {
  void (async () => {
    try {
      await unlockUiAudio();
      const microphoneAllowed = await requestInitialMediaPermissions();
      if (cancelled) return;
      const credentials = await api<LiveKitCredentials>("/api/livekit/token", {
        method: "POST",
        body: JSON.stringify({ channelId: channel.id })
      });
      if (cancelled) return;
      const effectiveMediaPermissions = {
        canShareScreen: Boolean(credentials.mediaPermissions?.canShareScreen ?? canShareScreen),
        canUseVideo: Boolean(credentials.mediaPermissions?.canUseVideo ?? canUseVideo)
      };
      setMediaPermissions(effectiveMediaPermissions);

      await activeRoom.connect(credentials.url, credentials.token, { autoSubscribe: true });
      const persisted: PersistedVoiceSession = {
        channelId: channel.id, channelName: channel.name, room: activeRoom, presenceJoined: false, reconnectListener: publishPresenceAgain,
        deafened, serverMuted: Boolean(credentials.serverVoiceState?.muted), serverDeafened: Boolean(credentials.serverVoiceState?.deafened),
        desiredMicEnabled: inputMode !== "ptt" && !credentials.serverVoiceState?.muted && !credentials.serverVoiceState?.deafened,
        mediaPermissions: effectiveMediaPermissions
      };
      window.__gingaVoiceSession = persisted;
      persistedSessionRef.current = persisted;
      publishPresence(true);
      if (cancelled) return;

      try {
        await activeRoom.startAudio();
        if (!cancelled) setAudioBlocked(false);
      } catch {
        if (!cancelled) setAudioBlocked(true);
      }

      refresh();
      playVoiceEventSound("join");

      if (microphoneAllowed && !credentials.serverVoiceState?.muted && !credentials.serverVoiceState?.deafened) {
        try {
          await enableMicrophone(activeRoom, inputMode !== "ptt");
          if (window.__gingaVoiceSession?.channelId === channel.id) window.__gingaVoiceSession.desiredMicEnabled = inputMode !== "ptt";
        } catch {
          if (!cancelled) setMediaWarning("Conectado sem microfone. Autorize o acesso ao microfone nas permissoes do navegador.");
        }
      } else if (!cancelled) {
        setMediaWarning("Microfone bloqueado. Voce entrou ouvindo; libere a permissao para falar.");
      }
      if (!cancelled) refresh();
    } catch (caught) {
      if (!cancelled) {
        setError(caught instanceof Error ? caught.message : "Falha ao conectar no canal de voz");
        setStatus(ConnectionState.Disconnected);
        if (window.__gingaVoiceSession?.channelId === channel.id) window.__gingaVoiceSession = undefined;
      }
    }
  })();
}

    return () => {
      cancelled = true;
      activeRoom.off(RoomEvent.TrackSubscribed, refresh);
      activeRoom.off(RoomEvent.TrackUnsubscribed, refresh);
      activeRoom.off(RoomEvent.TrackPublished, refresh);
      activeRoom.off(RoomEvent.TrackUnpublished, refresh);
      activeRoom.off(RoomEvent.TrackMuted, refresh);
      activeRoom.off(RoomEvent.TrackUnmuted, refresh);
      activeRoom.off(RoomEvent.LocalTrackPublished, refresh);
      activeRoom.off(RoomEvent.LocalTrackUnpublished, onLocalTrackUnpublished);
      activeRoom.off(RoomEvent.ActiveSpeakersChanged, refresh);
      activeRoom.off(RoomEvent.ParticipantConnected, onParticipantConnected);
      activeRoom.off(RoomEvent.ParticipantDisconnected, onParticipantDisconnected);
      activeRoom.off(RoomEvent.ConnectionStateChanged, onState);
      activeRoom.off(RoomEvent.AudioPlaybackStatusChanged, onAudioPlaybackChanged);
      const shouldDisconnect = explicitLeaveRef.current || activeRoom.state === ConnectionState.Disconnected;
      if (shouldDisconnect) {
        voiceSocket?.off?.("connect", publishPresenceAgain);
        publishPresence(false);
        clearVoiceServerRailIndicator();
        if (window.__gingaVoiceSession?.channelId === channel.id) window.__gingaVoiceSession = undefined;
        activeRoom.disconnect();
      } else {
        const persisted = persistedSessionRef.current ?? { channelId: channel.id, room: activeRoom, presenceJoined, reconnectListener: publishPresenceAgain, deafened, desiredMicEnabled: activeRoom.localParticipant.isMicrophoneEnabled };
        persisted.presenceJoined = presenceJoined;
        persisted.reconnectListener = publishPresenceAgain;
        persisted.deafened = deafened;
        window.__gingaVoiceSession = persisted;
      }
    };
    // As preferencias novas sao aplicadas sem reconectar; a sala depende do canal
    // e do Socket.IO usado para espelhar a presenca na sidebar para todos.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channel.id, socket]);

  useEffect(() => {
    const onPreferences = (event: Event) => {
      const next = (event as CustomEvent<VoicePreferences>).detail;
      if (!next) return;
      setMicrophoneDevice(next.microphoneDevice);
      setOutputDevice(next.outputDevice);
      setCameraDevice(next.cameraDevice);
      setOutputVolume(next.outputVolume);
      setMicrophoneSensitivity(next.microphoneSensitivity);
      setNoiseSuppression(next.noiseSuppression);
      void applyMicrophoneSensitivity(window.__gingaVoiceSession?.room, next.microphoneSensitivity).catch(() => undefined);
      setInputMode(next.inputMode);
      setPushToTalkKey(next.pushToTalkKey);
      setQuality(next.quality);
      setStreamFps(next.streamFps);
    };
    window.addEventListener("ginga:voice-preferences-changed", onPreferences as EventListener);
    return () => window.removeEventListener("ginga:voice-preferences-changed", onPreferences as EventListener);
  }, []);

  useEffect(() => {
    if (window.__gingaVoiceSession?.channelId === channel.id) window.__gingaVoiceSession.deafened = deafened;
  }, [channel.id, deafened]);

  useEffect(() => {
    const onNetworkStats = (event: Event) => {
      const detail = (event as CustomEvent<{ channelId?: string; pingMs?: number | null; jitterMs?: number | null; packetLossPercent?: number | null }>).detail;
      if (detail?.channelId !== channel.id) return;
      setNetworkStats({ pingMs: typeof detail.pingMs === "number" ? detail.pingMs : null, jitterMs: typeof detail.jitterMs === "number" ? detail.jitterMs : null, packetLossPercent: typeof detail.packetLossPercent === "number" ? detail.packetLossPercent : null });
    };
    window.addEventListener("ginga:voice-network-stats", onNetworkStats as EventListener);
    return () => window.removeEventListener("ginga:voice-network-stats", onNetworkStats as EventListener);
  }, [channel.id]);

  useEffect(() => {
    if (!socket) return;
    const onViewerCount = (payload: { channelId?: string; broadcasterId?: string; count?: number; viewerIds?: string[] }) => {
      if (payload.channelId !== channel.id || !payload.broadcasterId) return;
      const broadcasterId = payload.broadcasterId;
      setStreamViewerCounts((current) => ({ ...current, [broadcasterId]: Math.max(0, Number(payload.count) || 0) }));
      setStreamViewerIds((current) => ({ ...current, [broadcasterId]: Array.isArray(payload.viewerIds) ? payload.viewerIds.filter((id): id is string => typeof id === "string" && Boolean(id)) : [] }));
    };
    socket.on("voice:stream-viewers", onViewerCount);
    return () => { socket.off("voice:stream-viewers", onViewerCount); };
  }, [channel.id, socket]);

  useEffect(() => {
    const onExternalDeafen = (event: Event) => {
      const detail = (event as CustomEvent<{ channelId?: string; deafened?: boolean }>).detail;
      if (detail?.channelId && detail.channelId !== channel.id) return;
      if (typeof detail?.deafened === "boolean" && detail.deafened !== deafened) setDeafened(detail.deafened);
    };
    window.addEventListener("ginga:voice-deafen-changed", onExternalDeafen as EventListener);
    return () => window.removeEventListener("ginga:voice-deafen-changed", onExternalDeafen as EventListener);
  }, [channel.id, deafened]);

  useEffect(() => {
    if (status !== ConnectionState.Connected) return;
    const voiceSocket = socket as { emit?: (event: string, payload: unknown) => void } | undefined;
    voiceSocket?.emit?.("voice:state", { channelId: channel.id, micMuted: !micEnabled, deafened, streaming: screenEnabled });
  }, [channel.id, deafened, micEnabled, screenEnabled, socket, status]);

  const participants = useMemo(() => {
    if (!room) return [];
    return [room.localParticipant, ...Array.from(room.remoteParticipants.values())] as Participant[];
  }, [room, revision]);

  const selectedParticipant = participantMenu
    ? participants.find((participant) => participant.identity === participantMenu.identity) ?? null
    : null;
  const selectedParticipantUserId = selectedParticipant ? participantUserId(selectedParticipant) : "";
  const selectedParticipantServerState = selectedParticipant ? participantServerVoiceState(selectedParticipant) : { muted: false, deafened: false };

  function participantVolume(identity: string) {
    return participantVolumes[identity] ?? 100;
  }

  function changeParticipantVolume(participant: Participant, value: number) {
    const next = Math.max(0, Math.min(200, Math.round(value)));
    const shouldUnmute = next > 0 && Boolean(locallyMutedParticipants[participant.identity]);
    setParticipantVolumes((current) => {
      const updated = { ...current, [participant.identity]: next };
      try { localStorage.setItem(PARTICIPANT_VOLUME_KEY, JSON.stringify(updated)); } catch {}
      return updated;
    });
    if (shouldUnmute) {
      setLocallyMutedParticipants((current) => {
        const updated = { ...current, [participant.identity]: false };
        try { localStorage.setItem(PARTICIPANT_MUTE_KEY, JSON.stringify(updated)); } catch {}
        return updated;
      });
    }
    notifyParticipantAudioPreference(participant.identity, next, false);
  }

  function toggleParticipantMute(participant: Participant) {
    const next = !locallyMutedParticipants[participant.identity];
    setLocallyMutedParticipants((current) => {
      const updated = { ...current, [participant.identity]: next };
      try { localStorage.setItem(PARTICIPANT_MUTE_KEY, JSON.stringify(updated)); } catch {}
      return updated;
    });
    const volume = participantVolume(participant.identity);
    notifyParticipantAudioPreference(participant.identity, volume, next);
  }

  function showParticipantMenu(participant: Participant, requestedX: number, requestedY: number) {
    // Deixa espaco para volume, cargos e moderacao sem jogar o popover para fora da janela.
    const x = Math.max(8, Math.min(window.innerWidth - 252, requestedX));
    const y = Math.max(8, Math.min(window.innerHeight - 420, requestedY));
    setRolesExpanded(false);
    setParticipantMenu({ identity: participant.identity, x, y });
  }

  function openParticipantMenu(
    participant: Participant,
    event: ReactMouseEvent<HTMLElement> | ReactKeyboardEvent<HTMLElement>
  ) {
    event.preventDefault();
    event.stopPropagation();
    const rect = event.currentTarget.getBoundingClientRect();
    const mouseEvent = event as ReactMouseEvent<HTMLElement>;
    const requestedX = typeof mouseEvent.clientX === "number" && mouseEvent.clientX > 0
      ? mouseEvent.clientX + 8
      : rect.left + Math.min(rect.width * 0.55, 180);
    const requestedY = typeof mouseEvent.clientY === "number" && mouseEvent.clientY > 0
      ? mouseEvent.clientY + 8
      : rect.top + Math.min(rect.height * 0.42, 96);
    showParticipantMenu(participant, requestedX, requestedY);
  }

  async function runParticipantAction(action: "kick" | "ban" | "timeout" | "roles", participant: Participant) {
    if (action === "kick" || action === "ban" || action === "timeout") {
      setParticipantMenu(null);
      setRolesExpanded(false);
      setBanReason("");
      setTimeoutReason("");
      if (action === "ban") setBanDuration("7D");
      if (action === "timeout") setTimeoutDurationMinutes(10);
      setModerationTarget({ action, identity: participant.identity });
      return;
    }
    const userId = participantUserId(participant);
    const bridgeEvent = new CustomEvent("ginga:voice-member-action", {
      cancelable: true,
      detail: { action, userId, participantIdentity: participant.identity, channelId: channel.id }
    });
    const bridgeAccepted = !window.dispatchEvent(bridgeEvent);
    if (!onManageParticipantRoles) {
      if (!bridgeAccepted) setMediaWarning("O gerenciamento de cargos ainda nao esta conectado a este menu.");
      setParticipantMenu(null);
      return;
    }
    try {
      await onManageParticipantRoles(userId);
      setParticipantMenu(null);
      setMediaWarning("");
    } catch (caught) {
      setMediaWarning(caught instanceof Error ? caught.message : "Nao foi possivel concluir a acao de moderacao");
    }
  }

  async function confirmModerationAction() {
    if (!moderationTarget || moderationBusy) return;
    const participant = participants.find((item) => item.identity === moderationTarget.identity);
    if (!participant || participant.isLocal) {
      setModerationTarget(null);
      return;
    }
    const userId = participantUserId(participant);
    setModerationBusy(true);
    setMediaWarning("");
    try {
      if (moderationTarget.action === "kick") {
        if (!onKickParticipant) throw new Error("Voce nao tem permissao para expulsar este usuario.");
        await onKickParticipant(userId);
      } else if (moderationTarget.action === "ban") {
        if (!onBanParticipant) throw new Error("Voce nao tem permissao para banir este usuario.");
        await onBanParticipant(userId, { duration: banDuration, reason: banReason.trim() });
      } else {
        if (!onTimeoutParticipant) throw new Error("Voce nao tem permissao para aplicar timeout neste usuario.");
        await onTimeoutParticipant(userId, { durationMinutes: timeoutDurationMinutes, reason: timeoutReason.trim() });
      }
      setModerationTarget(null);
      setBanReason("");
      setTimeoutReason("");
    } catch (caught) {
      setMediaWarning(caught instanceof Error ? caught.message : "Nao foi possivel concluir a acao de moderacao");
    } finally {
      setModerationBusy(false);
    }
  }

  useEffect(() => {
    syncLocalVoiceIndicators(room, deafened);
  }, [room, deafened, micEnabled, status]);

  useEffect(() => {
    const onShortcut = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, [contenteditable='true']")) return;
      if (!(event.ctrlKey || event.metaKey) || !event.shiftKey) return;
      if (event.key.toLowerCase() === "m") { event.preventDefault(); void toggleMedia("mic"); }
      if (event.key.toLowerCase() === "d") { event.preventDefault(); toggleLocalDeafen(); }
    };
    window.addEventListener("keydown", onShortcut);
    return () => window.removeEventListener("keydown", onShortcut);
  });

  useEffect(() => {
    if (!navigator.mediaDevices?.enumerateDevices || status !== ConnectionState.Connected) return;
    let active = true;
    const verifyMicrophone = async () => {
      try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        if (!active) return;
        const inputs = devices.filter((device) => device.kind === "audioinput");
        if (inputs.length === 0) {
          setMicrophoneProblem("Seu microfone nao esta funcionando porque nenhum dispositivo de entrada foi encontrado.");
        } else if (microphoneDevice && !inputs.some((device) => device.deviceId === microphoneDevice)) {
          setMicrophoneProblem("O microfone selecionado foi desconectado ou ficou indisponivel. Escolha outro em Voz e video.");
        }
      } catch {
        // Falha de enumeracao nao encerra a chamada.
      }
    };
    const onDeviceChange = () => { void verifyMicrophone(); };
    void verifyMicrophone();
    navigator.mediaDevices.addEventListener?.("devicechange", onDeviceChange);
    return () => {
      active = false;
      navigator.mediaDevices.removeEventListener?.("devicechange", onDeviceChange);
    };
  }, [status, microphoneDevice]);

  useEffect(() => {
    if (!room || !micEnabled || inputMode === "ptt" || status !== ConnectionState.Connected) return;
    const publication = room.localParticipant.getTrackPublication(Track.Source.Microphone);
    const mediaTrack = publication?.track?.mediaStreamTrack;
    if (!mediaTrack) {
      setMicrophoneProblem("O microfone esta marcado como ativo, mas o Ginga nao recebeu uma faixa de audio. Abra Voz e video e teste o dispositivo.");
      return;
    }
    const onEnded = () => setMicrophoneProblem("O microfone parou de responder durante a chamada. Confira o cabo, o dispositivo padrao ou o driver de audio.");
    const onMute = () => setMicrophoneProblem("O sistema interrompeu o audio do microfone. Confira se o dispositivo foi mutado ou desconectado.");
    const onUnmute = () => setMicrophoneProblem("");
    mediaTrack.addEventListener("ended", onEnded);
    mediaTrack.addEventListener("mute", onMute);
    mediaTrack.addEventListener("unmute", onUnmute);
    if (mediaTrack.readyState !== "live") onEnded();
    else if (mediaTrack.muted) onMute();
    return () => {
      mediaTrack.removeEventListener("ended", onEnded);
      mediaTrack.removeEventListener("mute", onMute);
      mediaTrack.removeEventListener("unmute", onUnmute);
    };
  }, [room, micEnabled, inputMode, status, revision]);

  useEffect(() => {
    const onMicState = (event: Event) => {
      const detail = (event as CustomEvent<{ channelId?: string; enabled?: boolean }>).detail;
      if (detail?.channelId !== channel.id || typeof detail.enabled !== "boolean") return;
      setMicEnabled(detail.enabled);
    };
    const onPttError = (event: Event) => {
      const detail = (event as CustomEvent<{ channelId?: string }>).detail;
      if (detail?.channelId === channel.id) setMediaWarning("O microfone nao respondeu ao Push-to-Talk.");
    };
    window.addEventListener("ginga:voice-local-mic-state", onMicState as EventListener);
    window.addEventListener("ginga:voice-ptt-error", onPttError as EventListener);
    return () => {
      window.removeEventListener("ginga:voice-local-mic-state", onMicState as EventListener);
      window.removeEventListener("ginga:voice-ptt-error", onPttError as EventListener);
    };
  }, [channel.id]);

  useEffect(() => () => stopMicTest(), []);

  const streamingParticipants = useMemo(() => participants.filter((participant) => participant.isScreenShareEnabled), [participants]);
  const hasScreenShare = streamingParticipants.length > 0;
  const connectionGrade = (() => {
    const { pingMs, jitterMs, packetLossPercent } = networkStats;
    if (pingMs === null && jitterMs === null && packetLossPercent === null) return { label: "Medindo", tone: "neutral" };
    if ((packetLossPercent ?? 0) >= 6 || (pingMs ?? 0) >= 350 || (jitterMs ?? 0) >= 70) return { label: "Ruim", tone: "danger" };
    if ((packetLossPercent ?? 0) >= 2.5 || (pingMs ?? 0) >= 190 || (jitterMs ?? 0) >= 35) return { label: "Instavel", tone: "warn" };
    if ((packetLossPercent ?? 0) >= 1 || (pingMs ?? 0) >= 110 || (jitterMs ?? 0) >= 20) return { label: "Boa", tone: "good" };
    return { label: "Excelente", tone: "excellent" };
  })();
  const watchingStreamParticipant = watchingStreamIdentity
    ? streamingParticipants.find((participant) => participant.identity === watchingStreamIdentity) ?? null
    : null;
  const preferredStreamingParticipant = (autoWatchUserId
    ? streamingParticipants.find((participant) => participant.identity === autoWatchUserId)
    : null) ?? streamingParticipants.find((participant) => !participant.isLocal) ?? streamingParticipants[0] ?? null;
  const activeStreamParticipant = watchingStreamParticipant ?? preferredStreamingParticipant;
  const activeStreamBroadcasterUserId = activeStreamParticipant ? participantUserId(activeStreamParticipant) : "";
  const activeStreamViewerParticipants = useMemo(() => {
    if (!activeStreamBroadcasterUserId) return [];
    const viewerIds = new Set(streamViewerIds[activeStreamBroadcasterUserId] ?? []);
    return participants.filter((participant) => viewerIds.has(participantUserId(participant)));
  }, [activeStreamBroadcasterUserId, participants, streamViewerIds]);

  useEffect(() => {
    if (!hasScreenShare) {
      if (watchingStreamIdentity) setWatchingStreamIdentity("");
      return;
    }
    if (watchingStreamParticipant) return;
    if (preferredStreamingParticipant) setWatchingStreamIdentity(preferredStreamingParticipant.identity);
  }, [hasScreenShare, preferredStreamingParticipant, watchingStreamIdentity, watchingStreamParticipant]);

  const watchingBroadcasterUserId = watchingStreamParticipant ? participantUserId(watchingStreamParticipant) : "";
  useEffect(() => {
    if (!socket || !watchingBroadcasterUserId || watchingBroadcasterUserId === currentUserId) return;
    socket.emit("voice:stream-watch", { channelId: channel.id, broadcasterId: watchingBroadcasterUserId });
    return () => { socket.emit("voice:stream-unwatch", { channelId: channel.id, broadcasterId: watchingBroadcasterUserId }); };
  }, [channel.id, currentUserId, socket, watchingBroadcasterUserId]);

  useEffect(() => {
    if (!autoWatchUserId || lastAutoWatchRef.current === autoWatchUserId) return;
    const target = streamingParticipants.find((participant) => participant.identity === autoWatchUserId);
    if (!target) return;
    lastAutoWatchRef.current = autoWatchUserId;
    setWatchingStreamIdentity(autoWatchUserId);
  }, [autoWatchUserId, streamingParticipants, revision]);

  async function switchCurrentScreenSource() {
    if (!room || busy || status !== ConnectionState.Connected || !room.localParticipant.isScreenShareEnabled) return;
    setBusy(true);
    setMediaWarning("");
    try {
      await switchVoiceScreenSource(room);
      setRevision((value) => value + 1);
      setScreenMenuOpen(false);
    } catch (caught) {
      setMediaWarning(caught instanceof Error ? caught.message : "Nao foi possivel trocar a janela compartilhada.");
    } finally {
      setBusy(false);
    }
  }

  async function toggleMedia(kind: "mic" | "camera" | "screen") {
    if (!room || busy || status !== ConnectionState.Connected) return;
    setBusy(true);
    setMediaWarning("");
    try {
      if (kind === "screen" && !mediaPermissions.canShareScreen) throw new Error("Voce nao tem permissao para transmitir a tela neste servidor.");
      if (kind === "camera" && !mediaPermissions.canUseVideo) throw new Error("Voce nao tem permissao para usar video neste servidor.");
      if (kind === "mic") {
        if (!room.localParticipant.isMicrophoneEnabled && micPermission !== "granted") {
          const allowed = await requestMediaPermission("microphone");
          if (!allowed) throw new Error("O Ginga nao consegue acessar seu microfone. Abra Voz e video para revisar o dispositivo e a permissao.");
        }
        const nextMicEnabled = !room.localParticipant.isMicrophoneEnabled;
        await enableMicrophone(room, nextMicEnabled);
        if (window.__gingaVoiceSession?.channelId === channel.id) window.__gingaVoiceSession.desiredMicEnabled = nextMicEnabled;
        if (room.localParticipant.isMicrophoneEnabled) setMicrophoneProblem("");
        playVoiceEventSound(room.localParticipant.isMicrophoneEnabled ? "unmute" : "mute");
      }
      if (kind === "camera") {
        if (!room.localParticipant.isCameraEnabled && cameraPermission !== "granted") {
          const allowed = await requestMediaPermission("camera");
          if (!allowed) throw new Error("A camera esta bloqueada pelo navegador.");
        }
        await enableCamera(room, !room.localParticipant.isCameraEnabled);
        playVoiceEventSound(room.localParticipant.isCameraEnabled ? "cameraOn" : "cameraOff");
      }
      if (kind === "screen") {
        await enableScreen(room, !room.localParticipant.isScreenShareEnabled);
        if (!room.localParticipant.isScreenShareEnabled) setScreenMenuOpen(false);
        playVoiceEventSound(room.localParticipant.isScreenShareEnabled ? "streamStart" : "streamStop");
      }
      setMicEnabled(room.localParticipant.isMicrophoneEnabled);
      setCameraEnabled(room.localParticipant.isCameraEnabled);
      setScreenEnabled(room.localParticipant.isScreenShareEnabled);
      setRevision((value) => value + 1);
    } catch (caught) {
      setMediaWarning(caught instanceof Error ? caught.message : "O navegador bloqueou o dispositivo");
    } finally {
      setBusy(false);
    }
  }

  function toggleLocalDeafen() {
    if (status !== ConnectionState.Connected) return;
    const nextDeafened = !deafened;
    setDeafened(nextDeafened);
    playVoiceEventSound(nextDeafened ? "deafen" : "undeafen");
  }

  async function enablePlayback() {
    if (!room) return;
    try {
      await unlockUiAudio();
      await room.startAudio();
      setAudioBlocked(false);
      void playUiSound("success");
    } catch (caught) {
      setMediaWarning(caught instanceof Error ? caught.message : "O navegador ainda bloqueou a reproducao de audio");
    }
  }

  async function selectDevice(kind: "audioinput" | "audiooutput" | "videoinput", deviceId: string) {
    if (kind === "audioinput") {
      setMicrophoneDevice(deviceId);
      setMicrophoneProblem("");
      try { localStorage.setItem(MIC_DEVICE_KEY, deviceId); } catch {}
      notifyVoicePreferencesChanged();
    } else if (kind === "audiooutput") {
      setOutputDevice(deviceId);
      try { localStorage.setItem(OUTPUT_DEVICE_KEY, deviceId); } catch {}
      notifyVoicePreferencesChanged();
    } else {
      setCameraDevice(deviceId);
      try { localStorage.setItem(CAMERA_DEVICE_KEY, deviceId); } catch {}
      notifyVoicePreferencesChanged();
    }
    if (!room || status !== ConnectionState.Connected || !deviceId) return;
    try {
      const switchDevice = room.switchActiveDevice as unknown as (kind: MediaDeviceKind, deviceId: string) => Promise<boolean>;
      await switchDevice.call(room, kind, deviceId);
      setMediaWarning("");
    } catch (caught) {
      if (kind === "audiooutput" && !("setSinkId" in HTMLMediaElement.prototype)) {
        setMediaWarning("Este navegador nao permite escolher a saida de audio. No Desktop do Ginga essa opcao funciona normalmente.");
      } else {
        setMediaWarning(caught instanceof Error ? caught.message : "Nao foi possivel trocar o dispositivo");
      }
    }
  }

  function changeOutputVolume(value: number) {
    const next = Math.max(0, Math.min(200, Math.round(value)));
    setOutputVolume(next);
    try { localStorage.setItem(OUTPUT_VOLUME_KEY, String(next)); } catch {}
    notifyVoicePreferencesChanged();
  }

  async function changeInputMode(next: InputMode) {
    setInputMode(next);
    try { localStorage.setItem(INPUT_MODE_KEY, next); } catch {}
    notifyVoicePreferencesChanged();
    if (!room || status !== ConnectionState.Connected) return;
    try {
      if (next === "ptt") await enableMicrophone(room, false);
      else if (micPermission === "granted") await enableMicrophone(room, true);
      if (window.__gingaVoiceSession?.channelId === channel.id) window.__gingaVoiceSession.desiredMicEnabled = next === "voice" && room.localParticipant.isMicrophoneEnabled;
      setMicEnabled(room.localParticipant.isMicrophoneEnabled);
    } catch {
      setMediaWarning("Nao foi possivel alterar o modo de entrada agora.");
    }
  }

  function changePushToTalkKey(code: string) {
    setPushToTalkKey(code);
    try { localStorage.setItem(PTT_KEY, code); } catch {}
    notifyVoicePreferencesChanged();
  }

  function changeStreamFps(value: number) {
    const next: 15 | 30 | 60 = value >= 60 ? 60 : value >= 30 ? 30 : 15;
    setStreamFps(next);
    try { localStorage.setItem(STREAM_FPS_KEY, String(next)); } catch {}
    notifyVoicePreferencesChanged();
    if (cameraEnabled || screenEnabled) setMediaWarning("O novo FPS sera aplicado ao reativar a camera ou a transmissao.");
  }

  function stopMicTest() {
    if (micTestFrameRef.current !== null) cancelAnimationFrame(micTestFrameRef.current);
    micTestFrameRef.current = null;
    micTestStreamRef.current?.getTracks().forEach((track) => track.stop());
    micTestStreamRef.current = null;
    void micTestContextRef.current?.close().catch(() => undefined);
    micTestContextRef.current = null;
    setMicTestActive(false);
    setMicTestLevel(0);
  }

  async function toggleMicTest() {
    if (micTestActive) { stopMicTest(); return; }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          deviceId: microphoneDevice ? { ideal: microphoneDevice } : undefined,
          echoCancellation: true,
          noiseSuppression,
          autoGainControl: true
        },
        video: false
      });
      const context = new AudioContext();
      const source = context.createMediaStreamSource(stream);
      const inputGain = context.createGain();
      inputGain.gain.value = microphoneSensitivityGain(microphoneSensitivity);
      const analyser = context.createAnalyser();
      analyser.fftSize = 256;
      source.connect(inputGain);
      inputGain.connect(analyser);
      const data = new Uint8Array(analyser.frequencyBinCount);
      micTestStreamRef.current = stream;
      micTestContextRef.current = context;
      setMicTestActive(true);
      const sample = () => {
        analyser.getByteFrequencyData(data);
        let peak = 0;
        for (const value of data) peak = Math.max(peak, value);
        setMicTestLevel(Math.min(100, Math.round((peak / 255) * 125)));
        micTestFrameRef.current = requestAnimationFrame(sample);
      };
      sample();
    } catch (caught) {
      setMediaWarning(caught instanceof Error ? caught.message : "Nao foi possivel testar o microfone");
      stopMicTest();
    }
  }

  function changeQuality(next: StreamQuality) {
    setQuality(next);
    try { localStorage.setItem(QUALITY_KEY, next); } catch {}
    notifyVoicePreferencesChanged();
    setMediaWarning(cameraEnabled || screenEnabled ? "A nova qualidade sera aplicada ao reativar a camera ou o compartilhamento de tela." : "");
  }

  function changeNoiseSuppression(enabled: boolean) {
    setNoiseSuppression(enabled);
    try { localStorage.setItem(NOISE_KEY, String(enabled)); } catch {}
    notifyVoicePreferencesChanged();
    setMediaWarning(micEnabled ? "A reducao de ruido sera reaplicada ao reativar o microfone." : "");
  }

  function leave() {
    explicitLeaveRef.current = true;
    playVoiceEventSound("leave");
    if (window.__gingaVoiceSession?.channelId === channel.id) window.__gingaVoiceSession = undefined;
    room?.disconnect();
    onLeave();
  }

  return (
    <section className="voice-view">
      <header className="content-header voice-header">
        <div>
          <div className="channel-title"><Volume2 size={20} /><strong>{channel.name}</strong></div>
          <span className="channel-topic">{participants.length} participante{participants.length === 1 ? "" : "s"}</span>
        </div>
        <div className="voice-header-actions">
          {status === ConnectionState.Connected && <div className="voice-live-diagnostics" aria-label="Qualidade da conexao de voz"><span className={`voice-quality-grade-v3 ${connectionGrade.tone}`}><i/>{connectionGrade.label}</span><span className={`network-metric-pill ${networkStats.pingMs !== null && networkStats.pingMs > 180 ? "warn" : ""}`}><Gauge size={13}/>{networkStats.pingMs === null ? "--" : networkStats.pingMs} ms</span><span className={`network-metric-pill ${networkStats.jitterMs !== null && networkStats.jitterMs > 30 ? "warn" : ""}`}>Jitter {networkStats.jitterMs === null ? "--" : networkStats.jitterMs} ms</span><span className={`network-metric-pill ${networkStats.packetLossPercent !== null && networkStats.packetLossPercent > 2 ? "danger" : ""}`}>Perda {networkStats.packetLossPercent === null ? "--" : networkStats.packetLossPercent}%</span></div>}
          <span className={`connection-pill state-${status.toLowerCase()}`}><Radio size={14} /> {status === ConnectionState.Connected ? "Conectado" : status === ConnectionState.Connecting ? "Conectando" : status}</span>
        </div>
      </header>

      <GingaMusicPanel guildId={channel.guildId} userId={currentUserId} channel={channel} voiceChannels={voiceChannels} socket={socket} />

      <div className="voice-stage">
        {error ? (
          <div className="voice-error">
            <PhoneOff size={38} />
            <h2>Nao foi possivel entrar na chamada</h2>
            <p>{error}</p>
            <button className="secondary-button" onClick={onLeave}><LogOut size={17} /> Voltar</button>
          </div>
        ) : status !== ConnectionState.Connected ? (
          <div className="center-state large"><LoaderCircle className="spin" /> Entrando no canal de voz...</div>
        ) : hasScreenShare && activeStreamParticipant ? (
          <div className="voice-stream-focus-layout">
            <div className="voice-stream-main-stage">
              <StreamFocusPanel
                key={activeStreamParticipant.identity}
                participant={activeStreamParticipant}
                sinkId={outputDevice}
                viewerCount={streamViewerCounts[participantUserId(activeStreamParticipant)] ?? 0}
                viewers={activeStreamViewerParticipants}
              />
            </div>
            <aside className="voice-participant-stack" aria-label="Participantes da chamada">
              <header><span><Users size={14}/> Participantes</span><strong>{participants.length}</strong></header>
              <div className="voice-participant-stack-scroll">
                {participants.map((participant) => (
                  <ParticipantTile
                    key={participant.sid || participant.identity}
                    participant={participant}
                    compact
                    preferCamera
                    active={participant.identity === activeStreamParticipant.identity}
                    deafened={participant.isLocal ? deafened : false}
                    viewerCount={streamViewerCounts[participantUserId(participant)] ?? 0}
                    onWatchStream={participant.isScreenShareEnabled ? () => setWatchingStreamIdentity(participant.identity) : undefined}
                    onContextMenu={participant.isLocal ? undefined : (event) => openParticipantMenu(participant, event)}
                    onActivate={participant.isLocal || participant.isScreenShareEnabled ? undefined : (event) => openParticipantMenu(participant, event)}
                  />
                ))}
              </div>
            </aside>
          </div>
        ) : (
          <div className="participant-grid">
            {participants.map((participant) => (
              <ParticipantTile
                key={participant.sid || participant.identity}
                participant={participant}
                deafened={participant.isLocal ? deafened : false}
                viewerCount={streamViewerCounts[participantUserId(participant)] ?? 0}
                onWatchStream={participant.isScreenShareEnabled ? () => setWatchingStreamIdentity(participant.identity) : undefined}
                onContextMenu={participant.isLocal ? undefined : (event) => openParticipantMenu(participant, event)}
                onActivate={participant.isLocal || participant.isScreenShareEnabled ? undefined : (event) => openParticipantMenu(participant, event)}
              />
            ))}
          </div>
        )}
      </div>

      {participantMenu && selectedParticipant && (
        <ContextMenu x={participantMenu.x} y={participantMenu.y} onClose={() => { setParticipantMenu(null); setRolesExpanded(false); }}>
          <div className="user-context-menu-head voice-user-context-head">
            <Avatar name={selectedParticipant.name || selectedParticipant.identity} color={participantColor(selectedParticipant)} size="sm" />
            <div>
              <strong>{selectedParticipant.name || selectedParticipant.identity}{selectedParticipant.isLocal ? " (voce)" : ""}</strong>
              <span>{selectedParticipant.isLocal ? "Sua conta · conectado na voz" : selectedParticipant.isSpeaking ? "Falando agora" : "Conectado na voz"}</span>
            </div>
          </div>
          {onOpenParticipantProfile && <button type="button" onClick={() => { const id = selectedParticipantUserId; setParticipantMenu(null); void onOpenParticipantProfile(id); }}><UserRound size={15}/> Ver perfil</button>}
          {!selectedParticipant.isLocal && onMessageParticipant && <button type="button" onClick={() => { const id = selectedParticipantUserId; setParticipantMenu(null); void onMessageParticipant(id); }}><MessageCircle size={15}/> Conversar</button>}
          {!selectedParticipant.isLocal && onCallParticipant && <button type="button" onClick={() => { const id = selectedParticipantUserId; setParticipantMenu(null); void onCallParticipant(id); }}><Phone size={15}/> Iniciar chamada</button>}
          {selectedParticipant.isLocal && onOpenVoiceSettings && <button type="button" onClick={() => { setParticipantMenu(null); onOpenVoiceSettings(); }}><Settings2 size={15}/> Configuracoes de voz</button>}
          {!selectedParticipant.isLocal && <div className="context-menu-separator"/>}
          {!selectedParticipant.isLocal && <div className="voice-member-volume">
            <div><Volume2 size={15}/><span>Volume do usuario</span><strong>{locallyMutedParticipants[selectedParticipant.identity] ? 0 : participantVolume(selectedParticipant.identity)}%</strong></div>
            <input type="range" min="0" max="200" step="5" value={locallyMutedParticipants[selectedParticipant.identity] ? 0 : participantVolume(selectedParticipant.identity)} onChange={(event) => changeParticipantVolume(selectedParticipant, Number(event.target.value))} aria-label={`Volume de ${selectedParticipant.name || selectedParticipant.identity}`} />
            <div className="voice-volume-scale"><span>0</span><span>100</span><span>200%</span></div>
          </div>}
          {!selectedParticipant.isLocal && <button type="button" onClick={() => toggleParticipantMute(selectedParticipant)}>
            {locallyMutedParticipants[selectedParticipant.identity] ? <Volume2 size={15}/> : <VolumeX size={15}/>} {locallyMutedParticipants[selectedParticipant.identity] ? "Ouvir usuario" : "Silenciar localmente"}
          </button>}
          {!selectedParticipant.isLocal && canMuteParticipants && onServerMuteParticipant && <button type="button" onClick={() => { const userId = selectedParticipantUserId; const next = !selectedParticipantServerState.muted; setParticipantMenu(null); void Promise.resolve(onServerMuteParticipant(userId, next)).catch((caught) => setMediaWarning(caught instanceof Error ? caught.message : "Nao foi possivel alterar o mute do servidor")); }}>{selectedParticipantServerState.muted ? <Mic size={15}/> : <MicOff size={15}/>} {selectedParticipantServerState.muted ? "Desmutar no servidor" : "Mutar no servidor"}</button>}
          {!selectedParticipant.isLocal && canDeafenParticipants && onServerDeafenParticipant && <button type="button" onClick={() => { const userId = selectedParticipantUserId; const next = !selectedParticipantServerState.deafened; setParticipantMenu(null); void Promise.resolve(onServerDeafenParticipant(userId, next)).catch((caught) => setMediaWarning(caught instanceof Error ? caught.message : "Nao foi possivel alterar o ensurdecimento")); }}>{selectedParticipantServerState.deafened ? <Volume2 size={15}/> : <Headphones size={15}/>} {selectedParticipantServerState.deafened ? "Remover ensurdecimento" : "Ensurdecer no servidor"}</button>}
          {!selectedParticipant.isLocal && canMoveParticipants && onDisconnectParticipant && <button type="button" className="voice-disconnect-action" onClick={() => { const userId = selectedParticipantUserId; setParticipantMenu(null); void Promise.resolve(onDisconnectParticipant(userId)).catch((caught) => setMediaWarning(caught instanceof Error ? caught.message : "Nao foi possivel desconectar o usuario")); }}><PhoneOff size={15}/> Desconectar da voz</button>}
          {!selectedParticipant.isLocal && canMoveParticipants && onMoveParticipant && voiceChannels.length > 0 && <>
            <div className="context-menu-label">MOVER PARA</div>
            {voiceChannels.map((target) => <button type="button" key={target.id} disabled={target.id === channel.id} onClick={() => { const userId = selectedParticipantUserId; setParticipantMenu(null); void Promise.resolve(onMoveParticipant(userId, target.id)).catch((caught) => setMediaWarning(caught instanceof Error ? caught.message : "Nao foi possivel mover o usuario")); }}><Headphones size={15}/>{target.name}</button>)}
          </>}
          {!selectedParticipant.isLocal && <button type="button" className={rolesExpanded ? "active" : ""} onClick={() => setRolesExpanded((value) => !value)}>
            <Shield size={15}/> Cargos <ChevronRight className={rolesExpanded ? "rotate-90" : ""} size={14}/>
          </button>}
          {!selectedParticipant.isLocal && rolesExpanded && (
            <div className="voice-role-panel">
              <div className="voice-role-strip">
                {participantRoles(selectedParticipant).length > 0
                  ? participantRoles(selectedParticipant).map((role) => <span key={role.name} style={role.color ? { borderColor: role.color, color: role.color } : undefined}>{role.name}</span>)
                  : <small>Nenhum cargo informado na sessao de voz.</small>}
              </div>
              {canManageParticipantRoles && <button type="button" className="voice-role-manage" onClick={() => void runParticipantAction("roles", selectedParticipant)}><ShieldCheck size={14}/> Gerenciar cargos</button>}
            </div>
          )}
          <div className="context-menu-separator"/>
          {developerMode && <button type="button" onClick={() => { void navigator.clipboard.writeText(selectedParticipantUserId); setParticipantMenu(null); }}><Copy size={15}/> Copiar ID do usuario</button>}
          {!selectedParticipant.isLocal && canTimeoutParticipants && <button type="button" onClick={() => void runParticipantAction("timeout", selectedParticipant)}><Clock3 size={15}/> Aplicar timeout</button>}
          {!selectedParticipant.isLocal && canKickParticipants && <button type="button" className="danger" onClick={() => void runParticipantAction("kick", selectedParticipant)}><UserMinus size={15}/> Expulsar</button>}
          {!selectedParticipant.isLocal && canBanParticipants && <button type="button" className="danger" onClick={() => void runParticipantAction("ban", selectedParticipant)}><Ban size={15}/> Banir</button>}
        </ContextMenu>
      )}


      {moderationTarget && (() => {
        const target = participants.find((item) => item.identity === moderationTarget.identity);
        if (!target) return null;
        const targetName = target.name || target.identity;
        const isBan = moderationTarget.action === "ban";
        const isTimeout = moderationTarget.action === "timeout";
        const actionLabel = isBan ? "Banir" : isTimeout ? "Aplicar timeout em" : "Expulsar";
        return <Modal title={`${actionLabel} ${targetName}`} onClose={() => !moderationBusy && setModerationTarget(null)} width="sm">
          <div className="stack-form voice-moderation-dialog">
            <div className="voice-moderation-user"><Avatar name={targetName} color={participantColor(target)} size="md"/><div><strong>{targetName}</strong><span>{isBan ? "O usuario sera removido da sala e do servidor." : isTimeout ? "O usuario continua no servidor, mas fica sem enviar mensagens e sem entrar em voz durante o periodo." : "O usuario sera removido do servidor agora."}</span></div></div>
            {isBan && <>
              <label>Duracao<select value={banDuration} disabled={moderationBusy} onChange={(event) => setBanDuration(event.target.value as typeof banDuration)}><option value="1H">1 hora</option><option value="24H">24 horas</option><option value="7D">7 dias</option><option value="30D">30 dias</option><option value="PERMANENT">Permanente</option></select></label>
              <label>Motivo<textarea rows={3} maxLength={500} value={banReason} disabled={moderationBusy} onChange={(event) => setBanReason(event.target.value)} placeholder="Opcional"/></label>
            </>}
            {isTimeout && <>
              <label>Duracao<select value={timeoutDurationMinutes} disabled={moderationBusy} onChange={(event) => setTimeoutDurationMinutes(Number(event.target.value))}><option value={5}>5 minutos</option><option value={10}>10 minutos</option><option value={30}>30 minutos</option><option value={60}>1 hora</option><option value={360}>6 horas</option><option value={1440}>24 horas</option><option value={10080}>7 dias</option></select></label>
              <label>Motivo<textarea rows={3} maxLength={300} value={timeoutReason} disabled={moderationBusy} onChange={(event) => setTimeoutReason(event.target.value)} placeholder="Opcional, mas recomendado"/></label>
            </>}
            <div className="modal-actions"><button type="button" className="secondary-button" disabled={moderationBusy} onClick={() => setModerationTarget(null)}>Cancelar</button><button type="button" className={isTimeout ? "primary-button" : "danger-button"} disabled={moderationBusy} onClick={() => void confirmModerationAction()}>{isBan ? <Ban size={16}/> : isTimeout ? <Clock3 size={16}/> : <UserMinus size={16}/>} {moderationBusy ? "Aplicando..." : isBan ? "Confirmar banimento" : isTimeout ? "Aplicar timeout" : "Expulsar usuario"}</button></div>
          </div>
        </Modal>;
      })()}

      <footer className="voice-controls-wrap">
        {soundboardOpen && <SoundboardPanel guildId={channel.guildId} channelId={channel.id} socket={socket} canManage={canManageSoundboard} onClose={() => setSoundboardOpen(false)} />}
        {soundboardNotice && <div className="soundboard-now-playing"><span>{soundboardNotice.sound.emoji || "🔊"}</span><div><small>{soundboardNotice.playedBy.displayName} tocou</small><strong>{soundboardNotice.sound.name}</strong></div><i/><i/><i/></div>}
        {audioBlocked && <div className="media-warning"><VolumeX size={15}/> O navegador bloqueou o som da chamada. <button type="button" onClick={() => void enablePlayback()}>Ativar som</button></div>}
        {microphoneProblem && <div className="media-warning microphone-runtime-warning"><MicOff size={16}/><span><strong>Nao estamos recebendo audio do seu microfone.</strong> {microphoneProblem}</span>{onOpenVoiceSettings && <button type="button" onClick={onOpenVoiceSettings}>Abrir Voz e video</button>}</div>}
        {mediaWarning && <div className="media-warning">{mediaWarning}</div>}
        <div className="voice-controls">
          <button className={`media-button ${!micEnabled ? "off" : ""}`} onClick={() => void toggleMedia("mic")} disabled={busy || status !== ConnectionState.Connected} aria-label={micEnabled ? "Desativar microfone" : "Ativar microfone"}>
            {micEnabled ? <Mic /> : <MicOff />}
          </button>
          <button className={`media-button camera-control ${!cameraEnabled ? "off" : ""}`} onClick={() => void toggleMedia("camera")} disabled={busy || status !== ConnectionState.Connected || !mediaPermissions.canUseVideo} title={!mediaPermissions.canUseVideo ? "Video desativado pelas permissoes do servidor" : undefined} aria-label={cameraEnabled ? "Desativar camera" : "Ativar camera"}>
            {cameraEnabled ? <Video size={21} strokeWidth={2.15}/> : <VideoOff size={21} strokeWidth={2.15}/>}
          </button>
          <div className="voice-screen-control-wrap">
            <button className={`media-button screen-control ${screenEnabled ? "active" : ""}`} onClick={() => { setSoundboardOpen(false); if (screenEnabled) setScreenMenuOpen((value) => !value); else void toggleMedia("screen"); }} disabled={busy || status !== ConnectionState.Connected || !mediaPermissions.canShareScreen} title={!mediaPermissions.canShareScreen ? "Transmissao de tela desativada pelas permissoes do servidor" : screenEnabled ? "Opcoes da transmissao" : undefined} aria-label={screenEnabled ? "Opcoes da transmissao" : `Compartilhar tela em ${quality}`}>
              <ScreenShare size={21} strokeWidth={2.15} />
              {screenEnabled && (streamViewerCounts[currentUserId] ?? 0) > 0 && <span className="screen-viewer-count"><Eye size={11}/>{streamViewerCounts[currentUserId]}</span>}
            </button>
            {screenEnabled && screenMenuOpen && <div className="voice-screen-menu">
              <div className="voice-screen-menu-status"><span><Radio size={13}/> Transmitindo</span><strong><Eye size={13}/>{streamViewerCounts[currentUserId] ?? 0} assistindo</strong></div>
              <button type="button" onClick={() => void switchCurrentScreenSource()} disabled={busy}><RefreshCw size={15}/> Trocar janela</button>
              <button type="button" className="danger" onClick={() => void toggleMedia("screen")} disabled={busy}><X size={15}/> Encerrar transmissao</button>
            </div>}
          </div>
          <button className={`media-button soundboard-trigger ${soundboardOpen ? "active" : ""}`} onClick={() => { setScreenMenuOpen(false); setSoundboardOpen((value) => !value); }} disabled={status !== ConnectionState.Connected} aria-label="Abrir painel de sons" title="Sons"><Music2 size={21}/></button>
          <button className={`media-button ${deafened ? "deafened" : ""}`} onClick={toggleLocalDeafen} disabled={status !== ConnectionState.Connected} aria-label={deafened ? "Ativar audio da chamada" : "Silenciar audio da chamada"}>
            {deafened ? <VolumeX /> : <Volume2 />}
          </button>
          <button className="media-button voice-settings-trigger" onClick={onOpenVoiceSettings} aria-label="Abrir Voz e Video nas configuracoes do usuario">
            <Settings2 />
            <span>{quality}</span>
          </button>
          <button className="media-button hangup" onClick={leave} aria-label="Sair da chamada"><PhoneOff /></button>
        </div>
        <span className="voice-identity">Conectado como <strong>{room?.localParticipant.name || "voce"}</strong>{inputMode === "ptt" ? <em>PTT: {formatPushToTalkBinding(pushToTalkKey)}</em> : null}</span>
      </footer>
    </section>
  );
}
