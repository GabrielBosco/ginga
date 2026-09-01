import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type FormEvent } from "react";
import {
  Ban,
  Bell,
  BellOff,
  BookOpen,
  Building2,
  CalendarDays,
  Check,
  Code2,
  Command,
  Compass,
  ShieldCheck,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CirclePlus,
  Clock3,
  Copy,
  Crown,
  FolderInput,
  FolderOpen,
  FolderPlus,
  Eye,
  EyeOff,
  Gamepad2,
  GraduationCap,
  Headphones,
  Headset,
  LayoutTemplate,
  Link2,
  LogOut,
  Megaphone,
  MessageCircle,
  MessageSquare,
  MessageSquareText,
  Menu,
  Music2,
  Mic,
  MicOff,
  Pencil,
  Phone,
  PhoneOff,
  Plus,
  Radio,
  RefreshCw,
  ScreenShare,
  Search,
  Send,
  Settings,
  Sparkles,
  Trash2,
  TriangleAlert,
  UserMinus,
  UserPlus,
  UserRound,
  Users,
  UsersRound,
  Volume2,
  VolumeX,
  X
} from "lucide-react";
import { io } from "socket.io-client";
import { api } from "../lib/api";
import { copyTextToClipboard } from "../lib/clipboard";
import { getDirectCallsBridge, type DirectCall } from "../lib/directCalls";
import { DEVELOPER_MODE_EVENT, loadDeveloperPreferences } from "../lib/developerMode";
import { loadNotificationPreferences } from "../lib/preferences";
import { setOwnPresenceMode, type PresenceMode } from "../lib/gamingProfile";
import { setVoiceScreenShare, switchVoiceScreenSource } from "../lib/voiceScreenShare";
import { GUILD_PREFERENCES_EVENT, guildAllowsMessageActivity, guildNotificationMode, isChannelMuted, isGuildSilent, loadGuildPreferences, muteChannelFor, muteGuildFor, setGuildNotificationMode, unmuteChannel, unmuteGuild, updateGuildPreferences } from "../lib/serverPreferences";
import { setDesktopUnreadCount, showSystemNotification } from "../lib/notifications";
import { playUiSound } from "../lib/sounds";
import { loadPersistedUnreadState, savePersistedUnreadState, type PersistedUnreadState } from "../lib/unreadState";
import type {
  Channel,
  ChannelCategory,
  ChannelType,
  CustomRole,
  DirectConversation,
  DirectMessage,
  FriendsPayload,
  Guild,
  GuildMember,
  GuildTemplateSummary,
  MusicPayload,
  MusicState,
  User,
  VoicePresencePayload,
  VoicePresenceUser
} from "../types";
import { Avatar } from "./Avatar";
import { ChatView } from "./ChatView";
import { CommunityExplore } from "./CommunityExplore";
import { EventsView } from "./EventsView";
import { ForumView } from "./ForumView";
import { GingaNews } from "./GingaNews";
import { GlobalSearch } from "./GlobalSearch";
import { GingaMusicPlayer } from "./GingaMusicPlayer";
import { ContextMenu } from "./ContextMenu";
import { DirectChat } from "./DirectChat";
import { FriendsView } from "./FriendsView";
import { MediaRoom } from "./MediaRoom";
import { Modal } from "./Modal";
import { ServerSettingsModal, type ServerSettingsTab } from "./ServerSettingsModal";
import { UserSettingsModal, type UserSettingsTab } from "./UserSettingsModal";
import { UserProfileCard, type ProfileAnchor } from "./UserProfileCard";
import { UserProfileModal } from "./UserProfileModal";
import { ProfileErrorBoundary } from "./ProfileErrorBoundary";
import { VoiceRoom } from "./VoiceRoom";
import { PersistentVoiceAudio } from "./PersistentVoiceAudio";
import { SoundboardPanel } from "./SoundboardPanel";
import { UserBadges } from "./UserBadges";

import { gingaConfirm, gingaPrompt } from "../lib/dialogs";
interface WorkspaceProps {
  token: string;
  user: User;
  onLogout: () => void;
  onSessionUpdate: (token: string, user: User) => void;
  onNavigate: (path: string) => void;
  desktop: boolean;
}

type Section = "space" | "people" | "direct" | "news" | "communities";

interface ProfileCardState {
  user: User;
  anchor: ProfileAnchor;
  guildId?: string;
  role?: GuildMember["role"];
  joinedAt?: string;
  topRole?: CustomRole;
  guildOwner?: boolean;
}

interface ProfileModalState {
  user: User;
  guildId?: string;
  topRole?: CustomRole;
  guildOwner?: boolean;
}

type ServerFolder = {
  id: string;
  name: string;
  color: string;
  guildIds: string[];
  expanded: boolean;
};

type RailItem =
  | { kind: "folder"; folder: ServerFolder }
  | { kind: "guild"; guild: Guild };

const SERVER_FOLDERS_KEY = "ginga.serverFolders.v1";
const SERVER_FOLDER_COLORS = ["#7c3cff", "#2c74ff", "#22d3ee", "#23a559", "#f0b232", "#da373c", "#9b59b6"];
const SERVER_INVITE_MESSAGE_PREFIX = "[[ginga:server-invite:";
const PARTICIPANT_MUTE_KEY = "ginga.voice.participantMutes";
const PARTICIPANT_VOLUME_KEY = "ginga.voice.participantVolumes";
function localVoiceMuteState(userId: string) {
  try { return Boolean((JSON.parse(localStorage.getItem(PARTICIPANT_MUTE_KEY) || "{}") as Record<string, boolean>)[userId]); } catch { return false; }
}

function setLocalVoiceMuteState(userId: string, muted: boolean) {
  let next: Record<string, boolean> = {};
  try { next = JSON.parse(localStorage.getItem(PARTICIPANT_MUTE_KEY) || "{}") as Record<string, boolean>; } catch { next = {}; }
  next[userId] = muted;
  try { localStorage.setItem(PARTICIPANT_MUTE_KEY, JSON.stringify(next)); } catch {}
  let volume = 100;
  try { volume = Number((JSON.parse(localStorage.getItem(PARTICIPANT_VOLUME_KEY) || "{}") as Record<string, number>)[userId] ?? 100); } catch {}
  window.dispatchEvent(new CustomEvent("ginga:voice-participant-audio-changed", { detail: { identity: userId, muted, volume } }));
}

function buildServerInviteMessage(code: string) {
  return `${SERVER_INVITE_MESSAGE_PREFIX}${code}]]`;
}

function directMessagePreview(message: DirectMessage | null, fallback: string) {
  if (!message) return fallback;
  if (message.content.startsWith(SERVER_INVITE_MESSAGE_PREFIX)) return "Convite para servidor";
  return message.content || (message.attachments.length ? "Arquivo enviado" : fallback);
}

function messageMentionsUsername(content: string, username: string) {
  if (/(?:^|[^a-zA-Z0-9_.-])@(todos|everyone|here)(?=$|[^a-zA-Z0-9_.-])/i.test(content)) return true;
  const escaped = username.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?:^|[^a-zA-Z0-9_.-])@${escaped}(?=$|[^a-zA-Z0-9_.-])`, "i").test(content);
}

function isAppForeground() {
  return document.visibilityState === "visible" && document.hasFocus();
}

function loadServerFolders(): ServerFolder[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(SERVER_FOLDERS_KEY) || "[]") as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((item) => {
      if (!item || typeof item !== "object") return [];
      const folder = item as Partial<ServerFolder>;
      if (typeof folder.id !== "string" || !Array.isArray(folder.guildIds)) return [];
      return [{
        id: folder.id,
        name: typeof folder.name === "string" && folder.name.trim() ? folder.name.slice(0, 32) : "Pasta",
        color: typeof folder.color === "string" && /^#[0-9a-f]{6}$/i.test(folder.color) ? folder.color : SERVER_FOLDER_COLORS[0],
        guildIds: folder.guildIds.filter((id): id is string => typeof id === "string"),
        expanded: folder.expanded !== false
      }];
    });
  } catch {
    return [];
  }
}

const emptyFriends: FriendsPayload = { friends: [], incoming: [], outgoing: [] };

const SELF_PRESENCE_OPTIONS: Array<{ mode: PresenceMode; label: string; detail: string }> = [
  { mode: "ONLINE", label: "Online", detail: "Voce aparece disponivel" },
  { mode: "AWAY", label: "Ausente", detail: "Mostra que voce pode demorar para responder" },
  { mode: "BUSY", label: "Ocupado", detail: "Mostra que voce nao quer ser interrompido" },
  { mode: "OFFLINE", label: "Invisivel", detail: "Voce continua conectado, mas aparece offline" }
];

function presenceModeToAvatarStatus(mode: PresenceMode): "online" | "away" | "busy" | "offline" {
  return mode === "AWAY" ? "away" : mode === "BUSY" ? "busy" : mode === "OFFLINE" ? "offline" : "online";
}

export function Workspace({ token, user, onLogout, onSessionUpdate, onNavigate, desktop }: WorkspaceProps) {
  const socket = useMemo(() => io({
    auth: { token },
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 500,
    reconnectionDelayMax: 5000,
    timeout: 10_000
  }), [token]);
  const [section, setSection] = useState<Section>("space");
  const [guilds, setGuilds] = useState<Guild[]>([]);
  const [selectedGuildId, setSelectedGuildId] = useState("");
  const [selectedChannelId, setSelectedChannelId] = useState("");
  const [members, setMembers] = useState<GuildMember[]>([]);
  const [friends, setFriends] = useState<FriendsPayload>(emptyFriends);
  const [conversations, setConversations] = useState<DirectConversation[]>([]);
  const [selectedConversationId, setSelectedConversationId] = useState("");
  const [activeDirectCallId, setActiveDirectCallId] = useState("");
  const [directCalls, setDirectCalls] = useState<DirectCall[]>([]);
  const [onlineUserIds, setOnlineUserIds] = useState<Set<string>>(new Set());
  const [presenceModes, setPresenceModes] = useState<Record<string, PresenceMode>>({});
  const [selfPresencePreference, setSelfPresencePreference] = useState<PresenceMode>("ONLINE");
  const [selfPresenceMenu, setSelfPresenceMenu] = useState<{ x: number; y: number } | null>(null);
  const [selfPresenceBusy, setSelfPresenceBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [mobileContextOpen, setMobileContextOpen] = useState(false);
  const [error, setError] = useState("");
  const [toast, setToastMessage] = useState("");
  const [toastTone, setToastTone] = useState<"success" | "error" | "info">("success");
  const setToast = useCallback((message: string, tone: "success" | "error" | "info" = "success") => {
    setToastTone(tone);
    setToastMessage(message);
  }, []);
  const [showAddSpace, setShowAddSpace] = useState(false);
  const [serverTemplates, setServerTemplates] = useState<GuildTemplateSummary[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState("basic");
  const [showChannelModal, setShowChannelModal] = useState(false);
  const [channelModalDefaultType, setChannelModalDefaultType] = useState<ChannelType>("TEXT");
  const [showCategoryModal, setShowCategoryModal] = useState(false);
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [draggedChannelId, setDraggedChannelId] = useState("");
  const [draggedCategoryId, setDraggedCategoryId] = useState("");
  const [draggedVoiceMember, setDraggedVoiceMember] = useState<{ userId: string; sourceChannelId: string; guildId: string; displayName: string } | null>(null);
  const [voiceDropTargetChannelId, setVoiceDropTargetChannelId] = useState("");
  const [channelMenu, setChannelMenu] = useState<{ x: number; y: number; channel: Channel; page?: "root" | "mute-duration" } | null>(null);
  const [categoryMenu, setCategoryMenu] = useState<{ x: number; y: number; category: ChannelCategory } | null>(null);
  const [showUserSettings, setShowUserSettings] = useState(false);
  const [userSettingsTab, setUserSettingsTab] = useState<UserSettingsTab>("account");
  const initialUnreadStateRef = useRef<PersistedUnreadState | null>(null);
  if (!initialUnreadStateRef.current) initialUnreadStateRef.current = loadPersistedUnreadState(user.id);
  const [unreadChannels, setUnreadChannels] = useState<Record<string, number>>(() => initialUnreadStateRef.current?.channels ?? {});
  const [mentionedChannels, setMentionedChannels] = useState<Set<string>>(() => new Set(initialUnreadStateRef.current?.mentions ?? []));
  const [unreadDirect, setUnreadDirect] = useState<Record<string, number>>(() => initialUnreadStateRef.current?.direct ?? {});
  const [showServerSettings, setShowServerSettings] = useState(false);
  const [serverSettingsInitialTab, setServerSettingsInitialTab] = useState<ServerSettingsTab | undefined>(undefined);
  const [profileCard, setProfileCard] = useState<ProfileCardState | null>(null);
  const [profileModal, setProfileModal] = useState<ProfileModalState | null>(null);
  const [collapsedMemberGroups, setCollapsedMemberGroups] = useState<Set<string>>(() => new Set());
  const [collapsedChannelCategories, setCollapsedChannelCategories] = useState<Set<string>>(() => new Set());
  const [persistentScreenMenuOpen, setPersistentScreenMenuOpen] = useState(false);
  const [persistentSoundboardOpen, setPersistentSoundboardOpen] = useState(false);
  const [streamViewerCounts, setStreamViewerCounts] = useState<Record<string, number>>({});
  const [inviteCode, setInviteCode] = useState("");
  const [inviteOrigin, setInviteOrigin] = useState("");
  const [copied, setCopied] = useState(false);
  const [inviteFriendQuery, setInviteFriendQuery] = useState("");
  const [inviteSendingTo, setInviteSendingTo] = useState("");
  const [inviteSentTo, setInviteSentTo] = useState<Set<string>>(new Set());
  const [socketConnected, setSocketConnected] = useState(socket.connected);
  const [voicePresence, setVoicePresence] = useState<Record<string, VoicePresenceUser[]>>({});
  const [voiceStreamTarget, setVoiceStreamTarget] = useState<{ channelId: string; userId: string } | null>(null);
  const voicePresenceRevisionRef = useRef(0);
  const directCallJoinInFlightRef = useRef<Set<string>>(new Set());
  const [speakingVoiceUserIds, setSpeakingVoiceUserIds] = useState<Set<string>>(new Set());
  const [musicStates, setMusicStates] = useState<Record<string, MusicState>>({});
  const rememberMusicState = useCallback((state: MusicState) => {
    setMusicStates((current) => ({ ...current, [state.guildId]: state }));
  }, []);
  const [quickOpen, setQuickOpen] = useState(false);
  const [quickQuery, setQuickQuery] = useState("");
  const [voiceControlRevision, setVoiceControlRevision] = useState(0);
  const [serverFolders, setServerFolders] = useState<ServerFolder[]>(loadServerFolders);
  const [draggedGuildId, setDraggedGuildId] = useState("");
  const [folderMenu, setFolderMenu] = useState<{ x: number; y: number; folderId: string } | null>(null);
  const [folderGuildMenu, setFolderGuildMenu] = useState<{ x: number; y: number; guildId: string } | null>(null);
  const [guildMenu, setGuildMenu] = useState<{ x: number; y: number; guild: Guild; page?: "root" | "notifications" } | null>(null);
  const [memberMenu, setMemberMenu] = useState<{ x: number; y: number; member: GuildMember; page?: "root" | "roles" } | null>(null);
  const [directMenu, setDirectMenu] = useState<{ x: number; y: number; conversation: DirectConversation } | null>(null);
  const [voiceUserMenu, setVoiceUserMenu] = useState<{ user: User; x: number; y: number; channelId: string; guildId: string; page?: "root" | "roles" } | null>(null);
  const [contextRolesByGuild, setContextRolesByGuild] = useState<Record<string, CustomRole[]>>({});
  const [contextRolesLoadingGuildId, setContextRolesLoadingGuildId] = useState("");
  const [contextRoleSavingId, setContextRoleSavingId] = useState("");
  const [voiceModerationTarget, setVoiceModerationTarget] = useState<{ action: "kick" | "ban" | "timeout"; user: User; guildId: string } | null>(null);
  const [voiceBanDuration, setVoiceBanDuration] = useState<"PERMANENT" | "1H" | "24H" | "7D" | "30D">("7D");
  const [voiceBanReason, setVoiceBanReason] = useState("");
  const [voiceBanDeleteMinutes, setVoiceBanDeleteMinutes] = useState(0);
  const [voiceTimeoutDuration, setVoiceTimeoutDuration] = useState(10);
  const [voiceTimeoutReason, setVoiceTimeoutReason] = useState("");
  const [voiceModerationBusy, setVoiceModerationBusy] = useState(false);
  const [nicknameEditTarget, setNicknameEditTarget] = useState<{ user: User; guildId: string } | null>(null);
  const [nicknameDraft, setNicknameDraft] = useState("");
  const [nicknameBusy, setNicknameBusy] = useState(false);
  const [musicBotMenu, setMusicBotMenu] = useState<{ x: number; y: number; guildId: string; channelId: string } | null>(null);
  const [guildPreferencesRevision, setGuildPreferencesRevision] = useState(0);
  const [developerMode, setDeveloperMode] = useState(() => loadDeveloperPreferences().enabled);
  const [showNotificationCenter, setShowNotificationCenter] = useState(false);
  const [showGlobalSearch, setShowGlobalSearch] = useState(false);
  const [directCallHistory, setDirectCallHistory] = useState<DirectCall[]>([]);

  useEffect(() => () => { socket.disconnect(); }, [socket]);

  useEffect(() => {
    const syncDeveloperMode = () => setDeveloperMode(loadDeveloperPreferences().enabled);
    window.addEventListener(DEVELOPER_MODE_EVENT, syncDeveloperMode);
    window.addEventListener("storage", syncDeveloperMode);
    return () => {
      window.removeEventListener(DEVELOPER_MODE_EVENT, syncDeveloperMode);
      window.removeEventListener("storage", syncDeveloperMode);
    };
  }, []);

  useEffect(() => {
    const refreshGuildPreferences = () => setGuildPreferencesRevision((value) => value + 1);
    window.addEventListener(GUILD_PREFERENCES_EVENT, refreshGuildPreferences);
    window.addEventListener("storage", refreshGuildPreferences);
    return () => {
      window.removeEventListener(GUILD_PREFERENCES_EVENT, refreshGuildPreferences);
      window.removeEventListener("storage", refreshGuildPreferences);
    };
  }, []);

  useEffect(() => {
    try { localStorage.setItem(SERVER_FOLDERS_KEY, JSON.stringify(serverFolders)); } catch { /* Preferencia local opcional. */ }
  }, [serverFolders]);

  useEffect(() => {
    if (!selectedGuildId) { setCollapsedChannelCategories(new Set()); return; }
    try {
      const raw = JSON.parse(localStorage.getItem(`ginga.collapsedChannelCategories.v1.${selectedGuildId}`) || "[]") as unknown;
      setCollapsedChannelCategories(new Set(Array.isArray(raw) ? raw.filter((id): id is string => typeof id === "string") : []));
    } catch { setCollapsedChannelCategories(new Set()); }
  }, [selectedGuildId]);

  const toggleChannelCategoryCollapsed = useCallback((categoryId: string) => {
    setCollapsedChannelCategories((current) => {
      const next = new Set(current);
      if (next.has(categoryId)) next.delete(categoryId); else next.add(categoryId);
      if (selectedGuildId) {
        try { localStorage.setItem(`ginga.collapsedChannelCategories.v1.${selectedGuildId}`, JSON.stringify([...next])); } catch {}
      }
      return next;
    });
  }, [selectedGuildId]);

  useEffect(() => {
    const validIds = new Set(guilds.map((guild) => guild.id));
    setServerFolders((current) => current
      .map((folder) => ({ ...folder, guildIds: folder.guildIds.filter((id) => validIds.has(id)) }))
      .filter((folder) => folder.guildIds.length > 0));
  }, [guilds]);

  useEffect(() => {
    if (!showAddSpace || serverTemplates.length > 0) return;
    api<{ templates: GuildTemplateSummary[] }>("/api/guild-templates")
      .then((result) => setServerTemplates(result.templates))
      .catch(() => setServerTemplates([]));
  }, [serverTemplates.length, showAddSpace]);

  const loadGuilds = useCallback(async (preferredGuildId?: string) => {
    const result = await api<{ guilds: Guild[] }>("/api/guilds");
    setGuilds(result.guilds);
    setSelectedGuildId((current) => {
      if (preferredGuildId && result.guilds.some((guild) => guild.id === preferredGuildId)) return preferredGuildId;
      if (result.guilds.some((guild) => guild.id === current)) return current;
      return result.guilds[0]?.id ?? "";
    });
  }, []);

  const loadFriends = useCallback(async () => {
    const result = await api<FriendsPayload>("/api/friends");
    setFriends(result);
  }, []);

  const loadConversations = useCallback(async () => {
    const result = await api<{ conversations: DirectConversation[] }>("/api/direct/conversations");
    setConversations(result.conversations.filter((conversation) => Boolean(conversation.otherUser)));
  }, []);

  const loadDirectCallHistory = useCallback(async () => {
    const result = await api<{ calls: DirectCall[] }>("/api/direct-calls/history?limit=24");
    setDirectCallHistory(result.calls);
  }, []);

  const loadMembers = useCallback(async (guildId = selectedGuildId) => {
    if (!guildId) { setMembers([]); return; }
    const result = await api<{ members: GuildMember[] }>(`/api/guilds/${guildId}/members`);
    setMembers(result.members);
  }, [selectedGuildId]);

  const loadContextRoles = useCallback(async (guildId: string, force = false) => {
    if (!guildId) return [] as CustomRole[];
    if (!force && contextRolesByGuild[guildId]) return contextRolesByGuild[guildId];
    setContextRolesLoadingGuildId(guildId);
    try {
      const result = await api<{ roles: CustomRole[] }>(`/api/guilds/${guildId}/custom-roles`);
      setContextRolesByGuild((current) => ({ ...current, [guildId]: result.roles }));
      return result.roles;
    } finally {
      setContextRolesLoadingGuildId((current) => current === guildId ? "" : current);
    }
  }, [contextRolesByGuild]);

  async function setContextMemberCustomRole(guildId: string, member: GuildMember, role: CustomRole, enabled: boolean) {
    if (role.managed || contextRoleSavingId) return;
    const currentRoles = member.customRoles ?? [];
    const currentIds = currentRoles.map((item) => item.id);
    const roleIds = enabled ? [...new Set([...currentIds, role.id])] : currentIds.filter((id) => id !== role.id);
    setContextRoleSavingId(role.id);
    try {
      await api(`/api/guilds/${guildId}/members/${member.user.id}/custom-roles`, { method: "PUT", body: JSON.stringify({ roleIds }) });
      const nextRoles = enabled
        ? [...currentRoles.filter((item) => item.id !== role.id), role].sort((a, b) => b.position - a.position)
        : currentRoles.filter((item) => item.id !== role.id);
      setMembers((current) => current.map((item) => item.user.id === member.user.id ? { ...item, customRoles: nextRoles } : item));
      setMemberMenu((current) => current?.member.user.id === member.user.id ? { ...current, member: { ...current.member, customRoles: nextRoles } } : current);
      setToast(enabled ? `${role.name} adicionado a ${member.user.displayName}` : `${role.name} removido de ${member.user.displayName}`);
      void loadMembers(guildId).catch(() => undefined);
    } catch (caught) {
      setToast(caught instanceof Error ? caught.message : "Nao foi possivel atualizar o cargo");
    } finally {
      setContextRoleSavingId("");
    }
  }

  useEffect(() => {
    setLoading(true);
    Promise.all([loadGuilds(), loadFriends(), loadConversations(), loadDirectCallHistory()])
      .catch((caught) => setError(caught instanceof Error ? caught.message : "Falha ao carregar o Ginga"))
      .finally(() => setLoading(false));
  }, [loadConversations, loadDirectCallHistory, loadFriends, loadGuilds]);

  useEffect(() => {
    const refreshSocial = () => {
      void Promise.all([loadFriends(), loadConversations()]);
    };
    const timer = window.setInterval(refreshSocial, 20_000);
    window.addEventListener("focus", refreshSocial);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", refreshSocial);
    };
  }, [loadConversations, loadFriends]);

  useEffect(() => {
    if (!selectedGuildId) { setMembers([]); return; }
    void loadMembers(selectedGuildId).catch(() => setMembers([]));
  }, [loadMembers, selectedGuildId]);

  useEffect(() => {
    const onConnect = () => setSocketConnected(true);
    const onDisconnect = () => setSocketConnected(false);
    const onConnectError = (caught: Error) => {
      setSocketConnected(false);
      setError(caught.message || "Falha na conexao em tempo real");
    };
    const onPresence = ({ userId, online }: { userId: string; online: boolean }) => {
      setOnlineUserIds((current) => {
        const next = new Set(current);
        if (online) next.add(userId); else next.delete(userId);
        return next;
      });
      setPresenceModes((current) => ({ ...current, [userId]: online ? (current[userId] === "OFFLINE" ? "ONLINE" : current[userId] ?? "ONLINE") : "OFFLINE" }));
    };
    const onRichPresence = ({ userId, presence }: { userId: string; presence: PresenceMode }) => {
      if (!userId || !presence) return;
      setPresenceModes((current) => ({ ...current, [userId]: presence }));
      setOnlineUserIds((current) => {
        const next = new Set(current);
        if (presence === "OFFLINE") next.delete(userId); else next.add(userId);
        return next;
      });
    };
    const onDirectMessage = (message: DirectMessage) => {
      void loadConversations();
      if (message.authorId === user.id) return;

      const isReadingNow = section === "direct" && selectedConversationId === message.conversationId && isAppForeground();
      if (!isReadingNow) {
        setUnreadDirect((current) => ({ ...current, [message.conversationId]: Math.min(99, (current[message.conversationId] ?? 0) + 1) }));
      }

      const preferences = loadNotificationPreferences();
      if (preferences.playSound) void playUiSound("message");
      if (preferences.desktopMessages && !isAppForeground()) {
        const preview = preferences.showPreview
          ? (message.content.trim() || "Enviou um arquivo").slice(0, 180)
          : "Voce recebeu uma nova mensagem privada.";
        void showSystemNotification({
          title: message.author.displayName,
          body: preview,
          // O Ginga toca o proprio som; evita dobrar com o som padrao do Windows.
          silent: true,
          durationMs: 5000,
          taskbarBadge: false
        });
      }
    };
    const onGuildMessage = (payload: {
      messageId: string;
      channelId: string;
      channelName?: string;
      guildId: string;
      authorId: string;
      author?: User;
      content?: string;
      hasAttachments?: boolean;
    }) => {
      if (payload.authorId === user.id) return;
      const isReadingNow = section === "space" && selectedChannelId === payload.channelId && isAppForeground();
      if (isReadingNow) return;

      setUnreadChannels((current) => ({ ...current, [payload.channelId]: Math.min(99, (current[payload.channelId] ?? 0) + 1) }));

      const guildPreferences = loadGuildPreferences(payload.guildId);
      const channelMuted = isChannelMuted(guildPreferences, payload.channelId);
      const mention = messageMentionsUsername(payload.content ?? "", user.username);
      if (mention) setMentionedChannels((current) => { const next = new Set(current); next.add(payload.channelId); return next; });
      if (channelMuted || !guildAllowsMessageActivity(guildPreferences, mention, payload.channelId)) return;

      const preferences = loadNotificationPreferences();
      // Mencoes sao sonorizadas pelo evento direcionado notification:message.
      // Isso evita o ping duplicado (guild:message:new + notification:message).
      if (!mention && preferences.playSound) void playUiSound("message");

      // Mencoes usam o evento direcionado notification:message, que passa por ACL
      // e evita duas notificacoes do Windows para a mesma mensagem.
      if (mention || isAppForeground() || !preferences.desktopChannelMessages) return;
      const guild = guilds.find((item) => item.id === payload.guildId);
      const channelName = payload.channelName || guild?.channels.find((item) => item.id === payload.channelId)?.name || "canal";
      const preview = preferences.showPreview
        ? `${payload.author?.displayName ?? "Alguem"}: ${(payload.content?.trim() || (payload.hasAttachments ? "Enviou um arquivo" : "Nova mensagem"))}`.slice(0, 190)
        : `Nova mensagem em #${channelName}`;
      void showSystemNotification({
        title: guild ? `${guild.name} · #${channelName}` : `#${channelName}`,
        body: preview,
        silent: true,
        durationMs: 5000,
        taskbarBadge: false
      });
    };
    const onMessageNotification = (payload: {
      kind: "MENTION" | "EVERYONE";
      channelId: string;
      guildId: string;
      channelName: string;
      guildName: string;
      content: string;
      author: User;
    }) => {
      if (payload.author.id === user.id) return;
      const isReadingNow = section === "space" && selectedChannelId === payload.channelId && isAppForeground();
      if (!isReadingNow) {
        setMentionedChannels((current) => { const next = new Set(current); next.add(payload.channelId); return next; });
        setUnreadChannels((current) => ({ ...current, [payload.channelId]: Math.max(1, current[payload.channelId] ?? 0) }));
      }

      const guildPreferences = loadGuildPreferences(payload.guildId);
      const channelMuted = isChannelMuted(guildPreferences, payload.channelId);
      if (channelMuted || isGuildSilent(guildPreferences)) return;

      const preferences = loadNotificationPreferences();
      // Se o usuario ja esta lendo este canal, o ChatView toca o som. Nos demais
      // casos este evento direcionado e a unica fonte do som de mencao.
      if (preferences.playSound && !isReadingNow) void playUiSound("notification");
      if (isReadingNow || isAppForeground()) return;
      if (payload.kind === "MENTION" && !preferences.desktopMentions) return;
      if (payload.kind === "EVERYONE" && !preferences.desktopEveryoneMentions) return;
      const preview = preferences.showPreview
        ? `${payload.author.displayName}: ${payload.content}`.slice(0, 190)
        : (payload.kind === "EVERYONE" ? "Nova mencao @todos." : "Voce foi mencionado em uma mensagem.");
      void showSystemNotification({
        title: `${payload.guildName} · #${payload.channelName}`,
        body: preview,
        silent: true,
        durationMs: 5000,
        taskbarBadge: false
      });
    };
    const disconnectVoiceIfGuildMatches = (guildId: string) => {
      const channelId = window.__gingaVoiceSession?.channelId;
      if (!channelId) return false;
      const voiceGuild = guilds.find((guild) => guild.channels.some((channel) => channel.id === channelId));
      if (voiceGuild?.id !== guildId) return false;
      disconnectPersistentVoice();
      return true;
    };
    const onModeration = (payload: { guildId: string; action: "KICK" | "BAN" }) => {
      disconnectVoiceIfGuildMatches(payload.guildId);
      setShowServerSettings(false);
      if (selectedGuildId === payload.guildId) setSelectedChannelId("");
      setToast(payload.action === "BAN" ? "Voce foi banido deste espaco" : "Voce foi removido deste espaco");
      void loadGuilds();
    };
    const onGuildTimeout = (payload: { guildId: string; timeoutUntil?: string; reason?: string }) => {
      const disconnected = disconnectVoiceIfGuildMatches(payload.guildId);
      if (payload.guildId === selectedGuildId) void loadMembers(payload.guildId);
      const until = payload.timeoutUntil ? new Date(payload.timeoutUntil) : null;
      const duration = until && !Number.isNaN(until.getTime()) ? ` ate ${until.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}` : "";
      setToast(`${disconnected ? "Voce foi removido da voz e " : ""}entrou em timeout${duration}${payload.reason ? `: ${payload.reason}` : ""}`);
    };
    const onGuildTimeoutRemoved = (payload: { guildId: string }) => {
      if (payload.guildId === selectedGuildId) void loadMembers(payload.guildId);
      setToast("Seu timeout foi removido");
    };
    const onGuildLeft = (payload: { guildId: string; name?: string }) => {
      disconnectVoiceIfGuildMatches(payload.guildId);
      if (selectedGuildId === payload.guildId) setSelectedChannelId("");
      void loadGuilds();
    };
    const onGuildDeleted = (payload: { guildId: string; name?: string }) => {
      disconnectVoiceIfGuildMatches(payload.guildId);
      setShowServerSettings(false);
      if (selectedGuildId === payload.guildId) {
        setSelectedChannelId("");
        setSelectedGuildId("");
      }
      setToast(payload.name ? `${payload.name} foi excluido` : "Este espaco foi excluido");
      void loadGuilds();
    };
    const onVoiceModerationState = (payload: { guildId: string; muted?: boolean; deafened?: boolean }) => {
      window.dispatchEvent(new CustomEvent("ginga:voice-server-moderation", { detail: payload }));
      if (payload.guildId === selectedGuildId) void loadMembers(payload.guildId);
      if (payload.muted === true) setToast("Seu microfone foi mutado por um moderador");
      else if (payload.deafened === true) setToast("Voce foi ensurdecido por um moderador");
      else if (payload.muted === false || payload.deafened === false) setToast("Uma restricao de voz foi removida");
    };
    const onVoiceMoved = (payload: { guildId: string; channelId: string; reason?: "AFK" | "MODERATION" }) => {
      void (async () => {
        await loadGuilds(payload.guildId);
        setSelectedGuildId(payload.guildId);
        setSelectedChannelId(payload.channelId);
        setSection("space");
        setActiveDirectCallId("");
        setToast(payload.reason === "AFK" ? "Voce foi movido para Ausente por inatividade" : "Voce foi movido para outra sala de voz");
      })();
    };
    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);
    socket.on("connect_error", onConnectError);
    socket.on("presence:user", onPresence);
    socket.on("ginga:presence:update", onRichPresence);
    socket.on("direct:message:new", onDirectMessage);
    socket.on("guild:message:new", onGuildMessage);
    socket.on("notification:message", onMessageNotification);
    socket.on("guild:moderation", onModeration);
    socket.on("guild:timeout", onGuildTimeout);
    socket.on("guild:timeout:removed", onGuildTimeoutRemoved);
    socket.on("guild:left", onGuildLeft);
    socket.on("guild:deleted", onGuildDeleted);
    socket.on("voice:moved", onVoiceMoved);
    socket.on("voice:moderation-state", onVoiceModerationState);
    setSocketConnected(socket.connected);

    return () => {
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
      socket.off("connect_error", onConnectError);
      socket.off("presence:user", onPresence);
      socket.off("ginga:presence:update", onRichPresence);
      socket.off("direct:message:new", onDirectMessage);
      socket.off("guild:message:new", onGuildMessage);
      socket.off("notification:message", onMessageNotification);
      socket.off("guild:moderation", onModeration);
      socket.off("guild:timeout", onGuildTimeout);
      socket.off("guild:timeout:removed", onGuildTimeoutRemoved);
      socket.off("guild:left", onGuildLeft);
      socket.off("guild:deleted", onGuildDeleted);
      socket.off("voice:moved", onVoiceMoved);
      socket.off("voice:moderation-state", onVoiceModerationState);
    };
  }, [guilds, loadConversations, loadGuilds, loadMembers, section, selectedChannelId, selectedConversationId, selectedGuildId, socket, user.id, user.username]);

  useEffect(() => {
    const bridge = getDirectCallsBridge();
    const onCalls = (event: Event) => {
      const calls = (event as CustomEvent<{ calls?: DirectCall[] }>).detail?.calls ?? [];
      setDirectCalls(calls);
      const incoming = calls.find((call) => call.membershipStatus === "INVITED" && (call.state === "RINGING" || call.state === "ACTIVE"));
      if (incoming) {
        const preferences = loadNotificationPreferences();
        if (preferences.desktopCalls && !isAppForeground()) {
          void showSystemNotification({
            title: incoming.state === "ACTIVE" ? "Convite para chamada em grupo" : `Chamada de ${incoming.peer?.displayName ?? "alguem"}`,
            body: incoming.state === "ACTIVE" ? "Voce foi convidado para entrar na chamada." : "Chamada privada no Ginga",
            silent: true,
            durationMs: 7000,
            taskbarBadge: false
          });
        }
      }
    };
    const onSocketCall = () => { void bridge?.refresh(); void loadDirectCallHistory().catch(() => undefined); };
    window.addEventListener("ginga:direct-calls:update", onCalls as EventListener);
    socket.on("direct-call:event", onSocketCall);
    void bridge?.refresh();
    return () => {
      window.removeEventListener("ginga:direct-calls:update", onCalls as EventListener);
      socket.off("direct-call:event", onSocketCall);
    };
  }, [loadDirectCallHistory, socket]);

  useEffect(() => {
    if (section !== "space" || !selectedChannelId) return;
    setUnreadChannels((current) => { if (!current[selectedChannelId]) return current; const next = { ...current }; delete next[selectedChannelId]; return next; });
    setMentionedChannels((current) => { if (!current.has(selectedChannelId)) return current; const next = new Set(current); next.delete(selectedChannelId); return next; });
  }, [section, selectedChannelId]);

  useEffect(() => {
    if (section !== "direct" || !selectedConversationId) return;
    setUnreadDirect((current) => { if (!current[selectedConversationId]) return current; const next = { ...current }; delete next[selectedConversationId]; return next; });
  }, [section, selectedConversationId]);

  // Ao voltar para o Ginga, marca como lido somente o que esta realmente aberto.
  // O desktop nao zera mais o contador inteiro so porque ganhou foco.
  useEffect(() => {
    const markVisibleSelectionRead = () => {
      if (!isAppForeground()) return;
      if (section === "space" && selectedChannelId) {
        setUnreadChannels((current) => {
          if (!current[selectedChannelId]) return current;
          const next = { ...current };
          delete next[selectedChannelId];
          return next;
        });
        setMentionedChannels((current) => {
          if (!current.has(selectedChannelId)) return current;
          const next = new Set(current);
          next.delete(selectedChannelId);
          return next;
        });
      }
      if (section === "direct" && selectedConversationId) {
        setUnreadDirect((current) => {
          if (!current[selectedConversationId]) return current;
          const next = { ...current };
          delete next[selectedConversationId];
          return next;
        });
      }
    };
    window.addEventListener("focus", markVisibleSelectionRead);
    document.addEventListener("visibilitychange", markVisibleSelectionRead);
    return () => {
      window.removeEventListener("focus", markVisibleSelectionRead);
      document.removeEventListener("visibilitychange", markVisibleSelectionRead);
    };
  }, [section, selectedChannelId, selectedConversationId]);

  const attentionUnreadCount = useMemo(() => {
    let total = Object.values(unreadDirect).reduce((sum, value) => sum + Math.max(0, Number(value) || 0), 0);
    for (const [channelId, rawCount] of Object.entries(unreadChannels)) {
      const count = Math.max(0, Number(rawCount) || 0);
      if (!count) continue;
      const guild = guilds.find((item) => item.channels.some((channel) => channel.id === channelId));
      if (!guild) { total += count; continue; }
      const preferences = loadGuildPreferences(guild.id);
      if (isChannelMuted(preferences, channelId)) continue;
      const mode = guildNotificationMode(preferences);
      if (mode === "SILENT") continue;
      if (mode === "MENTIONS" && !mentionedChannels.has(channelId)) continue;
      total += count;
    }
    return Math.min(999, total);
  }, [guildPreferencesRevision, guilds, mentionedChannels, unreadChannels, unreadDirect]);

  useEffect(() => {
    void setDesktopUnreadCount(attentionUnreadCount);
    document.title = attentionUnreadCount > 0 ? `(${attentionUnreadCount > 99 ? "99+" : attentionUnreadCount}) Ginga` : "Ginga";
  }, [attentionUnreadCount]);

  useEffect(() => {
    savePersistedUnreadState(user.id, {
      channels: unreadChannels,
      direct: unreadDirect,
      mentions: Array.from(mentionedChannels)
    });
  }, [mentionedChannels, unreadChannels, unreadDirect, user.id]);

  const notificationCenterItems = useMemo(() => {
    const items: Array<{ id:string; kind:"channel"|"direct"; title:string; detail:string; count:number; mention:boolean; guildId?:string; channelId?:string; conversationId?:string }> = [];
    for (const guild of guilds) { const prefs=loadGuildPreferences(guild.id); for (const channel of guild.channels) { const count=unreadChannels[channel.id]??0; if(!count)continue; items.push({id:`channel:${channel.id}`,kind:"channel",title:`#${channel.name}`,detail:guild.name+(isChannelMuted(prefs,channel.id)?" · silenciado":""),count,mention:mentionedChannels.has(channel.id),guildId:guild.id,channelId:channel.id}); } }
    for (const conversation of conversations) { const count=unreadDirect[conversation.id]??0;if(!count)continue;items.push({id:`direct:${conversation.id}`,kind:"direct",title:conversation.otherUser.displayName,detail:`@${conversation.otherUser.username}`,count,mention:false,conversationId:conversation.id}); }
    return items.sort((a,b)=>Number(b.mention)-Number(a.mention)||b.count-a.count);
  }, [conversations, guildPreferencesRevision, guilds, mentionedChannels, unreadChannels, unreadDirect]);

  function openNotificationCenterItem(item: (typeof notificationCenterItems)[number]) {
    if (item.kind === "direct" && item.conversationId) openConversation(item.conversationId);
    else if (item.guildId && item.channelId) { setSelectedGuildId(item.guildId); setSelectedChannelId(item.channelId); setSection("space"); setActiveDirectCallId(""); markChannelRead(item.channelId); }
    setShowNotificationCenter(false);
  }
  function markAllNotificationsRead(){ setUnreadChannels({});setMentionedChannels(new Set());setUnreadDirect({});setShowNotificationCenter(false);setToast("Tudo marcado como lido"); }


  const presenceIds = useMemo(() => {
    const ids = new Set<string>();
    friends.friends.forEach((entry) => ids.add(entry.user.id));
    friends.incoming.forEach((entry) => ids.add(entry.user.id));
    conversations.forEach((conversation) => ids.add(conversation.otherUser.id));
    members.forEach((member) => ids.add(member.user.id));
    ids.delete(user.id);
    return Array.from(ids);
  }, [conversations, friends, members, user.id]);

  useEffect(() => {
    if (!socket.connected || presenceIds.length === 0) return;
    socket.emit("presence:query", { userIds: presenceIds }, (response: { ok: boolean; onlineUserIds?: string[]; presenceByUserId?: Record<string, PresenceMode> }) => {
      if (!response?.ok) return;
      setOnlineUserIds(new Set(response.onlineUserIds ?? []));
      if (response.presenceByUserId) setPresenceModes((current) => ({ ...current, ...response.presenceByUserId }));
    });
  }, [presenceIds.join("|"), socket, socketConnected]);

  useEffect(() => {
    let cancelled = false;
    void api<{ profile: { presence: PresenceMode; settings?: { presenceMode?: PresenceMode } } }>("/api/gaming-profile/me")
      .then(({ profile }) => {
        if (cancelled) return;
        setPresenceModes((current) => ({ ...current, [user.id]: profile.presence }));
        setSelfPresencePreference(profile.settings?.presenceMode ?? profile.presence);
      })
      .catch(() => undefined);
    const onLocalProfileUpdate = (event: Event) => {
      const profile = (event as CustomEvent<{ presence?: PresenceMode; settings?: { presenceMode?: PresenceMode } }>).detail;
      if (profile?.presence) setPresenceModes((current) => ({ ...current, [user.id]: profile.presence! }));
      if (profile?.settings?.presenceMode) setSelfPresencePreference(profile.settings.presenceMode);
    };
    window.addEventListener("ginga:profile-local-update", onLocalProfileUpdate as EventListener);
    return () => { cancelled = true; window.removeEventListener("ginga:profile-local-update", onLocalProfileUpdate as EventListener); };
  }, [user.id]);

  async function chooseOwnPresence(mode: PresenceMode) {
    if (selfPresenceBusy) return;
    setSelfPresenceBusy(true);
    try {
      const effective = await setOwnPresenceMode(mode);
      setSelfPresencePreference(mode);
      setPresenceModes((current) => ({ ...current, [user.id]: effective }));
      setSelfPresenceMenu(null);
      setToast(mode === "OFFLINE" ? "Agora voce esta invisivel" : `Status alterado para ${SELF_PRESENCE_OPTIONS.find((item) => item.mode === mode)?.label ?? mode}`);
    } catch (caught) {
      setToast(caught instanceof Error ? caught.message : "Nao foi possivel alterar seu status", "error");
    } finally { setSelfPresenceBusy(false); }
  }

  useEffect(() => {
    const onMusicState = (state: MusicState) => rememberMusicState(state);
    socket.on("music:state", onMusicState);
    return () => { socket.off("music:state", onMusicState); };
  }, [rememberMusicState, socket]);

  useEffect(() => {
    if (!selectedGuildId) return;
    let cancelled = false;
    void api<MusicPayload>(`/api/guilds/${selectedGuildId}/music`)
      .then((payload) => { if (!cancelled) rememberMusicState(payload.state); })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, [rememberMusicState, selectedGuildId]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(""), 3200);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    const onOffline = () => setToast("Sem conexao com a rede. O Ginga vai reconectar automaticamente.");
    const onOnline = () => {
      setToast("Conexao restaurada. Sincronizando o Ginga...");
      if (!socket.connected) socket.connect();
      const session = window.__gingaVoiceSession;
      if (session?.channelId) {
        socket.emit("voice:sync", {
          channelId: session.channelId,
          micMuted: !session.room.localParticipant.isMicrophoneEnabled,
          deafened: Boolean(session.deafened)
        });
      }
    };
    window.addEventListener("offline", onOffline);
    window.addEventListener("online", onOnline);
    if (!navigator.onLine) onOffline();
    return () => {
      window.removeEventListener("offline", onOffline);
      window.removeEventListener("online", onOnline);
    };
  }, [socket]);

  useEffect(() => {
    setVoicePresence({});
    voicePresenceRevisionRef.current = 0;
    if (!selectedGuildId) return;
    const watchGuild = () => {
      socket.emit("guild:watch", { guildId: selectedGuildId }, (response: { ok: boolean; error?: string }) => {
        if (!response?.ok) setError(response?.error ?? "Nao foi possivel acompanhar o espaco");
      });
    };
    const onVoicePresence = (payload: VoicePresencePayload) => {
      if (payload.guildId !== selectedGuildId) return;
      const revision = Math.max(0, Number(payload.revision) || 0);
      if (revision > 0 && revision < voicePresenceRevisionRef.current) return;
      if (revision > 0) voicePresenceRevisionRef.current = revision;
      setVoicePresence(payload.channels);
    };
    const onStructureChanged = (payload: { guildId: string }) => {
      if (payload.guildId !== selectedGuildId) return;
      void Promise.all([loadGuilds(selectedGuildId), loadMembers(selectedGuildId)]);
    };
    socket.on("voice:presence", onVoicePresence);
    socket.on("guild:structure:changed", onStructureChanged);
    socket.on("connect", watchGuild);
    if (socket.connected) watchGuild();
    return () => {
      socket.off("voice:presence", onVoicePresence);
      socket.off("guild:structure:changed", onStructureChanged);
      socket.off("connect", watchGuild);
    };
  }, [loadGuilds, loadMembers, selectedGuildId, socket]);

  useEffect(() => {
    const onRuntimeWarning = () => setToast("O Ginga isolou uma falha de fundo. Se algo nao responder, tente a acao novamente.");
    window.addEventListener("ginga:runtime-warning", onRuntimeWarning as EventListener);
    return () => window.removeEventListener("ginga:runtime-warning", onRuntimeWarning as EventListener);
  }, []);

  useEffect(() => {
    const onMicRecoveryFailed = (event: Event) => {
      const detail = (event as CustomEvent<{ channelId?: string }>).detail;
      if (detail?.channelId && detail.channelId !== window.__gingaVoiceSession?.channelId) return;
      setToast("O microfone parou de enviar audio. Abra Voz e video e confira o dispositivo.");
    };
    const onVoiceRecoveryFailed = (event: Event) => {
      const detail = (event as CustomEvent<{ channelId?: string }>).detail;
      if (detail?.channelId && detail.channelId !== window.__gingaVoiceSession?.channelId) return;
      setToast("A conexao de voz caiu e nao conseguiu se recuperar. O Ginga vai tentar novamente ao voltar a rede/foco.");
    };
    const onVoiceDeviceFallback = (event: Event) => {
      const detail = (event as CustomEvent<{ channelId?: string; kind?: string }>).detail;
      if (detail?.channelId && detail.channelId !== window.__gingaVoiceSession?.channelId) return;
      setToast("O microfone configurado sumiu. O Ginga trocou automaticamente para o dispositivo padrao.");
    };
    window.addEventListener("ginga:voice-mic-recovery-failed", onMicRecoveryFailed as EventListener);
    window.addEventListener("ginga:voice-recovery-failed", onVoiceRecoveryFailed as EventListener);
    window.addEventListener("ginga:voice-device-fallback", onVoiceDeviceFallback as EventListener);
    return () => {
      window.removeEventListener("ginga:voice-mic-recovery-failed", onMicRecoveryFailed as EventListener);
      window.removeEventListener("ginga:voice-recovery-failed", onVoiceRecoveryFailed as EventListener);
      window.removeEventListener("ginga:voice-device-fallback", onVoiceDeviceFallback as EventListener);
    };
  }, []);

  useEffect(() => {
    const onSpeaking = (event: Event) => {
      const detail = (event as CustomEvent<{ channelId?: string; userIds?: string[] }>).detail;
      if (!detail?.channelId) return;
      setSpeakingVoiceUserIds(new Set(Array.isArray(detail.userIds) ? detail.userIds.filter((id): id is string => typeof id === "string") : []));
    };
    const clearSpeaking = () => setSpeakingVoiceUserIds(new Set());
    window.addEventListener("ginga:voice-speaking", onSpeaking as EventListener);
    window.addEventListener("ginga:voice-presence", clearSpeaking as EventListener);
    return () => {
      window.removeEventListener("ginga:voice-speaking", onSpeaking as EventListener);
      window.removeEventListener("ginga:voice-presence", clearSpeaking as EventListener);
    };
  }, []);

  useEffect(() => {
    const onViewerCount = (payload: { channelId?: string; broadcasterId?: string; count?: number }) => {
      if (!payload.channelId || !payload.broadcasterId) return;
      setStreamViewerCounts((current) => ({ ...current, [`${payload.channelId}:${payload.broadcasterId}`]: Math.max(0, Number(payload.count) || 0) }));
    };
    socket.on("voice:stream-viewers", onViewerCount);
    return () => { socket.off("voice:stream-viewers", onViewerCount); };
  }, [socket]);

  const selectedGuild = guilds.find((guild) => guild.id === selectedGuildId);
  const selectedGuildPreferences = useMemo(() => selectedGuild ? loadGuildPreferences(selectedGuild.id) : null, [selectedGuild?.id, guildPreferencesRevision]);
  const selectedChannel = selectedGuild?.channels.find((channel) => channel.id === selectedChannelId);
  const activeVoiceChannelId = useMemo(() => {
    for (const [channelId, users] of Object.entries(voicePresence)) {
      if (users.some((voiceUser) => voiceUser.id === user.id)) return channelId;
    }
    return window.__gingaVoiceSession?.channelId ?? "";
  }, [user.id, voicePresence, voiceControlRevision]);
  const activeVoiceGuild = guilds.find((guild) => guild.channels.some((channel) => channel.id === activeVoiceChannelId));
  const activeVoiceChannel = activeVoiceGuild?.channels.find((channel) => channel.id === activeVoiceChannelId);
  const localVoicePresence = activeVoiceChannelId ? (voicePresence[activeVoiceChannelId] ?? []).find((voiceUser) => voiceUser.id === user.id) : undefined;
  const voiceViewVisible = Boolean(section === "space" && selectedChannel?.type === "VOICE" && selectedChannel.id === activeVoiceChannelId);
  // O card compacto serve apenas como controle persistente quando o usuario saiu da tela de voz.
  // Em qualquer sala de voz a barra principal ja esta visivel, entao mostrar os dois controles duplica a UI.
  const showPersistentVoiceCard = Boolean(activeVoiceChannelId && activeVoiceChannel && !voiceViewVisible);
  const persistentScreenEnabled = Boolean(window.__gingaVoiceSession?.channelId === activeVoiceChannelId && window.__gingaVoiceSession.room.localParticipant.isScreenShareEnabled) || Boolean(localVoicePresence?.streaming);
  const persistentViewerCount = activeVoiceChannelId ? (streamViewerCounts[`${activeVoiceChannelId}:${user.id}`] ?? 0) : 0;

  useEffect(() => {
    setPersistentSoundboardOpen(false);
  }, [activeVoiceChannelId]);

  useEffect(() => {
    const onVoiceDisconnected = (payload: { guildId: string }) => {
      if (!activeVoiceChannelId || payload.guildId !== activeVoiceGuild?.id) return;
      disconnectPersistentVoice();
      setToast("Voce foi desconectado da sala de voz por um moderador");
    };
    const onVoiceSessionReplaced = (payload: { channelId?: string; replacementChannelId?: string }) => {
      const session = window.__gingaVoiceSession;
      if (!session || (payload.channelId && payload.channelId !== session.channelId)) return;
      if (session.reconnectListener) socket.off("connect", session.reconnectListener);
      try { session.room.disconnect(); } catch {}
      window.__gingaVoiceSession = undefined;
      window.dispatchEvent(new CustomEvent("ginga:voice-presence", { detail: { channelId: session.channelId, connected: false } }));
      setVoiceControlRevision((value) => value + 1);
      setToast("Sua voz foi transferida para outra janela ou dispositivo do Ginga");
    };
    socket.on("voice:disconnected", onVoiceDisconnected);
    socket.on("voice:session-replaced", onVoiceSessionReplaced);
    return () => {
      socket.off("voice:disconnected", onVoiceDisconnected);
      socket.off("voice:session-replaced", onVoiceSessionReplaced);
    };
  }, [activeVoiceChannelId, activeVoiceGuild?.id, socket]);

  useEffect(() => {
    if (!activeVoiceGuild?.afkEnabled || !activeVoiceGuild.afkChannelId || !activeVoiceChannelId) return;
    if (activeVoiceChannelId === activeVoiceGuild.afkChannelId) return;
    const timeoutMs = Math.max(5, Math.min(120, activeVoiceGuild.afkTimeoutMinutes ?? 15)) * 60_000;
    let timer = 0;
    const arm = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        socket.emit("voice:self-afk", { guildId: activeVoiceGuild.id }, (response?: { ok?: boolean; error?: string }) => {
          if (response?.ok === false) setToast(response.error || "Nao foi possivel mover para Ausente");
        });
      }, timeoutMs);
    };
    const activity = () => arm();
    arm();
    window.addEventListener("keydown", activity, { passive: true });
    window.addEventListener("pointerdown", activity, { passive: true });
    window.addEventListener("wheel", activity, { passive: true });
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("keydown", activity);
      window.removeEventListener("pointerdown", activity);
      window.removeEventListener("wheel", activity);
    };
  }, [activeVoiceChannelId, activeVoiceGuild?.id, activeVoiceGuild?.afkEnabled, activeVoiceGuild?.afkChannelId, activeVoiceGuild?.afkTimeoutMinutes, socket]);
  const localVoiceMuted = localVoicePresence?.micMuted ?? !Boolean(window.__gingaVoiceSession?.room.localParticipant.isMicrophoneEnabled);
  const localVoiceDeafened = localVoicePresence?.deafened ?? Boolean(window.__gingaVoiceSession?.deafened);

  useEffect(() => {
    const syncVoiceSession = () => {
      const session = window.__gingaVoiceSession;
      if (!session?.channelId || !socket.connected) return;
      socket.emit("voice:sync", {
        channelId: session.channelId,
        micMuted: !session.room.localParticipant.isMicrophoneEnabled,
        deafened: Boolean(session.deafened)
      }, (response?: { ok?: boolean; restored?: boolean; error?: string }) => {
        if (response?.ok && response.restored) {
          setVoiceControlRevision((value) => value + 1);
        }
      });
    };

    const timer = window.setInterval(syncVoiceSession, 15_000);
    socket.on("connect", syncVoiceSession);
    window.addEventListener("ginga:voice-recovered", syncVoiceSession);
    window.addEventListener("ginga:voice-deafen-changed", syncVoiceSession);
    syncVoiceSession();
    return () => {
      window.clearInterval(timer);
      socket.off("connect", syncVoiceSession);
      window.removeEventListener("ginga:voice-recovered", syncVoiceSession);
      window.removeEventListener("ginga:voice-deafen-changed", syncVoiceSession);
    };
  }, [socket, voiceControlRevision]);

  useEffect(() => {
    const openVoiceContextMenu = (event: MouseEvent | PointerEvent) => {
      if ("button" in event && event.button !== 2) return;
      const target = event.target instanceof Element ? event.target : null;
      const row = target?.closest<HTMLElement>(".voice-channel-user[data-user-id][data-channel-id]");
      if (!row || row.classList.contains("ginga-music-voice-user")) return;
      const userId = row.dataset.userId || "";
      const channelId = row.dataset.channelId || "";
      const guildId = row.dataset.guildId || "";
      if (!userId || !channelId || !guildId) return;
      const voiceUser = (voicePresence[channelId] ?? []).find((candidate) => candidate.id === userId);
      if (!voiceUser) return;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      const rect = row.getBoundingClientRect();
      setVoiceUserMenu({
        user: voiceUser,
        channelId,
        guildId,
        x: event.clientX > 0 ? event.clientX + 6 : rect.right + 8,
        y: event.clientY > 0 ? event.clientY + 6 : rect.top
      });
    };
    const desktop = Boolean((window as unknown as { gingaDesktop?: { isDesktop?: boolean } }).gingaDesktop?.isDesktop);
    const onPointerDown = (event: PointerEvent) => { if (desktop && event.button === 2) openVoiceContextMenu(event); };
    document.addEventListener("contextmenu", openVoiceContextMenu, true);
    if (desktop) document.addEventListener("pointerdown", onPointerDown, true);
    return () => {
      document.removeEventListener("contextmenu", openVoiceContextMenu, true);
      if (desktop) document.removeEventListener("pointerdown", onPointerDown, true);
    };
  }, [voicePresence]);
  const selectedConversation = conversations.find((conversation) => conversation.id === selectedConversationId);
  const activeDirectCall = directCalls.find((call) => call.id === activeDirectCallId) ?? null;
  const activeCallConversation = activeDirectCall?.conversationId ? conversations.find((conversation) => conversation.id === activeDirectCall.conversationId) : undefined;
  const selectedConversationCall = selectedConversation ? directCalls.find((call) => call.peerUserId === selectedConversation.otherUser.id && (call.state === "RINGING" || call.state === "ACTIVE")) ?? null : null;
  const incomingDirectCall = directCalls.find((call) => call.membershipStatus === "INVITED" && (call.state === "RINGING" || call.state === "ACTIVE")) ?? null;

  // O caller entra automaticamente na tela da chamada assim que o destinatario atende.
  // Se o usuario sair voluntariamente, a API troca o membership para LEFT e este efeito
  // nao o joga de volta para a chamada; nesse caso o chat exibe "Entrar na chamada".
  useEffect(() => {
    if (section !== "direct" || activeDirectCallId || !selectedConversationId) return;
    const answeredOutgoing = directCalls.find((call) =>
      call.direction === "OUTGOING" &&
      call.state === "ACTIVE" &&
      call.membershipStatus === "JOINED" &&
      Boolean(call.answeredAt) &&
      call.conversationId === selectedConversationId
    );
    if (answeredOutgoing) setActiveDirectCallId(answeredOutgoing.id);
  }, [activeDirectCallId, directCalls, section, selectedConversationId]);

  const textLikeTypes: ChannelType[] = ["TEXT", "ANNOUNCEMENT", "FORUM", "EVENT"];
  const canManageChannels = Boolean(selectedGuild?.permissions.canManageChannels);
  const canManageChannelPermissions = Boolean(selectedGuild?.permissions.canManageRoles);
  const canCreateInvites = Boolean(selectedGuild?.permissions.canCreateInvites);
  const canOpenServerSettings = Boolean(selectedGuild && (
    selectedGuild.permissions.canManageServer || selectedGuild.permissions.canManageChannels ||
    selectedGuild.permissions.canManageRoles || selectedGuild.permissions.canManageMembers ||
    selectedGuild.permissions.canKickMembers || selectedGuild.permissions.canBanMembers ||
    selectedGuild.permissions.canManageInvites || selectedGuild.permissions.canCreateInvites ||
    selectedGuild.permissions.canManageBots || selectedGuild.permissions.canManageWebhooks ||
    selectedGuild.permissions.canManageEvents || selectedGuild.permissions.canManageAutoMod ||
    selectedGuild.permissions.canViewAuditLog
  ));
  const orderedCategories = [...(selectedGuild?.categories ?? [])].sort((a, b) => a.position - b.position);
  const memberGroups = useMemo(() => {
    const groups = new Map<string, { id: string; name: string; color?: string; icon?: string; position: number; members: GuildMember[] }>();
    const onlineState = (member: GuildMember) => {
      const presence = member.user.id === user.id
        ? (socketConnected ? (presenceModes[member.user.id] ?? "ONLINE") : "OFFLINE")
        : (presenceModes[member.user.id] ?? (onlineUserIds.has(member.user.id) ? "ONLINE" : "OFFLINE"));
      return presence !== "OFFLINE";
    };

    for (const member of members) {
      const online = onlineState(member);
      // Discord-style: somente cargos marcados como "Exibir membros separadamente"
      // criam uma secao. Se houver varios, a maior posicao da hierarquia vence.
      // O criador do servidor NAO ganha um grupo artificial "Dono"; a coroa cuida disso.
      const hoisted = online
        ? [...(member.customRoles ?? [])]
            .filter((role) => role.hoist)
            .sort((a, b) => b.position - a.position)[0]
        : undefined;
      // Discord-style: cargo separado e valido apenas para membros online.
      // Qualquer membro offline fica exclusivamente na secao Offline,
      // independentemente do cargo/hierarquia que possua.
      const key = online ? (hoisted?.id ?? "__online") : "__offline";
      const group = groups.get(key) ?? {
        id: key,
        name: online ? (hoisted?.name ?? "Online") : "Offline",
        color: online ? hoisted?.color : undefined,
        icon: online ? hoisted?.icon : undefined,
        position: online ? (hoisted?.position ?? -10000) : -20000,
        members: []
      };
      group.members.push(member);
      groups.set(key, group);
    }

    for (const group of groups.values()) {
      group.members.sort((a, b) => {
        const onlineDelta = Number(onlineState(b)) - Number(onlineState(a));
        if (onlineDelta) return onlineDelta;
        return (a.nickname || a.user.displayName).localeCompare(b.nickname || b.user.displayName, "pt-BR", { sensitivity: "base" });
      });
    }
    return Array.from(groups.values()).sort((a, b) => b.position - a.position || a.name.localeCompare(b.name, "pt-BR"));
  }, [members, onlineUserIds, presenceModes, socketConnected, user.id]);

  useEffect(() => {
    setCollapsedMemberGroups(new Set());
  }, [selectedGuildId]);

  function toggleMemberGroup(groupId: string) {
    setCollapsedMemberGroups((current) => {
      const next = new Set(current);
      if (next.has(groupId)) next.delete(groupId); else next.add(groupId);
      return next;
    });
  }
  const railItems = useMemo<RailItem[]>(() => {
    const folderByGuild = new Map<string, ServerFolder>();
    serverFolders.forEach((folder) => folder.guildIds.forEach((guildId) => folderByGuild.set(guildId, folder)));
    const emittedFolders = new Set<string>();
    const items: RailItem[] = [];

    for (const guild of guilds) {
      const folder = folderByGuild.get(guild.id);
      if (!folder) {
        items.push({ kind: "guild", guild });
        continue;
      }
      if (emittedFolders.has(folder.id)) continue;
      emittedFolders.add(folder.id);
      items.push({ kind: "folder", folder });
    }

    return items;
  }, [guilds, serverFolders]);

  useEffect(() => {
    if (!selectedGuild) { setSelectedChannelId(""); return; }
    if (!selectedGuild.channels.some((channel) => channel.id === selectedChannelId)) {
      setSelectedChannelId(selectedGuild.channels.find((channel) => textLikeTypes.includes(channel.type))?.id ?? selectedGuild.channels[0]?.id ?? "");
    }
  }, [selectedChannelId, selectedGuild]);

  function playPersistentVoiceActionSound(kind: "mute" | "unmute" | "deafen" | "undeafen" | "leave") {
    const notificationPreferences = loadNotificationPreferences();
    if (!notificationPreferences.playSound) return;
    if (activeVoiceGuild && isGuildSilent(loadGuildPreferences(activeVoiceGuild.id))) return;
    void playUiSound(kind);
  }

  async function togglePersistentVoiceMic() {
    const session = window.__gingaVoiceSession;
    if (!session || session.channelId !== activeVoiceChannelId) return;
    try {
      const participant = session.room.localParticipant;
      await participant.setMicrophoneEnabled(!participant.isMicrophoneEnabled);
      session.desiredMicEnabled = participant.isMicrophoneEnabled;
      socket.emit("voice:state", {
        channelId: activeVoiceChannelId,
        micMuted: !participant.isMicrophoneEnabled,
        deafened: Boolean(session.deafened),
        streaming: participant.isScreenShareEnabled
      });
      playPersistentVoiceActionSound(participant.isMicrophoneEnabled ? "unmute" : "mute");
      setVoiceControlRevision((value) => value + 1);
    } catch (caught) {
      setToast(caught instanceof Error ? caught.message : "Nao foi possivel alterar o microfone");
    }
  }

  function togglePersistentVoiceDeafen() {
    const session = window.__gingaVoiceSession;
    if (!session || session.channelId !== activeVoiceChannelId) return;
    const nextDeafened = !Boolean(session.deafened);
    session.deafened = nextDeafened;
    window.dispatchEvent(new CustomEvent("ginga:voice-deafen-changed", { detail: { channelId: activeVoiceChannelId, deafened: nextDeafened } }));
    socket.emit("voice:state", {
      channelId: activeVoiceChannelId,
      micMuted: !session.room.localParticipant.isMicrophoneEnabled,
      deafened: nextDeafened,
      streaming: session.room.localParticipant.isScreenShareEnabled
    });
    playPersistentVoiceActionSound(nextDeafened ? "deafen" : "undeafen");
    setVoiceControlRevision((value) => value + 1);
  }

  async function togglePersistentVoiceScreen() {
    const session = window.__gingaVoiceSession;
    if (!session || session.channelId !== activeVoiceChannelId) return;
    if (session.mediaPermissions?.canShareScreen === false) { setToast("Voce nao tem permissao para compartilhar a tela nesta sala.", "error"); return; }
    try {
      const enabled = await setVoiceScreenShare(session.room, !session.room.localParticipant.isScreenShareEnabled);
      socket.emit("voice:state", {
        channelId: session.channelId,
        micMuted: !session.room.localParticipant.isMicrophoneEnabled,
        deafened: Boolean(session.deafened),
        streaming: enabled
      });
      setPersistentScreenMenuOpen(enabled);
      setVoiceControlRevision((value) => value + 1);
      setToast(enabled ? "Transmissao iniciada" : "Transmissao encerrada");
    } catch (caught) {
      setToast(caught instanceof Error ? caught.message : "Nao foi possivel alterar a transmissao.", "error");
    }
  }

  async function switchPersistentVoiceScreen() {
    const session = window.__gingaVoiceSession;
    if (!session || session.channelId !== activeVoiceChannelId || !session.room.localParticipant.isScreenShareEnabled) return;
    try {
      await switchVoiceScreenSource(session.room);
      socket.emit("voice:state", { channelId: session.channelId, micMuted: !session.room.localParticipant.isMicrophoneEnabled, deafened: Boolean(session.deafened), streaming: true });
      setPersistentScreenMenuOpen(false);
      setVoiceControlRevision((value) => value + 1);
      setToast("Janela da transmissao alterada sem interromper os espectadores");
    } catch (caught) {
      setToast(caught instanceof Error ? caught.message : "Nao foi possivel trocar a janela.", "error");
    }
  }

  function disconnectPersistentVoice() {
    const session = window.__gingaVoiceSession;
    if (!session || session.channelId !== activeVoiceChannelId) return;
    playPersistentVoiceActionSound("leave");
    socket.emit("voice:leave", { channelId: activeVoiceChannelId });
    if (session.reconnectListener) socket.off("connect", session.reconnectListener);
    try { session.room.disconnect(); } catch {}
    window.__gingaVoiceSession = undefined;
    window.dispatchEvent(new CustomEvent("ginga:voice-presence", { detail: { channelId: activeVoiceChannelId, connected: false } }));
    setVoiceControlRevision((value) => value + 1);
    setToast("Voce saiu da sala de voz");
  }

  function openActiveVoiceChannel() {
    if (!activeVoiceGuild || !activeVoiceChannel) return;
    setSelectedGuildId(activeVoiceGuild.id);
    setSelectedChannelId(activeVoiceChannel.id);
    setSection("space");
    setActiveDirectCallId("");
  }

  function templateIcon(icon: GuildTemplateSummary["icon"]) {
    if (icon === "company") return <Building2 size={20} />;
    if (icon === "community") return <UsersRound size={20} />;
    if (icon === "support") return <Headset size={20} />;
    if (icon === "developer") return <Code2 size={20} />;
    if (icon === "study") return <GraduationCap size={20} />;
    if (icon === "gaming") return <Gamepad2 size={20} />;
    return <LayoutTemplate size={20} />;
  }

  async function createSpace(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const name = String(form.get("name") ?? "").trim();
    if (!name) return;
    try {
      const result = await api<{ guild: Guild }>("/api/guilds", { method: "POST", body: JSON.stringify({ name, templateId: selectedTemplateId }) });
      await loadGuilds(result.guild.id);
      setSection("space");
      setShowAddSpace(false);
      setToast("Espaco criado");
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Nao foi possivel criar o espaco"); }
  }

  async function joinSpace(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const code = String(form.get("code") ?? "").trim().toUpperCase();
    if (!code) return;
    try {
      const result = await api<{ guildId: string; welcomeChannelId?: string | null }>(`/api/invites/${encodeURIComponent(code)}/join`, { method: "POST" });
      await loadGuilds(result.guildId);
      setSection("space");
      setShowAddSpace(false);
      setToast("Voce entrou no espaco");
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Convite invalido"); }
  }

  async function createChannel(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedGuild) return;
    const form = new FormData(event.currentTarget);
    const name = String(form.get("name") ?? "").trim();
    const type = String(form.get("type") ?? "TEXT") as ChannelType;
    const categoryIdRaw = String(form.get("categoryId") ?? "").trim();
    const categoryId = categoryIdRaw || null;
    const slowModeSeconds = Number(form.get("slowModeSeconds") ?? 0) || 0;
    if (!name) { setError("O canal precisa ter um nome. Espacos, maiusculas, acentos, emojis e simbolos sao permitidos."); return; }
    try {
      const result = await api<{ channel: Channel }>(`/api/guilds/${selectedGuild.id}/channels`, {
        method: "POST", body: JSON.stringify({ name, type, categoryId, slowModeSeconds })
      });
      await loadGuilds(selectedGuild.id);
      setSelectedChannelId(result.channel.id);
      setShowChannelModal(false);
      setChannelModalDefaultType("TEXT");
      setToast("Canal criado");
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Nao foi possivel criar o canal"); }
  }

  function channelIcon(type: ChannelType) {
    if (type === "VOICE") return <Headphones size={17} />;
    if (type === "ANNOUNCEMENT") return <Megaphone size={17} />;
    if (type === "FORUM") return <MessageSquareText size={17} />;
    if (type === "EVENT") return <CalendarDays size={17} />;
    return <MessageSquare size={17} />;
  }

  async function createCategory(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedGuild) return;
    const form = new FormData(event.currentTarget);
    const name = String(form.get("name") ?? "").trim();
    if (!name) return;
    try {
      await api(`/api/guilds/${selectedGuild.id}/categories`, { method: "POST", body: JSON.stringify({ name }) });
      await loadGuilds(selectedGuild.id);
      setShowCategoryModal(false);
      setToast("Categoria criada");
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Nao foi possivel criar a categoria"); }
  }

  async function renameChannelQuick(channel: Channel) {
    const name = (await gingaPrompt("Informe o novo nome do canal.", channel.name, { title: "Renomear canal", confirmLabel: "Salvar" }))?.trim();
    if (!name || name === channel.name) return;
    try {
      await api(`/api/channels/${channel.id}`, { method: "PATCH", body: JSON.stringify({ name }) });
      await loadGuilds(selectedGuildId);
      setToast("Canal atualizado");
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Nao foi possivel editar o canal"); }
    finally { setChannelMenu(null); }
  }

  function copyName(base: string, existing: string[]) {
    const clean = `${base}-copia`.slice(0, 48);
    if (!existing.includes(clean)) return clean;
    for (let index = 2; index < 100; index += 1) {
      const suffix = `-${index}`;
      const candidate = `${clean.slice(0, 48 - suffix.length)}${suffix}`;
      if (!existing.includes(candidate)) return candidate;
    }
    return `${base.slice(0, 40)}-${Date.now().toString().slice(-6)}`;
  }

  async function configureSlowModeQuick(channel: Channel) {
    const current = String(channel.slowModeSeconds ?? 0);
    const answer = await gingaPrompt("Intervalo em segundos entre mensagens de membros. Use 0 para desativar. Exemplos: 5, 10, 30, 60, 300.", current, { title: `Modo lento · #${channel.name}`, confirmLabel: "Salvar", placeholder: "0 a 21600" });
    if (answer === null) return;
    const seconds = Number(answer.trim());
    if (!Number.isInteger(seconds) || seconds < 0 || seconds > 21600) { setError("Informe um numero inteiro entre 0 e 21600 segundos."); return; }
    try {
      await api(`/api/channels/${channel.id}`, { method: "PATCH", body: JSON.stringify({ slowModeSeconds: seconds }) });
      await loadGuilds(selectedGuildId);
      setToast(seconds ? `Modo lento: ${seconds}s` : "Modo lento desativado");
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Nao foi possivel alterar o modo lento"); }
    finally { setChannelMenu(null); }
  }

  async function clearChannelMessagesQuick(channel: Channel) {
    const answer = await gingaPrompt("Quantas mensagens deseja remover? Informe 1 a 500 ou digite tudo.", "50", { title: `Limpar #${channel.name}`, confirmLabel: "Continuar", placeholder: "50 ou tudo" });
    if (!answer) return;
    const normalized = answer.trim().toLowerCase();
    const count: number | "all" = ["all","tudo","todos"].includes(normalized) ? "all" : Number(normalized);
    if (count !== "all" && (!Number.isInteger(count) || count < 1 || count > 500)) { setError("Informe um numero entre 1 e 500 ou digite tudo."); return; }
    const label = count === "all" ? "TODAS as mensagens" : `as ultimas ${count} mensagens`;
    if (!(await gingaConfirm(`Remover ${label} de #${channel.name}? Esta acao nao pode ser desfeita.`, { title: "Limpar mensagens", confirmLabel: "Limpar", cancelLabel: "Cancelar", tone: "danger" }))) return;
    try {
      const result = await api<{ deleted: number }>(`/api/channels/${channel.id}/messages/clear`, { method: "POST", body: JSON.stringify({ count }) });
      setToast(`${result.deleted} mensagem${result.deleted === 1 ? "" : "s"} removida${result.deleted === 1 ? "" : "s"}`);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Nao foi possivel limpar as mensagens"); }
    finally { setChannelMenu(null); }
  }

  async function duplicateChannelQuick(channel: Channel) {
    if (!selectedGuild) return;
    try {
      const name = copyName(channel.name, selectedGuild.channels.map((item) => item.name));
      const result = await api<{ channel: Channel }>(`/api/guilds/${selectedGuild.id}/channels`, {
        method: "POST",
        body: JSON.stringify({ name, type: channel.type, categoryId: channel.categoryId, topic: channel.topic ?? "", slowModeSeconds: channel.slowModeSeconds ?? 0 })
      });
      await loadGuilds(selectedGuild.id);
      setSelectedChannelId(result.channel.id);
      setToast("Canal duplicado");
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Nao foi possivel duplicar o canal"); }
    finally { setChannelMenu(null); }
  }

  async function deleteChannelQuick(channel: Channel) {
    if (!(await gingaConfirm("As mensagens deste canal tambem podem ser removidas.", { title: `Excluir #${channel.name}?`, confirmLabel: "Excluir canal", tone: "danger" }))) return;
    try {
      await api<void>(`/api/channels/${channel.id}`, { method: "DELETE" });
      await loadGuilds(selectedGuildId);
      setToast("Canal excluido");
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Nao foi possivel excluir o canal"); }
    finally { setChannelMenu(null); }
  }

  async function renameCategoryQuick(category: ChannelCategory) {
    const name = (await gingaPrompt("Informe o novo nome da categoria.", category.name, { title: "Renomear categoria", confirmLabel: "Salvar" }))?.trim();
    if (!name || name === category.name) return;
    try {
      await api(`/api/categories/${category.id}`, { method: "PATCH", body: JSON.stringify({ name }) });
      await loadGuilds(selectedGuildId);
      setToast("Categoria atualizada");
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Nao foi possivel editar a categoria"); }
    finally { setCategoryMenu(null); }
  }

  async function duplicateCategoryQuick(category: ChannelCategory) {
    if (!selectedGuild) return;
    try {
      const categoryName = copyName(category.name, selectedGuild.categories.map((item) => item.name));
      const created = await api<{ category: ChannelCategory }>(`/api/guilds/${selectedGuild.id}/categories`, { method: "POST", body: JSON.stringify({ name: categoryName }) });
      const existingNames = [...selectedGuild.channels.map((item) => item.name)];
      for (const channel of selectedGuild.channels.filter((item) => item.categoryId === category.id).sort((a,b)=>a.position-b.position)) {
        const name = copyName(channel.name, existingNames);
        existingNames.push(name);
        await api(`/api/guilds/${selectedGuild.id}/channels`, { method: "POST", body: JSON.stringify({ name, type: channel.type, categoryId: created.category.id, topic: channel.topic ?? "", slowModeSeconds: channel.slowModeSeconds ?? 0 }) });
      }
      await loadGuilds(selectedGuild.id);
      setToast("Categoria duplicada");
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Nao foi possivel duplicar a categoria"); }
    finally { setCategoryMenu(null); }
  }

  async function deleteCategoryQuick(category: ChannelCategory) {
    if (!(await gingaConfirm("Os canais continuarao existindo, mas ficarao sem categoria.", { title: `Excluir ${category.name}?`, confirmLabel: "Excluir categoria", tone: "danger" }))) return;
    try {
      await api<void>(`/api/categories/${category.id}`, { method: "DELETE" });
      await loadGuilds(selectedGuildId);
      setToast("Categoria excluida");
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Nao foi possivel excluir a categoria"); }
    finally { setCategoryMenu(null); }
  }

  async function moveChannelToCategory(channel: Channel, categoryId: string | null) {
    if (!selectedGuild || channel.categoryId === categoryId) { setChannelMenu(null); return; }
    const sourceId = channel.categoryId;
    const targetChannels = selectedGuild.channels.filter((item) => item.id !== channel.id && item.categoryId === categoryId);
    const sourceChannels = selectedGuild.channels.filter((item) => item.id !== channel.id && item.categoryId === sourceId);
    const items = [
      ...sourceChannels.map((item, position) => ({ id: item.id, categoryId: sourceId, position })),
      ...targetChannels.map((item, position) => ({ id: item.id, categoryId, position })),
      { id: channel.id, categoryId, position: targetChannels.length }
    ];
    try {
      await api(`/api/guilds/${selectedGuild.id}/channels/reorder`, { method: "PUT", body: JSON.stringify({ items }) });
      await loadGuilds(selectedGuild.id);
      setToast("Canal movido");
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Nao foi possivel mover o canal"); }
    finally { setChannelMenu(null); setDraggedChannelId(""); }
  }

  async function reorderChannelBefore(draggedId: string, targetId: string) {
    if (!selectedGuild || draggedId === targetId) return;
    const dragged = selectedGuild.channels.find((item) => item.id === draggedId);
    const target = selectedGuild.channels.find((item) => item.id === targetId);
    if (!dragged || !target) return;
    const sourceId = dragged.categoryId;
    const targetIdCategory = target.categoryId;
    const source = selectedGuild.channels.filter((item) => item.id !== dragged.id && item.categoryId === sourceId);
    const targetList = selectedGuild.channels.filter((item) => item.id !== dragged.id && item.categoryId === targetIdCategory);
    const targetIndex = Math.max(0, targetList.findIndex((item) => item.id === target.id));
    targetList.splice(targetIndex, 0, { ...dragged, categoryId: targetIdCategory });
    const affected = new Map<string, { id: string; categoryId: string | null; position: number }>();
    source.forEach((item, position) => affected.set(item.id, { id: item.id, categoryId: sourceId, position }));
    targetList.forEach((item, position) => affected.set(item.id, { id: item.id, categoryId: targetIdCategory, position }));
    try {
      await api(`/api/guilds/${selectedGuild.id}/channels/reorder`, { method: "PUT", body: JSON.stringify({ items: Array.from(affected.values()) }) });
      await loadGuilds(selectedGuild.id);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Nao foi possivel reorganizar os canais"); }
    finally { setDraggedChannelId(""); }
  }

  async function reorderCategoryBefore(draggedId: string, targetId: string) {
    if (!selectedGuild || draggedId === targetId) return;
    const list = [...selectedGuild.categories].sort((a, b) => a.position - b.position);
    const dragged = list.find((item) => item.id === draggedId);
    if (!dragged) return;
    const remaining = list.filter((item) => item.id !== draggedId);
    const targetIndex = remaining.findIndex((item) => item.id === targetId);
    if (targetIndex < 0) return;
    remaining.splice(targetIndex, 0, dragged);
    try {
      await api(`/api/guilds/${selectedGuild.id}/categories/reorder`, { method: "PUT", body: JSON.stringify({ items: remaining.map((item, position) => ({ id: item.id, position })) }) });
      await loadGuilds(selectedGuild.id);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Nao foi possivel reorganizar as categorias"); }
    finally { setDraggedCategoryId(""); }
  }

  function privateInviteHost(hostname: string) {
    const host = hostname.replace(/^\[|\]$/g, "").toLowerCase();
    if (host === "localhost" || host === "::1" || host.endsWith(".local")) return true;
    if (/^127\./.test(host) || /^10\./.test(host) || /^192\.168\./.test(host) || /^169\.254\./.test(host)) return true;
    const match = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
    if (!match) return false;
    const first = Number(match[1]);
    const second = Number(match[2]);
    return (first === 172 && second >= 16 && second <= 31) || (first === 100 && second >= 64 && second <= 127);
  }

  async function resolveInviteOrigin() {
    try {
      const result = await api<{ appOrigins?: string[] }>("/api/system/network");
      const candidates = (result.appOrigins ?? []).flatMap((value) => {
        try { return [new URL(value)]; } catch { return []; }
      });
      const external = candidates
        .filter((url) => !privateInviteHost(url.hostname))
        .sort((a, b) => Number(b.protocol === "https:") - Number(a.protocol === "https:"));
      return (external[0] ?? candidates[0] ?? new URL(window.location.origin)).origin;
    } catch {
      return window.location.origin;
    }
  }

  async function openInvite(guildOverride?: Guild) {
    const targetGuild = guildOverride ?? selectedGuild;
    if (!targetGuild) return;
    if (targetGuild.id !== selectedGuildId) setSelectedGuildId(targetGuild.id);
    setInviteCode(""); setCopied(false); setInviteFriendQuery(""); setInviteSendingTo(""); setInviteSentTo(new Set()); setShowInviteModal(true);
    try {
      const [result, origin] = await Promise.all([
        api<{ invite: { code: string } }>(`/api/guilds/${targetGuild.id}/invites`, {
          method: "POST", body: JSON.stringify({ expiresInMinutes: 7 * 24 * 60, maxUses: null })
        }),
        resolveInviteOrigin()
      ]);
      setInviteOrigin(origin);
      setInviteCode(result.invite.code);
    } catch (caught) {
      setShowInviteModal(false);
      setError(caught instanceof Error ? caught.message : "Nao foi possivel gerar o convite");
    }
  }

  async function copyInvite() {
    if (!inviteCode) return;
    const origin = inviteOrigin || await resolveInviteOrigin();
    await copyTextToClipboard(`${origin}/invite/${inviteCode}`);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  }

  async function sendInviteToFriend(target: User) {
    if (!inviteCode || inviteSendingTo) return;
    if (!socket.connected) {
      setError("A conexao em tempo real esta indisponivel. Tente novamente quando o Ginga reconectar.");
      return;
    }
    setInviteSendingTo(target.id);
    try {
      const result = await api<{ conversation: DirectConversation }>("/api/direct/conversations", {
        method: "POST",
        body: JSON.stringify({ userId: target.id })
      });
      await new Promise<void>((resolve, reject) => {
        socket.emit("direct:message:send", {
          conversationId: result.conversation.id,
          content: buildServerInviteMessage(inviteCode),
          attachmentIds: [],
          replyToId: null
        }, (response: { ok: boolean; error?: string }) => {
          if (!response?.ok) { reject(new Error(response?.error ?? "Nao foi possivel enviar o convite")); return; }
          resolve();
        });
      });
      setInviteSentTo((current) => new Set(current).add(target.id));
      setToast(`Convite enviado para ${target.displayName}`);
      await loadConversations();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Nao foi possivel enviar o convite na conversa privada");
    } finally {
      setInviteSendingTo("");
    }
  }

  async function joinInviteFromDirect(code: string) {
    const result = await api<{ guildId: string; welcomeChannelId?: string | null }>(`/api/invites/${encodeURIComponent(code)}/join`, { method: "POST" });
    await loadGuilds(result.guildId);
    setSelectedGuildId(result.guildId);
    setSelectedConversationId("");
    setActiveDirectCallId("");
    setSection("space");
    setToast("Servidor adicionado. Bem-vindo!");
  }

  async function startConversation(userId: string) {
    const result = await api<{ conversation: DirectConversation }>("/api/direct/conversations", {
      method: "POST", body: JSON.stringify({ userId })
    });
    await loadConversations();
    setSelectedConversationId(result.conversation.id);
    setActiveDirectCallId("");
    setSection("direct");
  }

  function openConversation(conversationId: string) {
    setSelectedConversationId(conversationId);
    setActiveDirectCallId("");
    setSection("direct");
    setMobileContextOpen(false);
  }

  async function startDirectCall(conversation: DirectConversation) {
    setSelectedConversationId(conversation.id);
    setSection("direct");
    setError("");
    try {
      const call = await getDirectCallsBridge()?.start(conversation.otherUser.id);
      if (!call) throw new Error("O sistema de chamadas ainda nao esta pronto. Tente novamente.");
      setDirectCalls((current) => [call, ...current.filter((item) => item.id !== call.id)]);
      // O caller permanece no chat em estado 'Chamando...' ate a outra pessoa atender.
      if (call.state === "ACTIVE" && call.membershipStatus === "JOINED") setActiveDirectCallId(call.id);
    } catch (caught) {
      setToast(caught instanceof Error ? caught.message : "Nao foi possivel iniciar a chamada");
    }
  }

  async function startDirectCallWithUser(userId: string) {
    if (userId === user.id) return;
    const result = await api<{ conversation: DirectConversation }>("/api/direct/conversations", {
      method: "POST",
      body: JSON.stringify({ userId })
    });
    await loadConversations();
    await startDirectCall(result.conversation);
  }

  async function openUserProfileById(userId: string) {
    const knownUser = user.id === userId
      ? user
      : members.find((member) => member.user.id === userId)?.user
        ?? friends.friends.find((entry) => entry.user.id === userId)?.user
        ?? friends.incoming.find((entry) => entry.user.id === userId)?.user
        ?? friends.outgoing.find((entry) => entry.user.id === userId)?.user
        ?? conversations.find((conversation) => conversation.otherUser.id === userId)?.otherUser;
    if (knownUser) {
      openFullProfile(knownUser, selectedGuildId || undefined);
      return;
    }
    const result = await api<{ profile: User }>(`/api/users/${encodeURIComponent(userId)}/profile`);
    openFullProfile(result.profile, selectedGuildId || undefined);
  }

  async function kickVoiceParticipant(userId: string, guildIdOverride?: string, reason = "") {
    const guildId = guildIdOverride || selectedGuildId;
    if (!guildId) return;
    await api<void>(`/api/guilds/${guildId}/members/${encodeURIComponent(userId)}/kick`, { method: "POST", body: JSON.stringify({ reason }) });
    await Promise.all([loadMembers(guildId), loadGuilds(guildId)]);
    setToast("Usuario expulso do servidor");
  }

  async function banVoiceParticipant(userId: string, options?: { duration: "PERMANENT" | "1H" | "24H" | "7D" | "30D"; reason: string; deleteMessageMinutes?: number }, guildIdOverride?: string) {
    const guildId = guildIdOverride || selectedGuildId;
    if (!guildId) return;
    await api<void>(`/api/guilds/${guildId}/bans/${encodeURIComponent(userId)}`, {
      method: "POST",
      body: JSON.stringify({ duration: options?.duration ?? "7D", reason: options?.reason ?? "", deleteMessageMinutes: options?.deleteMessageMinutes ?? 0 })
    });
    await Promise.all([loadMembers(guildId), loadGuilds(guildId)]);
    setToast("Usuario banido do servidor");
  }

  async function timeoutVoiceParticipant(userId: string, options: { durationMinutes: number; reason: string }, guildIdOverride?: string) {
    const guildId = guildIdOverride || selectedGuildId;
    if (!guildId) return;
    await api(`/api/guilds/${guildId}/members/${encodeURIComponent(userId)}/timeout`, {
      method: "POST",
      body: JSON.stringify({ durationMinutes: options.durationMinutes, reason: options.reason })
    });
    await Promise.all([loadMembers(guildId), loadGuilds(guildId)]);
    setToast("Timeout aplicado. O usuario foi removido da voz.");
  }

  async function setServerVoiceModeration(userId: string, state: { muted?: boolean; deafened?: boolean }, guildIdOverride?: string) {
    const guildId = guildIdOverride || selectedGuildId;
    if (!guildId) return;
    await api(`/api/guilds/${guildId}/members/${encodeURIComponent(userId)}/voice-moderation`, { method: "PATCH", body: JSON.stringify(state) });
    await loadMembers(guildId);
    setToast(typeof state.muted === "boolean" ? (state.muted ? "Usuario mutado no servidor" : "Mute do servidor removido") : (state.deafened ? "Usuario ensurdecido no servidor" : "Ensurdecimento removido"));
  }

  async function requestFriend(target: User) {
    await api("/api/friends/requests", { method: "POST", body: JSON.stringify({ username: target.username }) });
    await loadFriends();
    setToast(`Solicitacao enviada para @${target.username}`);
  }

  function openNicknameEditor(target: User, guildId: string, currentNickname = "") {
    setNicknameDraft(currentNickname);
    setNicknameEditTarget({ user: target, guildId });
  }

  async function saveMemberNickname() {
    if (!nicknameEditTarget || nicknameBusy) return;
    setNicknameBusy(true);
    try {
      const nickname = nicknameDraft.trim();
      await api(`/api/guilds/${nicknameEditTarget.guildId}/members/${encodeURIComponent(nicknameEditTarget.user.id)}/nickname`, { method: "PATCH", body: JSON.stringify({ nickname }) });
      await loadMembers(nicknameEditTarget.guildId);
      setNicknameEditTarget(null);
      setNicknameDraft("");
      setToast(nickname ? "Apelido atualizado" : "Apelido removido");
    } catch (caught) {
      setToast(caught instanceof Error ? caught.message : "Nao foi possivel alterar o apelido");
    } finally {
      setNicknameBusy(false);
    }
  }

  async function moveVoiceParticipant(userId: string, targetChannelId: string) {
    return new Promise<void>((resolve, reject) => {
      socket.emit("voice:move-member", { targetUserId: userId, targetChannelId }, (response?: { ok?: boolean; error?: string }) => {
        if (response?.ok === false) return reject(new Error(response.error || "Nao foi possivel mover o usuario"));
        setToast("Usuario movido para outra sala");
        resolve();
      });
    });
  }

  async function disconnectVoiceParticipant(guildId: string, userId: string) {
    return new Promise<void>((resolve, reject) => {
      socket.emit("voice:disconnect-member", { guildId, targetUserId: userId }, (response?: { ok?: boolean; error?: string }) => {
        if (response?.ok === false) return reject(new Error(response.error || "Nao foi possivel desconectar o usuario"));
        setToast("Usuario desconectado da sala de voz");
        resolve();
      });
    });
  }

  async function confirmVoiceModeration() {
    if (!voiceModerationTarget || voiceModerationBusy) return;
    setVoiceModerationBusy(true);
    try {
      if (voiceModerationTarget.action === "kick") {
        await kickVoiceParticipant(voiceModerationTarget.user.id, voiceModerationTarget.guildId, voiceBanReason.trim());
      } else if (voiceModerationTarget.action === "ban") {
        await banVoiceParticipant(voiceModerationTarget.user.id, { duration: voiceBanDuration, reason: voiceBanReason.trim(), deleteMessageMinutes: voiceBanDeleteMinutes }, voiceModerationTarget.guildId);
      } else {
        await timeoutVoiceParticipant(voiceModerationTarget.user.id, { durationMinutes: voiceTimeoutDuration, reason: voiceTimeoutReason.trim() }, voiceModerationTarget.guildId);
      }
      setVoiceModerationTarget(null);
      setVoiceBanReason("");
      setVoiceBanDeleteMinutes(0);
      setVoiceTimeoutReason("");
    } catch (caught) {
      setToast(caught instanceof Error ? caught.message : "Nao foi possivel concluir a moderacao");
    } finally {
      setVoiceModerationBusy(false);
    }
  }

  async function moveMusicBot(guildId: string, targetChannelId: string) {
    const result = await api<{ state: MusicState }>(`/api/guilds/${encodeURIComponent(guildId)}/music/join`, {
      method: "POST",
      body: JSON.stringify({ channelId: targetChannelId })
    });
    rememberMusicState(result.state);
    setSelectedGuildId(guildId);
    setSelectedChannelId(targetChannelId);
    setSection("space");
    setToast("Ginga Music movido para outra sala");
  }

  async function disconnectMusicBot(guildId: string) {
    const result = await api<{ state: MusicState }>(`/api/guilds/${encodeURIComponent(guildId)}/music/leave`, { method: "POST" });
    rememberMusicState(result.state);
    setToast("Ginga Music desconectado da voz");
  }

  async function joinDirectCall(call: DirectCall) {
    if (directCallJoinInFlightRef.current.has(call.id)) return;
    directCallJoinInFlightRef.current.add(call.id);

    try {
      let bridge = getDirectCallsBridge();
      for (let waitAttempt = 0; !bridge && waitAttempt < 5; waitAttempt += 1) {
        await new Promise((resolve) => window.setTimeout(resolve, 120));
        bridge = getDirectCallsBridge();
      }
      if (!bridge) throw new Error("O modulo de chamadas ainda esta iniciando. Tente novamente em um instante.");

      let joined: DirectCall | null = null;
      let lastError: unknown = null;

      // Um clique pode coincidir com polling/socket alterando o mesmo snapshot.
      // Repetimos somente falhas transitorias e sempre consultamos o estado real
      // antes da segunda tentativa; nao fazemos dois JOINs cegos em paralelo.
      for (let attempt = 0; attempt < 2 && !joined; attempt += 1) {
        try {
          joined = await bridge.join(call.id);
        } catch (caught) {
          lastError = caught;
          if (attempt === 0) {
            await new Promise((resolve) => window.setTimeout(resolve, 180));
            const refreshed = await bridge.refresh();
            const current = refreshed.find((item) => item.id === call.id);
            if (current?.state === "ACTIVE" && current.membershipStatus === "JOINED") joined = current;
            else if (!current || !["RINGING", "ACTIVE"].includes(current.state)) break;
          }
        }
      }

      if (!joined) throw (lastError instanceof Error ? lastError : new Error("A chamada nao esta mais disponivel."));

      // Confirma o estado efetivo antes de montar a sala de midia. Isso elimina
      // o caso intermitente em que o componente abria com membership antigo.
      if (joined.state !== "ACTIVE" || joined.membershipStatus !== "JOINED") {
        const refreshed = await bridge.refresh();
        joined = refreshed.find((item) => item.id === call.id) ?? joined;
      }
      if (joined.state !== "ACTIVE" || joined.membershipStatus !== "JOINED") {
        throw new Error("Nao foi possivel confirmar sua entrada na chamada.");
      }

      setDirectCalls((current) => [joined!, ...current.filter((item) => item.id !== joined!.id)]);
      if (joined.conversationId && conversations.some((conversation) => conversation.id === joined!.conversationId)) setSelectedConversationId(joined.conversationId);
      setActiveDirectCallId(joined.id);
      setSection("direct");
      void loadConversations();
    } catch (caught) {
      setToast(caught instanceof Error ? caught.message : "Nao foi possivel entrar na chamada", "error");
    } finally {
      directCallJoinInFlightRef.current.delete(call.id);
    }
  }

  async function declineDirectCall(call: DirectCall) {
    try { await getDirectCallsBridge()?.decline(call.id); }
    catch (caught) { setToast(caught instanceof Error ? caught.message : "Nao foi possivel recusar a chamada"); }
  }

  async function leaveDirectCall(call: DirectCall) {
    // Atualiza localmente antes da resposta da API para o efeito de auto-entrada nao
    // reabrir a chamada no intervalo entre o clique em sair e o refresh do bridge.
    setDirectCalls((current) => current.map((item) => item.id === call.id
      ? { ...item, membershipStatus: "LEFT", canJoin: item.state === "ACTIVE" }
      : item));
    setActiveDirectCallId("");
    try { await getDirectCallsBridge()?.leave(call.id); }
    catch (caught) {
      setToast(caught instanceof Error ? caught.message : "Nao foi possivel sair da chamada");
      void getDirectCallsBridge()?.refresh();
    }
  }

  async function endDirectCall(call: DirectCall) {
    try { await getDirectCallsBridge()?.end(call.id); setActiveDirectCallId(""); }
    catch (caught) { setToast(caught instanceof Error ? caught.message : "Nao foi possivel encerrar a chamada"); }
  }

  async function inviteToDirectCall(call: DirectCall, targetUserId: string) {
    try {
      await getDirectCallsBridge()?.invite(call.id, targetUserId);
      setToast("Convite enviado para a chamada");
    } catch (caught) { setToast(caught instanceof Error ? caught.message : "Nao foi possivel convidar para a chamada"); }
  }

  function openUserCard(target: User, rect: DOMRect, member?: GuildMember, explicitGuildId?: string) {
    const guildId = explicitGuildId ?? (member ? selectedGuildId : undefined);
    const guild = guilds.find((item) => item.id === guildId) ?? null;
    const topRole = member ? [...(member.customRoles ?? [])].sort((a, b) => b.position - a.position)[0] : undefined;
    setProfileModal(null);
    setProfileCard({
      user: target,
      anchor: { top: rect.top, left: rect.left, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height },
      guildId,
      role: member?.role,
      joinedAt: member?.joinedAt,
      topRole,
      guildOwner: Boolean(guild && guild.ownerId === target.id)
    });
  }

  function openFullProfile(target: User, guildId?: string) {
    const member = guildId && guildId === selectedGuildId ? members.find((item) => item.user.id === target.id) : undefined;
    const guild = guilds.find((item) => item.id === guildId) ?? null;
    setProfileCard(null);
    setProfileModal({
      user: target,
      guildId,
      topRole: member ? [...(member.customRoles ?? [])].sort((a, b) => b.position - a.position)[0] : undefined,
      guildOwner: Boolean(guild && guild.ownerId === target.id)
    });
  }

  function leaveVoice() {
    const fallback = selectedGuild?.channels.find((channel) => textLikeTypes.includes(channel.type));
    if (fallback) setSelectedChannelId(fallback.id);
  }

  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault(); setQuickOpen((value) => !value); setQuickQuery("");
        return;
      }
      if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === "f") {
        if (!selectedGuildId) return;
        event.preventDefault();
        setShowGlobalSearch(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedGuildId]);

  function quickItems() {
    const q = quickQuery.trim().toLowerCase();
    const items: Array<{ id: string; label: string; detail: string; run: () => void }> = [
      { id: "news", label: "Novidades do Ginga", detail: "Releases, avisos e manutenção", run: () => setSection("news") },
      ...guilds.flatMap((guild) => guild.channels.map((channel) => ({ id: channel.id, label: `${guild.name} / ${channel.name}`, detail: channel.type, run: () => { setSelectedGuildId(guild.id); setSelectedChannelId(channel.id); setSection("space"); } }))),
      ...conversations.map((conversation) => ({ id: conversation.id, label: conversation.otherUser.displayName, detail: `@${conversation.otherUser.username}`, run: () => openConversation(conversation.id) }))
    ];
    return items.filter((item) => !q || `${item.label} ${item.detail}`.toLowerCase().includes(q)).slice(0, 20);
  }

  function folderForGuild(guildId: string) {
    return serverFolders.find((folder) => folder.guildIds.includes(guildId)) ?? null;
  }

  function ungroupGuild(folders: ServerFolder[], guildId: string) {
    return folders
      .map((folder) => ({ ...folder, guildIds: folder.guildIds.filter((id) => id !== guildId) }))
      .filter((folder) => folder.guildIds.length > 0);
  }

  function groupGuilds(draggedId: string, targetId: string) {
    if (!draggedId || !targetId || draggedId === targetId) return;
    setServerFolders((current) => {
      const targetFolder = current.find((folder) => folder.guildIds.includes(targetId));
      let next = ungroupGuild(current, draggedId);
      if (targetFolder) {
        next = next.map((folder) => folder.id === targetFolder.id
          ? { ...folder, guildIds: Array.from(new Set([...folder.guildIds, draggedId])), expanded: true }
          : folder);
        return next;
      }
      next = ungroupGuild(next, targetId);
      return [...next, {
        id: crypto.randomUUID(),
        name: "Pasta de servidores",
        color: SERVER_FOLDER_COLORS[current.length % SERVER_FOLDER_COLORS.length],
        guildIds: [targetId, draggedId],
        expanded: true
      }];
    });
  }

  function addGuildToFolder(guildId: string, folderId: string) {
    if (!guildId) return;
    setServerFolders((current) => {
      const without = ungroupGuild(current, guildId);
      return without.map((folder) => folder.id === folderId
        ? { ...folder, guildIds: Array.from(new Set([...folder.guildIds, guildId])), expanded: true }
        : folder);
    });
  }

  function removeGuildFromFolder(guildId: string, notify = true) {
    const folder = folderForGuild(guildId);
    if (!folder) return;
    setServerFolders((current) => ungroupGuild(current, guildId));
    setFolderGuildMenu(null);
    setDraggedGuildId("");
    if (notify) {
      const guildName = guilds.find((guild) => guild.id === guildId)?.name ?? "Servidor";
      setToast(`${guildName} removido da pasta`);
    }
  }

  function updateFolder(folderId: string, update: Partial<Pick<ServerFolder, "name" | "color" | "expanded">>) {
    setServerFolders((current) => current.map((folder) => folder.id === folderId ? { ...folder, ...update } : folder));
  }

  function deleteFolder(folderId: string) {
    setServerFolders((current) => current.filter((folder) => folder.id !== folderId));
    setFolderMenu(null);
  }

  async function copyIdentifier(label: string, value: string) {
    try {
      await copyTextToClipboard(value);
      setToast(`${label} copiado`);
    } catch {
      setError(`Nao foi possivel copiar ${label.toLowerCase()}`);
    }
  }

  function openServerSettingsForGuild(guild: Guild, initialTab?: ServerSettingsTab) {
    setSelectedGuildId(guild.id);
    setSection("space");
    setActiveDirectCallId("");
    setServerSettingsInitialTab(initialTab);
    setShowServerSettings(true);
  }

  function updateLocalGuildPreferences(guildId: string, patch: Parameters<typeof updateGuildPreferences>[1]) {
    updateGuildPreferences(guildId, patch);
    setGuildPreferencesRevision((value) => value + 1);
  }

  async function leaveGuild(guild: Guild) {
    if (guild.ownerId === user.id) {
      setToast("O proprietario nao pode sair do servidor. Exclua o servidor ou transfira a propriedade quando esse recurso estiver habilitado.");
      return;
    }
    if (!(await gingaConfirm("Voce precisara de um novo convite para voltar.", { title: `Sair de ${guild.name}?`, confirmLabel: "Sair do servidor", tone: "danger" }))) return;
    await api<void>(`/api/guilds/${encodeURIComponent(guild.id)}/leave`, { method: "POST" });
    if (activeVoiceGuild?.id === guild.id) disconnectPersistentVoice();
    removeGuildFromFolder(guild.id);
    await loadGuilds();
    setToast(`Voce saiu de ${guild.name}`);
  }

  function openEventCreator(guild: Guild) {
    setSelectedGuildId(guild.id);
    setSection("space");
    setActiveDirectCallId("");
    setChannelModalDefaultType("EVENT");
    setShowChannelModal(true);
  }

  function markChannelRead(channelId: string) {
    setUnreadChannels((current) => { const next = { ...current }; delete next[channelId]; return next; });
    setMentionedChannels((current) => { const next = new Set(current); next.delete(channelId); return next; });
  }

  function markGuildRead(guild: Guild) {
    const ids = new Set(guild.channels.map((channel) => channel.id));
    setUnreadChannels((current) => Object.fromEntries(Object.entries(current).filter(([channelId]) => !ids.has(channelId))));
    setMentionedChannels((current) => new Set(Array.from(current).filter((channelId) => !ids.has(channelId))));
    setToast(`${guild.name} marcado como lido`);
  }

  function markDirectRead(conversationId: string) {
    setUnreadDirect((current) => { const next = { ...current }; delete next[conversationId]; return next; });
    setToast("Conversa marcada como lida");
  }

  function renderRailGuild(guild: Guild, child = false) {
    const inFolder = Boolean(folderForGuild(guild.id));
    const guildPreferences = loadGuildPreferences(guild.id);
    const notificationMode = guildNotificationMode(guildPreferences);
    const attentionChannels = guild.channels.filter((channel) => {
      if (isChannelMuted(guildPreferences, channel.id)) return false;
      if (notificationMode === "SILENT") return false;
      if (notificationMode === "MENTIONS") return mentionedChannels.has(channel.id);
      return true;
    });
    const guildUnreadCount = attentionChannels.reduce((sum, channel) => sum + (unreadChannels[channel.id] ?? 0), 0);
    const guildHasMention = attentionChannels.some((channel) => mentionedChannels.has(channel.id));
    return <button
      key={guild.id}
      draggable
      className={`rail-space ${child ? "rail-folder-child" : ""} ${section === "space" && guild.id === selectedGuildId ? "active" : ""} ${guildUnreadCount > 0 ? "has-unread" : ""} ${guildPreferences.muted ? "muted-server" : ""}`}
      aria-label={`${guild.name} · ${guild.memberCount} membros`}
      onClick={() => { setSelectedGuildId(guild.id); setSection("space"); setActiveDirectCallId(""); setMobileContextOpen(true); }}
      onDragStart={(event) => { setDraggedGuildId(guild.id); event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("text/ginga-guild", guild.id); }}
      onDragEnd={() => setDraggedGuildId("")}
      onDragOver={(event) => { if (draggedGuildId && draggedGuildId !== guild.id) { event.preventDefault(); event.dataTransfer.dropEffect = "move"; } }}
      onDrop={(event) => { event.preventDefault(); event.stopPropagation(); const draggedId = event.dataTransfer.getData("text/ginga-guild") || draggedGuildId; groupGuilds(draggedId, guild.id); setDraggedGuildId(""); }}
      onContextMenu={(event) => { event.preventDefault(); event.stopPropagation(); setGuildMenu({ x: event.clientX, y: event.clientY, guild }); }}
    >
      <span className={`space-nav-icon ${guild.iconUrl ? "with-image" : ""}`} style={{ "--space-color": guild.appearance?.accentColor ?? guild.iconColor } as CSSProperties}>{guild.iconUrl ? <img src={guild.iconUrl} alt=""/> : guild.name.slice(0, 1).toUpperCase()}</span>
      {activeVoiceGuild?.id === guild.id ? <span className="rail-voice-badge" aria-label="Conectado em uma sala de voz deste espaco"><Volume2 size={12}/></span> : null}
      {guildPreferences.muted ? <span className="rail-muted-badge" aria-label="Servidor silenciado"><BellOff size={10}/></span> : null}
      {guildUnreadCount > 0 ? <b className={`rail-mention-badge ${guildHasMention ? "mention" : ""}`}>{guildUnreadCount > 99 ? "99+" : guildUnreadCount}</b> : null}
    </button>;
  }

  async function setChannelPermissionInheritance(channel: Channel, sync: boolean) {
    try {
      await api(`/api/channels/${encodeURIComponent(channel.id)}`, {
        method: "PATCH",
        body: JSON.stringify({ syncPermissionsWithCategory: sync })
      });
      await loadGuilds(selectedGuildId || channel.guildId);
      setToast(sync ? "Permissoes sincronizadas com a categoria" : "O canal agora usa permissoes proprias");
    } catch (caught) {
      setToast(caught instanceof Error ? caught.message : "Nao foi possivel alterar a heranca de permissoes", "error");
    } finally {
      setChannelMenu(null);
    }
  }

  function renderChannel(channel: Channel) {
    const connectedUsers = voicePresence[channel.id] ?? [];
    const musicState = selectedGuild ? musicStates[selectedGuild.id] : undefined;
    const musicHere = channel.type === "VOICE" && musicState?.channelId === channel.id;
    const voiceCount = connectedUsers.length + (musicHere ? 1 : 0);
    const channelMuted = Boolean(selectedGuildPreferences?.mutedChannelIds.includes(channel.id));
    if (selectedGuildPreferences?.hideMutedChannels && channelMuted && selectedChannelId !== channel.id) return null;
    return (
      <div
        className={`channel-dnd-wrap ${draggedChannelId === channel.id ? "dragging" : ""} ${voiceDropTargetChannelId === channel.id ? "voice-member-drop-target" : ""} ${channelMuted ? "muted-channel" : ""}`}
        key={channel.id}
        draggable={canManageChannels}
        onDragStart={(event) => { event.stopPropagation(); setDraggedVoiceMember(null); setVoiceDropTargetChannelId(""); setDraggedCategoryId(""); setDraggedChannelId(channel.id); event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("text/ginga-channel", channel.id); }}
        onDragEnd={() => { setDraggedChannelId(""); setVoiceDropTargetChannelId(""); }}
        onDragOver={(event) => {
          const draggingVoiceUser = draggedVoiceMember || Array.from(event.dataTransfer.types).includes("text/ginga-voice-user");
          if (channel.type === "VOICE" && draggingVoiceUser) {
            if (draggedVoiceMember && (draggedVoiceMember.guildId !== channel.guildId || draggedVoiceMember.sourceChannelId === channel.id)) return;
            event.preventDefault();
            event.stopPropagation();
            event.dataTransfer.dropEffect = "move";
            if (voiceDropTargetChannelId !== channel.id) setVoiceDropTargetChannelId(channel.id);
            return;
          }
          if (canManageChannels && draggedChannelId) { event.preventDefault(); event.dataTransfer.dropEffect = "move"; }
        }}
        onDrop={(event) => {
          const transferredVoiceUser = event.dataTransfer.getData("text/ginga-voice-user");
          if (channel.type === "VOICE" && (draggedVoiceMember || transferredVoiceUser)) {
            event.preventDefault();
            event.stopPropagation();
            let voiceDrag = draggedVoiceMember;
            if (!voiceDrag && transferredVoiceUser) {
              try { voiceDrag = JSON.parse(transferredVoiceUser) as { userId: string; sourceChannelId: string; guildId: string; displayName: string }; } catch { voiceDrag = null; }
            }
            setDraggedVoiceMember(null);
            setVoiceDropTargetChannelId("");
            if (!voiceDrag || voiceDrag.guildId !== channel.guildId || voiceDrag.sourceChannelId === channel.id) return;
            void moveVoiceParticipant(voiceDrag.userId, channel.id).catch((caught) => setToast(caught instanceof Error ? caught.message : "Nao foi possivel mover o usuario", "error"));
            return;
          }
          if (!canManageChannels || !draggedChannelId) return;
          event.preventDefault();
          const draggedId = event.dataTransfer.getData("text/ginga-channel") || draggedChannelId;
          if (draggedId) void reorderChannelBefore(draggedId, channel.id);
        }}
        onContextMenu={(event) => { event.preventDefault(); setCategoryMenu(null); setChannelMenu({ x: event.clientX, y: event.clientY, channel }); }}
      >
        <button className={`modern-channel ${selectedChannelId === channel.id ? "active" : ""} ${unreadChannels[channel.id] ? "unread" : ""} ${mentionedChannels.has(channel.id) ? "mentioned" : ""}`} onClick={() => { setSelectedChannelId(channel.id); setMobileContextOpen(false); }}>
          {channelIcon(channel.type)}<span>{channel.name}</span>
          {channelMuted && <BellOff className="channel-muted-icon" size={12}/>}
          {channel.type === "VOICE" && voiceCount > 0 && <b>{voiceCount}</b>}
          {channel.type !== "VOICE" && unreadChannels[channel.id] ? <em className={`channel-unread-count ${mentionedChannels.has(channel.id) ? "mention" : ""}`}>{unreadChannels[channel.id] > 99 ? "99+" : unreadChannels[channel.id]}</em> : null}
        </button>
        {channel.type === "VOICE" && voiceCount > 0 && <div className="voice-channel-users">
          {musicHere && <button
            className="voice-channel-user ginga-music-voice-user"
            type="button"
            onClick={(event) => { const rect = event.currentTarget.getBoundingClientRect(); setMusicBotMenu({ guildId: channel.guildId, channelId: channel.id, x: rect.right + 8, y: rect.top }); }}
            onContextMenu={(event) => { event.preventDefault(); event.stopPropagation(); setMusicBotMenu({ guildId: channel.guildId, channelId: channel.id, x: event.clientX + 6, y: event.clientY + 6 }); }}
          ><span className="ginga-music-voice-avatar"><Music2 size={13}/></span><span>Ginga Music <em>BOT</em></span><span className={`voice-user-states ${musicState?.status === "PLAYING" ? "playing" : ""}`}><Music2 size={13}/></span></button>}
          {connectedUsers.map((voiceUser) => {
            const speaking = speakingVoiceUserIds.has(voiceUser.id) && !voiceUser.micMuted;
            const openVoiceMenu = (x: number, y: number) => setVoiceUserMenu({ user: voiceUser, channelId: channel.id, guildId: channel.guildId, x, y });
            return <button
              className={`voice-channel-user ${speaking ? "speaking" : ""} ${draggedVoiceMember?.userId === voiceUser.id && draggedVoiceMember.sourceChannelId === channel.id ? "voice-member-dragging" : ""}`}
              type="button"
              key={voiceUser.id}
              draggable={Boolean(selectedGuild?.permissions.canMoveMembers && voiceUser.id !== user.id)}
              title={selectedGuild?.permissions.canMoveMembers && voiceUser.id !== user.id ? `Arraste ${voiceUser.displayName} para outra sala de voz` : undefined}
              data-user-id={voiceUser.id}
              data-member-id={voiceUser.id}
              data-channel-id={channel.id}
              data-guild-id={channel.guildId}
              data-speaking={speaking ? "true" : "false"}
              data-voice-draggable={selectedGuild?.permissions.canMoveMembers && voiceUser.id !== user.id ? "true" : "false"}
              onDragStart={(event) => {
                if (!selectedGuild?.permissions.canMoveMembers || voiceUser.id === user.id) { event.preventDefault(); return; }
                event.stopPropagation();
                const payload = { userId: voiceUser.id, sourceChannelId: channel.id, guildId: channel.guildId, displayName: voiceUser.displayName };
                setDraggedChannelId("");
                setDraggedCategoryId("");
                setVoiceDropTargetChannelId("");
                setDraggedVoiceMember(payload);
                event.dataTransfer.effectAllowed = "move";
                event.dataTransfer.setData("text/ginga-voice-user", JSON.stringify(payload));
              }}
              onDragEnd={() => { setDraggedVoiceMember(null); setVoiceDropTargetChannelId(""); }}
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                setVoiceUserMenu(null);
                const member = members.find((entry) => entry.user.id === voiceUser.id);
                openUserCard(voiceUser, event.currentTarget.getBoundingClientRect(), member, channel.guildId);
              }}
              onPointerDown={(event) => {
                if (event.button !== 2) return;
                event.preventDefault();
                event.stopPropagation();
                openVoiceMenu(event.clientX + 6, event.clientY + 6);
              }}
              onContextMenu={(event) => {
                event.preventDefault();
                event.stopPropagation();
                openVoiceMenu(event.clientX + 6, event.clientY + 6);
              }}
            ><Avatar user={voiceUser} size="xs" status="online" /><span>{voiceUser.displayName}{voiceUser.id === user.id ? " (voce)" : ""}</span>{voiceUser.streaming && <em className="voice-live-badge" role="button" tabIndex={0} title={`Assistir transmissao de ${voiceUser.displayName}`} onClick={(event) => { event.preventDefault(); event.stopPropagation(); setVoiceStreamTarget({ channelId: channel.id, userId: voiceUser.id }); setSelectedGuildId(channel.guildId); setSelectedChannelId(channel.id); setSection("space"); setMobileContextOpen(false); }} onKeyDown={(event) => { if (event.key !== "Enter" && event.key !== " ") return; event.preventDefault(); event.stopPropagation(); setVoiceStreamTarget({ channelId: channel.id, userId: voiceUser.id }); setSelectedGuildId(channel.guildId); setSelectedChannelId(channel.id); setSection("space"); setMobileContextOpen(false); }}><Radio size={10}/> AO VIVO</em>}<span className="voice-user-states">{voiceUser.deafened ? <VolumeX size={13}/> : voiceUser.micMuted ? <MicOff size={13}/> : null}</span></button>;
          })}
        </div>}
      </div>
    );
  }

  if (loading) {
    return <div className="app-loading"><img className="ginga-mark-image loading" src="/ginga-mark.svg" alt="" /><small>Preparando...</small></div>;
  }

  return (
    <main
      className={`nexora-shell ${section === "space" ? "with-inspector" : "no-inspector"} ${mobileContextOpen ? "mobile-context-open" : ""}`}
      data-guild-sidebar-style={section === "space" ? (selectedGuild?.appearance?.sidebarStyle ?? "TINTED") : undefined}
      data-guild-channel-density={section === "space" ? (selectedGuild?.appearance?.channelDensity ?? "COZY") : undefined}
      style={section === "space" && selectedGuild ? {
        "--guild-accent": selectedGuild.appearance?.accentColor ?? selectedGuild.iconColor ?? "#7c3cff",
        "--guild-accent-2": selectedGuild.appearance?.secondaryColor ?? "#2c74ff",
        "--guild-banner-position": `${selectedGuild.appearance?.bannerPosition ?? 50}%`
      } as CSSProperties : undefined}
    >
      <button type="button" className="mobile-context-toggle" onClick={() => setMobileContextOpen((value) => !value)} aria-label={mobileContextOpen ? "Fechar navegacao" : "Abrir navegacao"} aria-expanded={mobileContextOpen}>
        {mobileContextOpen ? <X size={21}/> : <Menu size={21}/>}
      </button>
      {mobileContextOpen && <button type="button" className="mobile-context-backdrop" aria-label="Fechar navegacao" onClick={() => setMobileContextOpen(false)} />}
      <aside className="nav-panel app-rail">
        <button className={`rail-home ${section === "people" || section === "direct" ? "active" : ""}`} onClick={() => { setSection("people"); setActiveDirectCallId(""); }} aria-label="Inicio">
          <img className="ginga-mark-image rail-logo" src="/ginga-mark.svg" alt="" />
          {friends.incoming.length > 0 && <b className="rail-badge">{friends.incoming.length}</b>}
        </button>
        <div className="rail-divider" />
        <button className={`rail-action ${section === "people" || section === "direct" ? "active" : ""}`} onClick={() => { setSection("people"); setActiveDirectCallId(""); }} aria-label="Pessoas"><Users size={20} /></button>
        <button className={`rail-action ${section === "news" ? "active" : ""}`} onClick={() => { setSection("news"); setActiveDirectCallId(""); }} aria-label="Novidades do Ginga"><Megaphone size={20} /></button>
        <button className={`rail-action community-rail-action ${section === "communities" ? "active" : ""}`} onClick={() => { setSection("communities"); setActiveDirectCallId(""); }} aria-label="Explorar comunidades"><Compass size={20} /></button>
        <div className="rail-divider" />
        <div className={`space-nav-list rail-spaces ${draggedGuildId && folderForGuild(draggedGuildId) ? "dragging-folder-child" : ""}`}>
          {railItems.map((item) => {
            if (item.kind === "guild") return renderRailGuild(item.guild);
            const folder = item.folder;
            const folderGuilds = folder.guildIds.map((id) => guilds.find((guild) => guild.id === id)).filter((guild): guild is Guild => Boolean(guild));
            if (!folderGuilds.length) return null;
            const folderAttention = folderGuilds.flatMap((guild) => {
              const preferences = loadGuildPreferences(guild.id);
              const mode = guildNotificationMode(preferences);
              return guild.channels.filter((channel) => {
                if (preferences.mutedChannelIds.includes(channel.id) || mode === "SILENT") return false;
                if (mode === "MENTIONS") return mentionedChannels.has(channel.id);
                return true;
              });
            });
            const folderUnreadCount = folderAttention.reduce((sum, channel) => sum + (unreadChannels[channel.id] ?? 0), 0);
            const hasUnread = folderUnreadCount > 0;
            const hasMention = folderAttention.some((channel) => mentionedChannels.has(channel.id));
            const hasVoice = folderGuilds.some((guild) => activeVoiceGuild?.id === guild.id);
            return <div
              className={`rail-server-folder ${folder.expanded ? "expanded" : "collapsed"} ${hasUnread ? "has-unread" : ""}`}
              key={folder.id}
              style={{ "--folder-color": folder.color } as CSSProperties}
              onDragOver={(event) => { if (draggedGuildId) { event.preventDefault(); event.dataTransfer.dropEffect = "move"; } }}
              onDrop={(event) => { event.preventDefault(); event.stopPropagation(); const draggedId = event.dataTransfer.getData("text/ginga-guild") || draggedGuildId; addGuildToFolder(draggedId, folder.id); setDraggedGuildId(""); }}
            >
              <button className="rail-folder-button" type="button" onClick={() => updateFolder(folder.id, { expanded: !folder.expanded })} onContextMenu={(event) => { event.preventDefault(); setFolderMenu({ x: event.clientX, y: event.clientY, folderId: folder.id }); }} aria-label={`${folder.name} · ${folderGuilds.length} servidores`}>
                {folder.expanded
                  ? <span className="rail-folder-open-icon"><FolderOpen size={20}/></span>
                  : <span className="rail-folder-grid">{folderGuilds.slice(0, 4).map((guild) => <i key={guild.id} className={guild.iconUrl ? "with-image" : ""} style={{ background: guild.iconColor }}>{guild.iconUrl ? <img src={guild.iconUrl} alt=""/> : guild.name.slice(0,1).toUpperCase()}</i>)}</span>}
                {hasVoice ? <span className="rail-voice-badge"><Volume2 size={12}/></span> : null}
                {folderUnreadCount > 0 ? <b className={`rail-mention-badge ${hasMention ? "mention" : ""}`}>{folderUnreadCount > 99 ? "99+" : folderUnreadCount}</b> : null}
              </button>
              {folder.expanded && <div className="rail-folder-children">{folderGuilds.map((guild) => renderRailGuild(guild, true))}</div>}
            </div>;
          })}
          {draggedGuildId && folderForGuild(draggedGuildId) && (
            <div
              className="rail-folder-exit-dropzone"
              role="button"
              tabIndex={-1}
              aria-label="Remover servidor da pasta"
              onDragOver={(event) => { event.preventDefault(); event.stopPropagation(); event.dataTransfer.dropEffect = "move"; }}
              onDrop={(event) => {
                event.preventDefault();
                event.stopPropagation();
                const guildId = event.dataTransfer.getData("text/ginga-guild") || draggedGuildId;
                removeGuildFromFolder(guildId);
              }}
            >
              <FolderInput size={18}/>
              <span>Solte aqui</span>
            </div>
          )}
          <button className="rail-action rail-add" onClick={() => setShowAddSpace(true)} aria-label="Adicionar espaco"><Plus size={20} /></button>
        </div>
        <div className="rail-footer">
          {!desktop && (user.systemRole === "DEVELOPER" || user.systemRole === "PLATFORM_ADMIN") && <button className="rail-action" onClick={() => onNavigate("/developers")} aria-label="Developer Portal"><Code2 size={19}/></button>}
          {!desktop && user.systemRole === "PLATFORM_ADMIN" && <button className="rail-action" onClick={() => onNavigate("/admin")} aria-label="Ginga Control"><ShieldCheck size={19}/></button>}
          <button className="rail-action" onClick={() => onNavigate("/knowledge")} aria-label="Base de conhecimento"><BookOpen size={19}/></button>
          <button className={`rail-action rail-notifications ${showNotificationCenter ? "active" : ""}`} onClick={() => setShowNotificationCenter((value)=>!value)} aria-label={`Notificacoes nao lidas: ${attentionUnreadCount}`}><Bell size={19}/>{attentionUnreadCount>0&&<b className="rail-badge rail-notification-count">{attentionUnreadCount>99?"99+":attentionUnreadCount}</b>}</button>
          <button className={`rail-profile ${selfPresenceMenu ? "active" : ""}`} onClick={(event) => { const rect = event.currentTarget.getBoundingClientRect(); setSelfPresenceMenu((current) => current ? null : { x: rect.right + 9, y: rect.top }); }} aria-label={`Status e configuracoes de @${user.username}`}><Avatar user={user} size="sm" status={socketConnected ? presenceModeToAvatarStatus(presenceModes[user.id] ?? "ONLINE") : "offline"} /></button>
          <button className="rail-action rail-logout" onClick={onLogout} aria-label="Sair"><LogOut size={18}/></button>
        </div>
      </aside>

      {showNotificationCenter && <div className="notification-center-backdrop" onMouseDown={()=>setShowNotificationCenter(false)}><aside className="notification-center-panel" onMouseDown={(event)=>event.stopPropagation()}><header><div><Bell size={18}/><span><strong>Notificacoes</strong><small>{attentionUnreadCount ? `${attentionUnreadCount} nao lidas` : "Tudo em dia"}</small></span></div>{notificationCenterItems.length>0&&<button type="button" onClick={markAllNotificationsRead}><Check size={14}/> Marcar tudo como lido</button>}</header><div className="notification-center-list">{notificationCenterItems.length===0?<div className="notification-center-empty"><Check size={24}/><strong>Nada pendente</strong><span>Mensagens, mencoes e DMs aparecem aqui.</span></div>:notificationCenterItems.map(item=><button key={item.id} className={item.mention?"mention":""} onClick={()=>openNotificationCenterItem(item)}><span className="notification-center-icon">{item.kind==="direct"?<MessageCircle size={16}/>:<MessageSquare size={16}/>}</span><span className="notification-center-copy"><strong>{item.title}</strong><small>{item.detail}</small></span>{item.mention&&<em>MENCAO</em>}<b>{item.count>99?"99+":item.count}</b></button>)}</div></aside></div>}

      <aside className={`context-panel ${showPersistentVoiceCard ? "has-voice-connection" : ""} ${mobileContextOpen ? "mobile-open" : ""}`}>
        {section === "news" && <div className="context-empty large"><Megaphone size={28}/><strong>Novidades</strong><span>Releases, avisos e manutenção da plataforma.</span></div>}
        {section === "communities" && <div className="context-empty large community-context"><Compass size={30}/><strong>Explorar</strong><span>Descubra servidores publicos e entre em comunidades sem precisar de convite.</span><button type="button" className="secondary-button" onClick={() => setShowAddSpace(true)}><Plus size={15}/> Criar meu servidor</button></div>}
        {(section === "people" || section === "direct") && (
          <>
            <header className="context-header"><div><small>PRIVADO</small><strong>Conversas</strong></div><button onClick={() => setSection("people")} aria-label="Encontrar pessoa" title="Encontrar pessoa"><Search size={16} /></button></header>
            <div className="context-scroll">
              <button className={`context-home ${section === "people" ? "active" : ""}`} onClick={() => { setSection("people"); setActiveDirectCallId(""); }}><Users size={18} /><span>Amigos</span></button>
              <div className="context-group-title"><span>MENSAGENS DIRETAS</span></div>
              {conversations.map((conversation) => (
                <button key={conversation.id} className={`direct-nav-row ${section === "direct" && selectedConversationId === conversation.id ? "active" : ""} ${unreadDirect[conversation.id] ? "unread" : ""}`} onClick={() => openConversation(conversation.id)} onContextMenu={(event) => { event.preventDefault(); setDirectMenu({ x: event.clientX, y: event.clientY, conversation }); }}>
                  <Avatar user={conversation.otherUser} size="sm" status={onlineUserIds.has(conversation.otherUser.id) ? "online" : "offline"} />
                  <div><strong>{conversation.otherUser.displayName}</strong><span>{directMessagePreview(conversation.lastMessage, `@${conversation.otherUser.username}`)}</span></div>
                  {unreadDirect[conversation.id] ? <b className="direct-unread-badge">{unreadDirect[conversation.id] > 99 ? "99+" : unreadDirect[conversation.id]}</b> : null}
                </button>
              ))}
              {conversations.length === 0 && <div className="context-empty">Abra o perfil de um amigo ou de alguem de um espaco em comum para iniciar uma conversa.</div>}{directCallHistory.length>0&&<details className="direct-call-history-panel"><summary><Clock3 size={14}/><span>Historico de chamadas</span><b>{directCallHistory.length}</b></summary><div className="direct-call-history-list">{directCallHistory.slice(0,10).map(call=><button type="button" key={call.id} onClick={()=>call.peerUserId&&void startConversation(call.peerUserId)}><span className={`direct-call-history-icon ${call.state==="MISSED"?"missed":""}`}><Phone size={13}/></span><span><strong>{call.peer?.displayName??"Usuario"}</strong><small>{call.state==="MISSED"?"Chamada perdida":call.state==="DECLINED"?"Recusada":"Chamada encerrada"}</small></span><time>{call.startedAt ? new Date(call.startedAt).toLocaleDateString("pt-BR",{day:"2-digit",month:"2-digit"}) : "--/--"}</time></button>)}</div></details>}
            </div>
          </>
        )}

        {section === "space" && selectedGuild && (
          <>
            <header className="context-header space-context-header"><div><small>ESPACO</small><strong>{selectedGuild.name}</strong></div><span className="space-context-actions-v3"><button onClick={() => setShowGlobalSearch(true)} aria-label="Buscar mensagens no servidor" title="Buscar no servidor (Ctrl+Shift+F)"><Search size={17}/></button>{canOpenServerSettings && <button onClick={() => { setServerSettingsInitialTab(undefined); setShowServerSettings(true); }} aria-label="Configuracoes do espaco"><Settings size={17} /></button>}</span></header>
            {selectedGuild.bannerUrl && selectedGuild.appearance?.showBannerInSidebar !== false && <div className="space-context-banner"><img src={selectedGuild.bannerUrl} alt="" style={{ objectPosition: `50% ${selectedGuild.appearance?.bannerPosition ?? 50}%` }}/><div><strong>{selectedGuild.name}</strong>{selectedGuild.description && <span>{selectedGuild.description}</span>}</div></div>}
            <div className="context-scroll channel-list">
              {canManageChannels && <div className="channel-list-toolbar"><button onClick={() => setShowCategoryModal(true)}><FolderPlus size={15} /> Categoria</button><button onClick={() => { setChannelModalDefaultType("TEXT"); setShowChannelModal(true); }}><Plus size={15} /> Canal</button></div>}
              {orderedCategories.map((category) => {
                const categoryChannels = selectedGuild.channels.filter((channel) => channel.categoryId === category.id).sort((a, b) => a.position - b.position);
                return <section
                  className={`channel-group category-drop-zone ${draggedCategoryId === category.id ? "dragging" : ""}`}
                  key={category.id}
                  draggable={canManageChannels}
                  onDragStart={(event) => { if (!canManageChannels || event.target !== event.currentTarget) return; setDraggedChannelId(""); setDraggedCategoryId(category.id); event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("text/ginga-category", category.id); }}
                  onDragEnd={() => setDraggedCategoryId("")}
                  onDragOver={(event) => { if (canManageChannels && (draggedChannelId || draggedCategoryId)) event.preventDefault(); }}
                  onDrop={(event) => { event.preventDefault(); const movedCategory = event.dataTransfer.getData("text/ginga-category") || draggedCategoryId; if (movedCategory) { void reorderCategoryBefore(movedCategory, category.id); return; } const channelId = event.dataTransfer.getData("text/ginga-channel") || draggedChannelId; const channel = selectedGuild.channels.find((item) => item.id === channelId); if (channel) void moveChannelToCategory(channel, category.id); }}
                >
                  <div className="context-group-title category-heading" onContextMenu={(event) => { event.preventDefault(); setChannelMenu(null); setCategoryMenu({ x: event.clientX, y: event.clientY, category }); }}>
                    <button type="button" className="category-collapse-button" aria-expanded={!collapsedChannelCategories.has(category.id)} onClick={() => toggleChannelCategoryCollapsed(category.id)} title={collapsedChannelCategories.has(category.id) ? "Expandir categoria" : "Recolher categoria"}>
                      <ChevronDown size={13} className={collapsedChannelCategories.has(category.id) ? "collapsed" : ""}/>
                      <span>{category.name.toUpperCase()}</span>
                    </button>
                    {canManageChannels && <button type="button" onClick={(event) => { event.stopPropagation(); setChannelModalDefaultType("TEXT"); setShowChannelModal(true); }} aria-label={`Criar canal em ${category.name}`}><Plus size={15} /></button>}
                  </div>
                  {!collapsedChannelCategories.has(category.id) && categoryChannels.map(renderChannel)}
                  {!collapsedChannelCategories.has(category.id) && categoryChannels.length === 0 && canManageChannels && <div className="category-empty-drop">Arraste um canal para ca</div>}
                </section>;
              })}
              <section
                className="channel-group category-drop-zone"
                onDragOver={(event) => { if (canManageChannels && draggedChannelId) event.preventDefault(); }}
                onDrop={(event) => { event.preventDefault(); const channelId = event.dataTransfer.getData("text/ginga-channel") || draggedChannelId; const channel = selectedGuild.channels.find((item) => item.id === channelId); if (channel) void moveChannelToCategory(channel, null); }}
              >
                {selectedGuild.channels.some((channel) => !channel.categoryId) && <div className="context-group-title"><span>SEM CATEGORIA</span></div>}
                {selectedGuild.channels.filter((channel) => !channel.categoryId).sort((a, b) => a.position - b.position).map(renderChannel)}
              </section>
              <section className="space-quick-actions">
                {canCreateInvites && <button onClick={() => void openInvite()}><UserPlus size={16} /> Convidar pessoas</button>}
                {canOpenServerSettings && <button onClick={() => { setServerSettingsInitialTab(undefined); setShowServerSettings(true); }}><Settings size={16} /> Gerenciar espaco</button>}
              </section>
            </div>
          </>
        )}

        {section === "space" && !selectedGuild && <div className="context-empty large onboarding-context"><CirclePlus size={26}/><strong>Seu Ginga esta pronto</strong><span>Crie um servidor ou use um codigo de convite.</span><button type="button" className="secondary-button" onClick={() => setShowAddSpace(true)}><Plus size={15}/> Adicionar servidor</button></div>}

        {showPersistentVoiceCard && activeVoiceChannel && (
          <section className="voice-connection-card">
            {persistentSoundboardOpen && activeVoiceGuild && <SoundboardPanel guildId={activeVoiceGuild.id} channelId={activeVoiceChannel.id} socket={socket} canManage={activeVoiceGuild.permissions.canManageServer} onClose={() => setPersistentSoundboardOpen(false)} />}
            <button className="voice-connection-info" type="button" onClick={openActiveVoiceChannel}>
              <span className="voice-connection-signal"><Headset size={17}/></span>
              <span><strong>Voz conectada</strong><small>{activeVoiceChannel.name}{activeVoiceGuild ? ` · ${activeVoiceGuild.name}` : ""}</small></span>
            </button>
            <div className="voice-connection-actions">
              <button type="button" className={localVoiceMuted ? "active off" : ""} onClick={() => void togglePersistentVoiceMic()} aria-label={localVoiceMuted ? "Ativar microfone" : "Desativar microfone"}>{localVoiceMuted ? <MicOff size={16}/> : <Mic size={16}/>}</button>
              <button type="button" className={localVoiceDeafened ? "active off" : ""} onClick={togglePersistentVoiceDeafen} aria-label={localVoiceDeafened ? "Ativar som da chamada" : "Silenciar som da chamada"}>{localVoiceDeafened ? <VolumeX size={16}/> : <Volume2 size={16}/>}</button>
              <button type="button" className={`soundboard-trigger ${persistentSoundboardOpen ? "active" : ""}`} onClick={() => { setPersistentScreenMenuOpen(false); setPersistentSoundboardOpen((value) => !value); }} aria-label="Abrir painel de sons" title="Sons"><Music2 size={16}/></button>
              <span className="persistent-screen-control">
                <button type="button" className={persistentScreenEnabled ? "active streaming" : ""} onClick={() => { setPersistentSoundboardOpen(false); if (persistentScreenEnabled) setPersistentScreenMenuOpen((value) => !value); else void togglePersistentVoiceScreen(); }} aria-label={persistentScreenEnabled ? "Opcoes da transmissao" : "Compartilhar tela"} title={persistentScreenEnabled ? `${persistentViewerCount} assistindo` : "Compartilhar tela"}><ScreenShare size={16}/>{persistentScreenEnabled && persistentViewerCount > 0 && <b>{persistentViewerCount}</b>}</button>
                {persistentScreenEnabled && persistentScreenMenuOpen && <span className="persistent-screen-menu">
                  <span className="persistent-screen-audience"><Eye size={13}/><strong>{persistentViewerCount}</strong> assistindo</span>
                  <button type="button" onClick={() => void switchPersistentVoiceScreen()}><RefreshCw size={14}/> Trocar janela</button>
                  <button type="button" className="danger" onClick={() => void togglePersistentVoiceScreen()}><X size={14}/> Encerrar transmissao</button>
                </span>}
              </span>
              <button type="button" onClick={() => { setUserSettingsTab("voice"); setShowUserSettings(true); }} aria-label="Abrir configuracoes de voz"><Settings size={16}/></button>
              <button type="button" className="hangup" onClick={disconnectPersistentVoice} aria-label="Sair da sala de voz"><PhoneOff size={16}/></button>
            </div>
          </section>
        )}
      </aside>

      <PersistentVoiceAudio activeChannelId={activeVoiceChannelId} activeGuildId={activeVoiceGuild?.id} voiceViewVisible={voiceViewVisible} socket={socket} />
      <GingaMusicPlayer guildId={activeVoiceGuild?.id ?? ""} channelId={activeVoiceChannelId} userId={user.id} socket={socket} deafened={Boolean(localVoicePresence?.deafened)} onState={rememberMusicState} />

      <section className="main-panel">
        {section === "communities" && <CommunityExplore onOpenGuild={async (guildId) => { await loadGuilds(guildId); setSelectedGuildId(guildId); setSection("space"); }} onJoined={async (guildId, welcomeChannelId) => { await loadGuilds(guildId); setSelectedGuildId(guildId); if (welcomeChannelId) setSelectedChannelId(welcomeChannelId); setSection("space"); setToast("Voce entrou na comunidade"); }} />}
        {section === "news" && <GingaNews socket={socket} />}
        {section === "people" && <FriendsView data={friends} onlineUserIds={onlineUserIds} onReload={loadFriends} onStartConversation={startConversation} onStartCall={startDirectCallWithUser} onUserClick={(target, rect) => openUserCard(target, rect)} />}
        {section === "direct" && activeDirectCall && activeDirectCall.state === "ACTIVE" && activeDirectCall.membershipStatus === "JOINED" && (
          <MediaRoom
            title={activeDirectCall.participants.filter((item) => ["JOINED","INVITED","LEFT"].includes(item.status)).length > 2 ? "Chamada em grupo" : `Chamada com ${activeCallConversation?.otherUser.displayName ?? activeDirectCall.peer?.displayName ?? "usuario"}`}
            subtitle="Chamada privada do Ginga"
            tokenPath="/api/livekit/direct-token"
            tokenBody={{ callId: activeDirectCall.id }}
            directCall={activeDirectCall}
            inviteCandidates={friends.friends.map((entry) => entry.user)}
            onInviteParticipant={(userId) => inviteToDirectCall(activeDirectCall, userId)}
            onEndCallForEveryone={activeDirectCall.callerId === user.id ? () => endDirectCall(activeDirectCall) : undefined}
            onLeave={() => void leaveDirectCall(activeDirectCall)}
          />
        )}
        {section === "direct" && !(activeDirectCall && activeDirectCall.state === "ACTIVE" && activeDirectCall.membershipStatus === "JOINED") && selectedConversation && <DirectChat conversation={selectedConversation} currentUser={user} socket={socket} online={onlineUserIds.has(selectedConversation.otherUser.id)} call={selectedConversationCall} onStartCall={() => void startDirectCall(selectedConversation)} onJoinCall={(call) => void joinDirectCall(call)} onCancelCall={(call) => void (call.callerId === user.id ? endDirectCall(call) : declineDirectCall(call))} onConversationActivity={loadConversations} onUserClick={(target, rect) => openUserCard(target, rect)} onJoinServerInvite={joinInviteFromDirect} />}
        {section === "direct" && !(activeDirectCall && activeDirectCall.state === "ACTIVE" && activeDirectCall.membershipStatus === "JOINED") && !selectedConversation && <div className="welcome-empty"><span className="welcome-icon"><MessageCircle size={42} /></span><h1>Escolha uma conversa</h1><p>Suas mensagens privadas e chamadas ficam aqui.</p></div>}
        {section === "space" && !selectedGuild && (
          <section className="server-onboarding">
            <div className="server-onboarding-hero">
              <img src="/ginga-mark.svg" alt="" />
              <div><span>PRIMEIROS PASSOS</span><h1>Comece do seu jeito</h1><p>Sua conta nao cria servidor automaticamente. Voce decide se quer criar um novo ou entrar em um que ja existe.</p></div>
            </div>
            <div className="server-onboarding-grid">
              <button type="button" className="server-onboarding-card create" onClick={() => setShowAddSpace(true)}>
                <span className="server-onboarding-icon"><Plus size={26}/></span>
                <strong>Criar um servidor</strong>
                <p>Monte sua comunidade, equipe, grupo de amigos ou projeto com canais e permissoes.</p>
                <em>Escolher modelo <ChevronRight size={16}/></em>
              </button>
              <form className="server-onboarding-card join" onSubmit={joinSpace}>
                <span className="server-onboarding-icon"><Link2 size={25}/></span>
                <strong>Entrar em um servidor</strong>
                <p>Cole o codigo do convite que alguem enviou para voce.</p>
                <label><span>CODIGO DO CONVITE</span><input name="code" required minLength={4} maxLength={16} placeholder="Ex.: 7F2K9P" autoComplete="off" /></label>
                <button type="submit" className="primary-button">Entrar no servidor <ChevronRight size={16}/></button>
              </form>
            </div>
            <div className="server-onboarding-tip"><Sparkles size={16}/><span>Depois voce pode organizar servidores em pastas, convidar amigos por DM e instalar bots pelo Portal de Desenvolvedores.</span></div>
          </section>
        )}
        {section === "space" && selectedGuild && selectedChannel && ["TEXT","ANNOUNCEMENT"].includes(selectedChannel.type) && <ChatView key={selectedChannel.id} channel={selectedChannel} currentUser={user} socket={socket} permissions={selectedGuild.permissions} guildOwnerId={selectedGuild.ownerId} members={members} forwardChannels={selectedGuild.channels.filter((item) => ["TEXT","ANNOUNCEMENT"].includes(item.type))} onUserClick={(target, rect) => openUserCard(target, rect, members.find((member) => member.user.id === target.id), selectedGuild.id)} onUserContextMenu={(target, x, y) => { const member = members.find((item) => item.user.id === target.id); if (member) { setMemberMenu({ x, y, member }); return; } openUserCard(target, DOMRect.fromRect({ x, y, width: 1, height: 1 }), undefined, selectedGuild.id); }} />}
        {section === "space" && selectedGuild && selectedChannel?.type === "FORUM" && <ForumView key={selectedChannel.id} channel={selectedChannel} currentUser={user} socket={socket} canManage={selectedGuild.permissions.canManageForums} />}
        {section === "space" && selectedGuild && selectedChannel?.type === "EVENT" && <EventsView key={selectedChannel.id} channel={selectedChannel} guild={selectedGuild} currentUser={user} socket={socket} />}
        {section === "space" && selectedGuild && selectedChannel?.type === "VOICE" && <VoiceRoom key={selectedChannel.id} channel={selectedChannel} currentUserId={user.id} voiceChannels={selectedGuild.channels.filter((item) => item.type === "VOICE")} socket={socket} onLeave={leaveVoice} onOpenVoiceSettings={() => { setUserSettingsTab("voice"); setShowUserSettings(true); }} onOpenParticipantProfile={openUserProfileById} onMessageParticipant={startConversation} onCallParticipant={startDirectCallWithUser} onKickParticipant={kickVoiceParticipant} onBanParticipant={banVoiceParticipant} onTimeoutParticipant={timeoutVoiceParticipant} onServerMuteParticipant={(userId, muted) => setServerVoiceModeration(userId, { muted }, selectedGuild.id)} onServerDeafenParticipant={(userId, deafened) => setServerVoiceModeration(userId, { deafened }, selectedGuild.id)} onMoveParticipant={moveVoiceParticipant} onDisconnectParticipant={(userId) => disconnectVoiceParticipant(selectedGuild.id, userId)} canKickParticipants={selectedGuild.permissions.canKickMembers} canMoveParticipants={selectedGuild.permissions.canMoveMembers} canBanParticipants={selectedGuild.permissions.canBanMembers} canTimeoutParticipants={selectedGuild.permissions.canManageMembers || selectedGuild.permissions.canKickMembers} canMuteParticipants={selectedGuild.permissions.canMuteMembers} canDeafenParticipants={selectedGuild.permissions.canDeafenMembers} canManageParticipantRoles={selectedGuild.permissions.canManageRoles} canShareScreen={selectedGuild.permissions.canShareScreen} canUseVideo={selectedGuild.permissions.canUseVideo} canManageSoundboard={selectedGuild.permissions.canManageServer} autoWatchUserId={voiceStreamTarget?.channelId === selectedChannel.id ? voiceStreamTarget.userId : ""} onManageParticipantRoles={() => { setServerSettingsInitialTab("members"); setShowServerSettings(true); }} />}
      </section>

      {section === "space" && (
        <aside className="inspector-panel">
          {selectedGuild && (
            <>
              <header className="inspector-header"><Users size={17} /> Pessoas <span>{members.length}</span></header>
              <div className="member-list">
                {memberGroups.map((group) => {
                  const collapsed = collapsedMemberGroups.has(group.id);
                  return <section className={`member-group-block ${collapsed ? "collapsed" : ""} ${group.id === "__offline" ? "offline-group" : ""}`} key={group.id}>
                    <button type="button" className="member-group-heading" onClick={() => toggleMemberGroup(group.id)} aria-expanded={!collapsed} title={collapsed ? `Expandir ${group.name}` : `Recolher ${group.name}`}>
                      <span><ChevronRight size={12} className="member-group-chevron" />{group.color && <i style={{ background: group.color }} />}{group.icon ? `${group.icon} ` : ""}{group.name}</span><b>{group.members.length}</b>
                    </button>
                    {!collapsed && group.members.map((member) => {
                      const topRole = [...(member.customRoles ?? [])].sort((a, b) => b.position - a.position)[0];
                      const voiceEntry = Object.entries(voicePresence).find(([, users]) => users.some((entry) => entry.id === member.user.id));
                      const voiceChannel = voiceEntry ? selectedGuild.channels.find((channel) => channel.id === voiceEntry[0]) : null;
                      const speaking = speakingVoiceUserIds.has(member.user.id) && !member.serverMuted;
                      const memberPresence = member.user.id === user.id
                        ? (socketConnected ? (presenceModes[member.user.id] ?? "ONLINE") : "OFFLINE")
                        : (presenceModes[member.user.id] ?? (onlineUserIds.has(member.user.id) ? "ONLINE" : "OFFLINE"));
                      const online = memberPresence !== "OFFLINE";
                      const isGuildOwner = selectedGuild.ownerId === member.user.id;
                      return <button className={`member-row ${online ? "" : "member-row-offline"}`} type="button" key={member.user.id} onClick={(event) => openUserCard(member.user, event.currentTarget.getBoundingClientRect(), member, selectedGuild.id)} onContextMenu={(event) => { event.preventDefault(); setMemberMenu({ x: event.clientX, y: event.clientY, member }); }}>
                        <Avatar user={member.user} size="sm" status={presenceModeToAvatarStatus(memberPresence)} />
                        <div><strong className="member-display-name" style={topRole ? { color: topRole.color } : undefined}>{member.nickname || member.user.displayName}{isGuildOwner && <Crown size={13} className="guild-owner-crown" aria-label="Criador do servidor" />} <UserBadges user={member.user} compact /></strong><span>@{member.user.username}{member.nickname ? ` · ${member.user.displayName}` : ""}</span>{voiceChannel && <small className={`member-voice-location ${speaking ? "speaking" : ""}`}><Headphones size={11}/>{voiceChannel.name}{speaking ? " · falando" : ""}</small>}{(member.serverMuted || member.serverDeafened) && <small className="member-voice-flags">{member.serverMuted ? "Mic mutado" : ""}{member.serverMuted && member.serverDeafened ? " · " : ""}{member.serverDeafened ? "Ensurdecido" : ""}</small>}{member.user.statusMessage && <small>{member.user.statusMessage}</small>}</div>
                      </button>;
                    })}
                  </section>;
                })}
              </div>
            </>
          )}
        </aside>
      )}

      {incomingDirectCall && (
        <div className="incoming-call-banner">
          <Avatar user={incomingDirectCall.peer ?? undefined} size="sm" status="online" />
          <div><strong>{incomingDirectCall.state === "ACTIVE" ? `${incomingDirectCall.peer?.displayName ?? "Alguem"} convidou voce` : `${incomingDirectCall.peer?.displayName ?? "Alguem"} esta chamando`}</strong><span>{incomingDirectCall.state === "ACTIVE" ? "Chamada em grupo no Ginga" : "Chamada privada no Ginga"}</span></div>
          <button className="call-accept" onClick={() => void joinDirectCall(incomingDirectCall)}><Phone size={17} /> {incomingDirectCall.state === "ACTIVE" ? "Entrar" : "Atender"}</button>
          <button className="call-decline" onClick={() => void declineDirectCall(incomingDirectCall)}><X size={17} /></button>
        </div>
      )}

      {showAddSpace && (
        <Modal title="Adicionar espaco" onClose={() => setShowAddSpace(false)} width="lg">
          <div className="space-create-layout">
            <form className="stack-form space-create-form" onSubmit={createSpace}>
              <label>Nome do espaco<input name="name" required minLength={2} maxLength={64} placeholder="Minha equipe" autoFocus /></label>
              <div className="template-picker">
                <div className="template-picker-title"><strong>Modelo</strong><span>{serverTemplates.length || 1} opcoes</span></div>
                <div className="template-grid">
                  {(serverTemplates.length ? serverTemplates : [{ id: "basic", name: "Essencial", description: "Estrutura enxuta para comecar.", icon: "basic", accent: "#6f7b88", categoryCount: 2, channelCount: 2, roleCount: 0 } satisfies GuildTemplateSummary]).map((template) => (
                    <button type="button" key={template.id} className={`template-card ${selectedTemplateId === template.id ? "active" : ""}`} onClick={() => setSelectedTemplateId(template.id)}>
                      <span className="template-card-icon" style={{ "--template-accent": template.accent } as CSSProperties}>{templateIcon(template.icon)}</span>
                      <span className="template-card-copy"><strong>{template.name}</strong><small>{template.description}</small><em>{template.channelCount} canais · {template.roleCount} cargos</em></span>
                      {selectedTemplateId === template.id && <Check size={16} />}
                    </button>
                  ))}
                </div>
              </div>
              <button className="primary-button"><Plus size={17} /> Criar espaco</button>
            </form>

            <form className="join-space-compact" onSubmit={joinSpace}>
              <div><Link2 size={17}/><strong>Entrar por convite</strong></div>
              <input name="code" required minLength={4} maxLength={16} placeholder="Codigo ou final do link" />
              <button className="secondary-button">Entrar</button>
            </form>
          </div>
        </Modal>
      )}

      {showChannelModal && selectedGuild && (
        <Modal title="Criar canal" onClose={() => { setShowChannelModal(false); setChannelModalDefaultType("TEXT"); }} width="md">
          <form className="stack-form" onSubmit={createChannel}>
            <label>Tipo de canal<div className="channel-type-grid">
              <label><input type="radio" name="type" value="TEXT" defaultChecked={channelModalDefaultType === "TEXT"} /><span><MessageSquare /><strong>Texto</strong><small>Chat e arquivos</small></span></label>
              <label><input type="radio" name="type" value="VOICE" defaultChecked={channelModalDefaultType === "VOICE"} /><span><Headphones /><strong>Voz</strong><small>Voz, camera e tela</small></span></label>
              <label><input type="radio" name="type" value="ANNOUNCEMENT" defaultChecked={channelModalDefaultType === "ANNOUNCEMENT"} /><span><Megaphone /><strong>Anuncios</strong><small>Comunicados oficiais</small></span></label>
              <label><input type="radio" name="type" value="FORUM" defaultChecked={channelModalDefaultType === "FORUM"} /><span><MessageSquareText /><strong>Forum</strong><small>Topicos organizados</small></span></label>
              <label><input type="radio" name="type" value="EVENT" defaultChecked={channelModalDefaultType === "EVENT"} /><span><CalendarDays /><strong>Eventos</strong><small>Agenda e encontros</small></span></label>
            </div></label>
            <label>Categoria<select name="categoryId" defaultValue={selectedGuild.categories[0]?.id ?? ""}><option value="">Sem categoria</option>{orderedCategories.map((category) => <option value={category.id} key={category.id}>{category.name}</option>)}</select></label>
            <label>Nome do canal<input name="name" required minLength={1} maxLength={48} placeholder="Geral, Sala da Galera 🎮, Suporte #1..." autoFocus /><small>Use espacos, maiusculas, acentos, emojis e simbolos. So nao pode ficar sem nome.</small></label>
            <label>Modo lento<select name="slowModeSeconds" defaultValue="0"><option value="0">Desativado</option><option value="5">5 segundos</option><option value="10">10 segundos</option><option value="15">15 segundos</option><option value="30">30 segundos</option><option value="60">1 minuto</option><option value="120">2 minutos</option><option value="300">5 minutos</option><option value="600">10 minutos</option></select><small>Evita spam exigindo um intervalo entre mensagens de membros. Administradores e quem gerencia mensagens nao sao limitados.</small></label>
            <button className="primary-button">Criar canal</button>
          </form>
        </Modal>
      )}

      {showCategoryModal && selectedGuild && (
        <Modal title="Criar categoria" onClose={() => setShowCategoryModal(false)} width="sm">
          <form className="stack-form" onSubmit={createCategory}>
            <p className="muted-copy">Categorias agrupam canais de texto, voz, anuncios, forum e eventos. Depois voce pode arrastar os canais entre elas.</p>
            <label>Nome da categoria<input name="name" required minLength={1} maxLength={48} placeholder="Equipe, Geral, Projetos..." autoFocus /></label>
            <button className="primary-button"><FolderPlus size={17} /> Criar categoria</button>
          </form>
        </Modal>
      )}

      {showInviteModal && selectedGuild && (
        <Modal title={`Convidar para ${selectedGuild.name}`} onClose={() => setShowInviteModal(false)} width="md">
          <div className="invite-box invite-box-pro">
            <span className="modal-option-icon invite-hero-icon"><UserPlus /></span>
            <div className="invite-hero-copy"><h3>Convide seus amigos para {selectedGuild.name}</h3><p>Envie direto pela DM do Ginga ou copie o link. O convite rapido expira em 7 dias.</p></div>
            <section className="invite-friends-panel">
              <div className="invite-friends-heading"><div><strong>AMIGOS</strong><span>{friends.friends.length}</span></div><small>O convite chega como um card dentro da conversa privada.</small></div>
              <label className="invite-friends-search"><Search size={15}/><input value={inviteFriendQuery} onChange={(event) => setInviteFriendQuery(event.target.value)} placeholder="Buscar amigo" /></label>
              <div className="invite-friends-list">
                {friends.friends
                  .filter((entry) => {
                    const q = inviteFriendQuery.trim().toLowerCase();
                    return !q || `${entry.user.displayName} ${entry.user.username}`.toLowerCase().includes(q);
                  })
                  .slice(0, 40)
                  .map((entry) => {
                    const sent = inviteSentTo.has(entry.user.id);
                    const sending = inviteSendingTo === entry.user.id;
                    return <div className="invite-friend-row" key={entry.id}>
                      <Avatar user={entry.user} size="sm" status={onlineUserIds.has(entry.user.id) ? "online" : "offline"}/>
                      <div><strong>{entry.user.displayName}</strong><span>@{entry.user.username}</span></div>
                      <button type="button" className={sent ? "secondary-button invite-sent-button" : "primary-button"} disabled={!inviteCode || Boolean(inviteSendingTo) || sent} onClick={() => void sendInviteToFriend(entry.user)}>
                        {sent ? <><Check size={15}/> Enviado</> : sending ? "Enviando..." : <><Send size={15}/> Enviar convite</>}
                      </button>
                    </div>;
                  })}
                {friends.friends.length === 0 && <div className="invite-friends-empty">Adicione amigos no Ginga para mandar o convite direto pela conversa.</div>}
                {friends.friends.length > 0 && friends.friends.filter((entry) => {
                  const q = inviteFriendQuery.trim().toLowerCase();
                  return !q || `${entry.user.displayName} ${entry.user.username}`.toLowerCase().includes(q);
                }).length === 0 && <div className="invite-friends-empty">Nenhum amigo encontrado.</div>}
              </div>
            </section>
            <div className="invite-code-card">
              <span>LINK / CODIGO DO CONVITE</span>
              <div className="invite-code-row"><code>{inviteCode || "GERANDO..."}</code><button type="button" onClick={() => void copyInvite()} disabled={!inviteCode} aria-label="Copiar link do convite">{copied ? <Check size={18} /> : <Copy size={18} />}</button></div>
              <small>{copied ? "Link copiado para a area de transferencia." : "Quem abrir o convite vera a previa do servidor antes de entrar."}</small>
            </div>
            <div className="invite-modal-actions">
              <button type="button" className="secondary-button" onClick={() => { setShowInviteModal(false); setServerSettingsInitialTab("invites"); setShowServerSettings(true); }}>Configurar convites</button>
              <button type="button" className="primary-button" disabled={!inviteCode} onClick={() => void copyInvite()}>{copied ? <Check size={16}/> : <Link2 size={16}/>} {copied ? "Copiado" : "Copiar link"}</button>
            </div>
          </div>
        </Modal>
      )}

      {showUserSettings && <UserSettingsModal user={user} initialTab={userSettingsTab} socketConnected={socketConnected} onClose={() => setShowUserSettings(false)} onSessionUpdate={onSessionUpdate} />}
      {showServerSettings && selectedGuild && canOpenServerSettings && <ServerSettingsModal guild={selectedGuild} members={members} initialTab={serverSettingsInitialTab} onClose={() => { setShowServerSettings(false); setServerSettingsInitialTab(undefined); }} onGuildsRefresh={() => loadGuilds(selectedGuildId)} onMembersRefresh={() => loadMembers(selectedGuildId)} />}

      {selfPresenceMenu && <ContextMenu x={selfPresenceMenu.x} y={selfPresenceMenu.y} onClose={() => setSelfPresenceMenu(null)}>
        <div className="self-presence-menu-head"><Avatar user={user} size="sm" status={socketConnected ? presenceModeToAvatarStatus(presenceModes[user.id] ?? "ONLINE") : "offline"}/><div><strong>{user.displayName}</strong><span>@{user.username}</span></div></div>
        <div className="context-menu-separator"/>
        <div className="context-menu-label">SEU STATUS</div>
        {SELF_PRESENCE_OPTIONS.map((option) => <button type="button" key={option.mode} className={`self-presence-option ${selfPresencePreference === option.mode ? "context-role-assigned" : ""}`} disabled={selfPresenceBusy} onClick={() => void chooseOwnPresence(option.mode)}><i className={`self-presence-dot ${presenceModeToAvatarStatus(option.mode)}`}/><span className="context-menu-rich-label"><strong>{option.label}</strong><small>{option.detail}</small></span>{selfPresencePreference === option.mode && <Check size={15} className="context-menu-trailing"/>}</button>)}
        <div className="context-menu-separator"/>
        <button type="button" onClick={() => { setSelfPresenceMenu(null); setUserSettingsTab("profile"); setShowUserSettings(true); }}><UserRound size={15}/> Editar perfil</button>
        <button type="button" onClick={() => { setSelfPresenceMenu(null); setUserSettingsTab("account"); setShowUserSettings(true); }}><Settings size={15}/> Configuracoes</button>
      </ContextMenu>}

      {profileCard && <ProfileErrorBoundary key={`card:${profileCard.user.id}:${profileCard.guildId ?? "direct"}`} onClose={() => setProfileCard(null)}><UserProfileCard user={profileCard.user} currentUser={user} guildId={profileCard.guildId} online={profileCard.user.id === user.id || onlineUserIds.has(profileCard.user.id)} anchor={profileCard.anchor} role={profileCard.role} joinedAt={profileCard.joinedAt} topRole={profileCard.topRole} guildOwner={profileCard.guildOwner} onClose={() => setProfileCard(null)} onMessage={startConversation} onOpenProfile={(target) => openFullProfile(target, profileCard.guildId)} onEditProfile={() => { setUserSettingsTab("profile"); setShowUserSettings(true); }} onSocialRefresh={async () => { await Promise.all([loadFriends(), loadConversations()]); }} /></ProfileErrorBoundary>}
      {profileModal && <ProfileErrorBoundary key={`${profileModal.user.id}:${profileModal.guildId ?? "direct"}`} onClose={() => setProfileModal(null)}><UserProfileModal user={profileModal.user} currentUser={user} guildId={profileModal.guildId} topRole={profileModal.topRole} guildOwner={profileModal.guildOwner} online={profileModal.user.id === user.id || onlineUserIds.has(profileModal.user.id)} onClose={() => setProfileModal(null)} onMessage={startConversation} onSocialRefresh={async () => { await Promise.all([loadFriends(), loadConversations()]); }} /></ProfileErrorBoundary>}

      {voiceUserMenu && (() => {
        const voiceMenuGuild = guilds.find((guild) => guild.id === voiceUserMenu.guildId) ?? null;
        const voiceMenuMember = members.find((member) => member.user.id === voiceUserMenu.user.id) ?? null;
        const voiceMenuRoles = contextRolesByGuild[voiceUserMenu.guildId] ?? [];
        if (voiceUserMenu.page === "roles") return <ContextMenu x={voiceUserMenu.x} y={voiceUserMenu.y} onClose={() => setVoiceUserMenu(null)}>
          <button type="button" className="context-menu-back" onClick={() => setVoiceUserMenu({ ...voiceUserMenu, page: "root" })}><ChevronLeft size={15}/> Cargos de {voiceUserMenu.user.displayName}</button>
          <div className="context-menu-separator"/>
          <div className="context-menu-label">CARGOS PERSONALIZADOS</div>
          {contextRolesLoadingGuildId === voiceUserMenu.guildId && <div className="context-menu-note">Carregando cargos...</div>}
          {contextRolesLoadingGuildId !== voiceUserMenu.guildId && voiceMenuRoles.length === 0 && <div className="context-menu-note">Nenhum cargo personalizado criado neste servidor.</div>}
          {voiceMenuMember && voiceMenuRoles.map((role) => { const assigned = (voiceMenuMember.customRoles ?? []).some((item) => item.id === role.id); return <button type="button" key={role.id} className={assigned ? "context-role-assigned" : ""} disabled={role.managed || Boolean(contextRoleSavingId)} onClick={() => void setContextMemberCustomRole(voiceUserMenu.guildId, voiceMenuMember, role, !assigned)}><span className="context-role-dot" style={{ background: role.color }}/><span className="context-menu-rich-label"><strong>{role.icon ? `${role.icon} ` : ""}{role.name}</strong><small>{role.managed ? "Gerenciado por integracao" : assigned ? "Clique para remover" : "Clique para adicionar"}</small></span>{assigned ? <Check className="context-menu-trailing" size={15}/> : null}</button>; })}
          {!voiceMenuMember && <div className="context-menu-note">Atualize a lista de membros para gerenciar os cargos deste usuario.</div>}
          {voiceMenuGuild?.permissions.canManageRoles && <><div className="context-menu-separator"/><button type="button" onClick={() => { setVoiceUserMenu(null); setSelectedGuildId(voiceMenuGuild.id); setServerSettingsInitialTab("roles"); setShowServerSettings(true); }}><ShieldCheck size={15}/> Abrir configuracao de cargos</button></>}
        </ContextMenu>;
        return (
          <ContextMenu x={voiceUserMenu.x} y={voiceUserMenu.y} onClose={() => setVoiceUserMenu(null)}>
            <div className="user-context-menu-head">
              <Avatar user={voiceUserMenu.user} size="sm" status="online" />
              <div><strong>{voiceUserMenu.user.displayName}{voiceUserMenu.user.id === user.id ? " (voce)" : ""}</strong><span>@{voiceUserMenu.user.username} · conectado na voz</span></div>
            </div>
            <button type="button" onClick={() => { const target = voiceUserMenu.user; const guildId = voiceUserMenu.guildId; setVoiceUserMenu(null); openFullProfile(target, guildId); }}><UserRound size={15}/> Ver perfil</button>
            {voiceUserMenu.user.id !== user.id && <button type="button" onClick={() => { const id = voiceUserMenu.user.id; setVoiceUserMenu(null); void startConversation(id); }}><MessageCircle size={15}/> Conversar</button>}
            {voiceUserMenu.user.id !== user.id && <button type="button" onClick={() => { const id = voiceUserMenu.user.id; setVoiceUserMenu(null); void startDirectCallWithUser(id); }}><Phone size={15}/> Iniciar chamada</button>}
            {voiceUserMenu.user.id !== user.id && ![...friends.friends, ...friends.incoming, ...friends.outgoing].some((entry) => entry.user.id === voiceUserMenu.user.id) && <button type="button" onClick={() => { const target=voiceUserMenu.user; setVoiceUserMenu(null); void requestFriend(target).catch((caught)=>setToast(caught instanceof Error?caught.message:"Nao foi possivel adicionar amigo")); }}><UserPlus size={15}/> Adicionar amigo</button>}
            {voiceUserMenu.user.id !== user.id && <button type="button" onClick={() => { const target=voiceUserMenu.user; const muted=!localVoiceMuteState(target.id); setLocalVoiceMuteState(target.id, muted); setVoiceUserMenu(null); setToast(muted?"Usuario silenciado so para voce":"Audio local reativado"); }}><VolumeX size={15}/> {localVoiceMuteState(voiceUserMenu.user.id) ? "Ouvir novamente" : "Silenciar localmente"}</button>}
            {voiceUserMenu.user.id === user.id && <button type="button" onClick={() => { setVoiceUserMenu(null); setUserSettingsTab("voice"); setShowUserSettings(true); }}><Settings size={15}/> Configuracoes de voz</button>}
            {voiceUserMenu.user.id !== user.id && voiceMenuGuild && (voiceMenuGuild.permissions.canMoveMembers || voiceMenuGuild.permissions.canMuteMembers || voiceMenuGuild.permissions.canDeafenMembers) && <>
              <div className="context-menu-separator"/>
              <div className="context-menu-label">CONTROLE DE VOZ</div>
              {voiceMenuGuild.permissions.canMuteMembers && <button type="button" onClick={() => { const id=voiceUserMenu.user.id; const guildId=voiceUserMenu.guildId; const member=members.find((item)=>item.user.id===id); setVoiceUserMenu(null); void setServerVoiceModeration(id,{muted:!Boolean(member?.serverMuted)},guildId).catch((caught)=>setToast(caught instanceof Error?caught.message:"Nao foi possivel alterar o mute")); }}>{members.find((item)=>item.user.id===voiceUserMenu.user.id)?.serverMuted ? <Mic size={15}/> : <MicOff size={15}/>} {members.find((item)=>item.user.id===voiceUserMenu.user.id)?.serverMuted ? "Desmutar no servidor" : "Mutar no servidor"}</button>}
              {voiceMenuGuild.permissions.canDeafenMembers && <button type="button" onClick={() => { const id=voiceUserMenu.user.id; const guildId=voiceUserMenu.guildId; const member=members.find((item)=>item.user.id===id); setVoiceUserMenu(null); void setServerVoiceModeration(id,{deafened:!Boolean(member?.serverDeafened)},guildId).catch((caught)=>setToast(caught instanceof Error?caught.message:"Nao foi possivel alterar o ensurdecimento")); }}>{members.find((item)=>item.user.id===voiceUserMenu.user.id)?.serverDeafened ? <Volume2 size={15}/> : <Headphones size={15}/>} {members.find((item)=>item.user.id===voiceUserMenu.user.id)?.serverDeafened ? "Remover ensurdecimento" : "Ensurdecer no servidor"}</button>}
              {voiceMenuGuild.permissions.canMoveMembers && <button type="button" className="voice-disconnect-action" onClick={() => { const id = voiceUserMenu.user.id; const guildId = voiceUserMenu.guildId; setVoiceUserMenu(null); void disconnectVoiceParticipant(guildId, id).catch((caught) => setToast(caught instanceof Error ? caught.message : "Nao foi possivel desconectar")); }}><PhoneOff size={15}/> Desconectar da voz</button>}
              {voiceMenuGuild.permissions.canMoveMembers && <><div className="context-menu-label">MOVER PARA</div>
              {voiceMenuGuild.channels.filter((item) => item.type === "VOICE").map((target) => <button type="button" key={target.id} disabled={target.id === voiceUserMenu.channelId} onClick={() => { const id = voiceUserMenu.user.id; setVoiceUserMenu(null); void moveVoiceParticipant(id, target.id).catch((caught) => setToast(caught instanceof Error ? caught.message : "Nao foi possivel mover")); }}><Headphones size={15}/>{target.name}{target.id === voiceMenuGuild.afkChannelId ? " · AFK" : ""}</button>)}</>}
            </>}
            {voiceUserMenu.user.id !== user.id && voiceMenuGuild?.permissions.canManageNicknames && <button type="button" onClick={() => { const target=voiceUserMenu.user; const guildId=voiceUserMenu.guildId; const nickname=members.find((item)=>item.user.id===target.id)?.nickname??""; setVoiceUserMenu(null); openNicknameEditor(target,guildId,nickname); }}><Pencil size={15}/> Alterar apelido</button>}
            {voiceUserMenu.user.id !== user.id && voiceMenuGuild?.permissions.canManageRoles && <button type="button" onClick={() => { setVoiceUserMenu({ ...voiceUserMenu, page: "roles" }); void loadContextRoles(voiceMenuGuild.id).catch((caught) => setToast(caught instanceof Error ? caught.message : "Nao foi possivel carregar os cargos")); }}><ShieldCheck size={15}/> Cargos <ChevronRight className="context-menu-trailing" size={15}/></button>}
            {voiceUserMenu.user.id !== user.id && voiceMenuGuild && (voiceMenuGuild.permissions.canManageMembers || voiceMenuGuild.permissions.canKickMembers || voiceMenuGuild.permissions.canBanMembers) && <>
              <div className="context-menu-separator"/><div className="context-menu-label">MODERACAO DO SERVIDOR</div>
              {(voiceMenuGuild.permissions.canManageMembers || voiceMenuGuild.permissions.canKickMembers) && <button type="button" onClick={() => { const target = voiceUserMenu.user; const guildId = voiceUserMenu.guildId; setVoiceUserMenu(null); setVoiceTimeoutDuration(10); setVoiceTimeoutReason(""); setVoiceModerationTarget({ action: "timeout", user: target, guildId }); }}><Clock3 size={15}/> Aplicar timeout</button>}
              {voiceMenuGuild.permissions.canKickMembers && <button type="button" className="danger" onClick={() => { const target = voiceUserMenu.user; const guildId = voiceUserMenu.guildId; setVoiceUserMenu(null); setVoiceBanReason(""); setVoiceModerationTarget({ action: "kick", user: target, guildId }); }}><UserMinus size={15}/> Expulsar do servidor</button>}
              {voiceMenuGuild.permissions.canBanMembers && <button type="button" className="danger" onClick={() => { const target = voiceUserMenu.user; const guildId = voiceUserMenu.guildId; setVoiceUserMenu(null); setVoiceBanDuration("7D"); setVoiceBanReason(""); setVoiceBanDeleteMinutes(0); setVoiceModerationTarget({ action: "ban", user: target, guildId }); }}><Ban size={15}/> Banir</button>}
            </>}
            <div className="context-menu-separator" />
            <button type="button" onClick={() => { void copyTextToClipboard(`@${voiceUserMenu.user.username}`).then(() => setToast("Nome de usuario copiado")).catch(() => setToast("Nao foi possivel copiar")); setVoiceUserMenu(null); }}><Copy size={15}/> Copiar nome de usuario</button>
            {developerMode && <button type="button" onClick={() => { void copyTextToClipboard(voiceUserMenu.user.id).then(() => setToast("ID do usuario copiado")).catch(() => setToast("Nao foi possivel copiar")); setVoiceUserMenu(null); }}><Copy size={15}/> Copiar ID do usuario</button>}
          </ContextMenu>
        );
      })()}

      {nicknameEditTarget && (
        <Modal title={`Alterar apelido de ${nicknameEditTarget.user.displayName}`} onClose={() => { if (!nicknameBusy) setNicknameEditTarget(null); }} width="sm">
          <form className="form-stack" onSubmit={(event) => { event.preventDefault(); void saveMemberNickname(); }}>
            <p className="context-menu-note">O apelido vale apenas neste servidor. Deixe o campo vazio para voltar ao nome original.</p>
            <label>Apelido<input autoFocus maxLength={32} value={nicknameDraft} disabled={nicknameBusy} onChange={(event) => setNicknameDraft(event.target.value)} placeholder={nicknameEditTarget.user.displayName} /></label>
            <div className="modal-actions">
              <button type="button" className="secondary-button" disabled={nicknameBusy} onClick={() => setNicknameEditTarget(null)}>Cancelar</button>
              <button type="submit" className="primary-button" disabled={nicknameBusy}>{nicknameBusy ? "Salvando..." : nicknameDraft.trim() ? "Salvar apelido" : "Remover apelido"}</button>
            </div>
          </form>
        </Modal>
      )}

      {voiceModerationTarget && (
        <Modal
          title={voiceModerationTarget.action === "ban" ? `Banir ${voiceModerationTarget.user.displayName}` : voiceModerationTarget.action === "timeout" ? `Aplicar timeout em ${voiceModerationTarget.user.displayName}` : `Expulsar ${voiceModerationTarget.user.displayName}`}
          onClose={() => { if (!voiceModerationBusy) setVoiceModerationTarget(null); }}
          width="sm"
        >
          <div className="form-stack">
            <p className="context-menu-note">{voiceModerationTarget.action === "ban" ? "O usuario sera removido do servidor e impedido de retornar durante o periodo escolhido." : voiceModerationTarget.action === "timeout" ? "O usuario permanece no servidor, mas perde temporariamente o envio de mensagens e o acesso a voz." : "O usuario sera removido do servidor, mas podera entrar novamente com um novo convite."}</p>
            {voiceModerationTarget.action === "kick" && <label>Motivo<textarea rows={3} maxLength={500} value={voiceBanReason} disabled={voiceModerationBusy} onChange={(event) => setVoiceBanReason(event.target.value)} placeholder="Opcional, mas recomendado para auditoria"/></label>}
            {voiceModerationTarget.action === "ban" && <>
              <label>Duracao<select value={voiceBanDuration} disabled={voiceModerationBusy} onChange={(event) => setVoiceBanDuration(event.target.value as typeof voiceBanDuration)}><option value="1H">1 hora</option><option value="24H">24 horas</option><option value="7D">7 dias</option><option value="30D">30 dias</option><option value="PERMANENT">Permanente</option></select></label>
              <label>Excluir mensagens recentes<select value={voiceBanDeleteMinutes} disabled={voiceModerationBusy} onChange={(event) => setVoiceBanDeleteMinutes(Number(event.target.value))}><option value={0}>Nenhuma</option><option value={60}>Ultima hora</option><option value={360}>Ultimas 6 horas</option><option value={1440}>Ultimas 24 horas</option><option value={10080}>Ultimos 7 dias</option></select></label>
              <label>Motivo<textarea rows={3} maxLength={500} value={voiceBanReason} disabled={voiceModerationBusy} onChange={(event) => setVoiceBanReason(event.target.value)} placeholder="Opcional"/></label>
            </>}
            {voiceModerationTarget.action === "timeout" && <>
              <label>Duracao<select value={voiceTimeoutDuration} disabled={voiceModerationBusy} onChange={(event) => setVoiceTimeoutDuration(Number(event.target.value))}><option value={5}>5 minutos</option><option value={10}>10 minutos</option><option value={30}>30 minutos</option><option value={60}>1 hora</option><option value={360}>6 horas</option><option value={1440}>24 horas</option><option value={10080}>7 dias</option></select></label>
              <label>Motivo<textarea rows={3} maxLength={300} value={voiceTimeoutReason} disabled={voiceModerationBusy} onChange={(event) => setVoiceTimeoutReason(event.target.value)} placeholder="Opcional, mas recomendado"/></label>
            </>}
            <div className="modal-actions">
              <button type="button" className="secondary-button" disabled={voiceModerationBusy} onClick={() => setVoiceModerationTarget(null)}>Cancelar</button>
              <button type="button" className={voiceModerationTarget.action === "timeout" ? "primary-button" : "danger-button"} disabled={voiceModerationBusy} onClick={() => void confirmVoiceModeration()}>{voiceModerationTarget.action === "ban" ? <Ban size={16}/> : voiceModerationTarget.action === "timeout" ? <Clock3 size={16}/> : <UserMinus size={16}/>} {voiceModerationBusy ? "Aplicando..." : voiceModerationTarget.action === "ban" ? "Confirmar banimento" : voiceModerationTarget.action === "timeout" ? "Aplicar timeout" : "Expulsar usuario"}</button>
            </div>
          </div>
        </Modal>
      )}

      {musicBotMenu && (() => {
        const guild = guilds.find((item) => item.id === musicBotMenu.guildId);
        if (!guild) return null;
        const state = musicStates[guild.id];
        const canControlMusic = Boolean(guild.musicAllowMembers || guild.permissions.canManageBots || guild.permissions.canManageServer);
        return <ContextMenu x={musicBotMenu.x} y={musicBotMenu.y} onClose={() => setMusicBotMenu(null)}>
          <div className="user-context-menu-head music-bot-context-head"><span className="ginga-music-voice-avatar large"><Music2 size={16}/></span><div><strong>Ginga Music <em>BOT</em></strong><span>{state?.status === "PLAYING" ? "Tocando agora" : state?.queue.length ? "Fila pausada" : "Conectado na voz"}</span></div></div>
          <button type="button" onClick={() => { setSelectedGuildId(guild.id); setSelectedChannelId(musicBotMenu.channelId); setSection("space"); setMusicBotMenu(null); }}><Music2 size={15}/> Abrir player de musica</button>
          {canControlMusic && <>
            <div className="context-menu-separator"/><div className="context-menu-label">MOVER GINGA MUSIC</div>
            {guild.channels.filter((item) => item.type === "VOICE").map((target) => <button type="button" key={target.id} disabled={target.id === musicBotMenu.channelId} onClick={() => { setMusicBotMenu(null); void moveMusicBot(guild.id, target.id).catch((caught) => setToast(caught instanceof Error ? caught.message : "Nao foi possivel mover o Ginga Music")); }}><Headphones size={15}/>{target.name}{target.id === guild.afkChannelId ? " · AFK" : ""}</button>)}
            <button type="button" className="danger" onClick={() => { setMusicBotMenu(null); void disconnectMusicBot(guild.id).catch((caught) => setToast(caught instanceof Error ? caught.message : "Nao foi possivel desconectar o Ginga Music")); }}><PhoneOff size={15}/> Desconectar da voz</button>
          </>}
          {(guild.permissions.canManageBots || guild.permissions.canManageServer) && <><div className="context-menu-separator"/><button type="button" onClick={() => { setMusicBotMenu(null); openServerSettingsForGuild(guild, "music"); }}><Settings size={15}/> Configurar Ginga Music</button></>}
          {developerMode && <><div className="context-menu-separator"/><button type="button" onClick={() => { void copyIdentifier("ID do bot", `gbot:${guild.id}:music`); setMusicBotMenu(null); }}><Copy size={15}/> Copiar ID do bot</button></>}
        </ContextMenu>;
      })()}

      {showGlobalSearch && selectedGuild && <GlobalSearch guild={selectedGuild} members={members} onClose={()=>setShowGlobalSearch(false)} onOpenMessage={(channelId,messageId)=>{try{sessionStorage.setItem("ginga.pendingMessageJump",JSON.stringify({channelId,messageId,at:Date.now()}));}catch{}setSection("space");setSelectedGuildId(selectedGuild.id);setSelectedChannelId(channelId);setShowGlobalSearch(false);window.setTimeout(()=>window.dispatchEvent(new CustomEvent("ginga:jump-message",{detail:{channelId,messageId}})),160);}} />}

      {quickOpen && <div className="command-palette-backdrop" onMouseDown={() => setQuickOpen(false)}><div className="command-palette" onMouseDown={(e)=>e.stopPropagation()}><div className="command-search"><Command size={18}/><input autoFocus value={quickQuery} onChange={e=>setQuickQuery(e.target.value)} placeholder="Ir para canal, conversa ou recurso..."/><kbd>ESC</kbd></div><div className="command-results">{quickItems().map(item=><button key={item.id} onClick={()=>{item.run();setQuickOpen(false);}}><strong>{item.label}</strong><span>{item.detail}</span></button>)}</div></div></div>}

      {guildMenu && (() => {
        const preferences = loadGuildPreferences(guildMenu.guild.id);
        const notificationMode = guildNotificationMode(preferences);
        const hasUnread = guildMenu.guild.channels.some((channel) => unreadChannels[channel.id]);
        if (guildMenu.page === "notifications") {
          return <ContextMenu x={guildMenu.x} y={guildMenu.y} onClose={() => setGuildMenu(null)}>
            <button className="context-menu-back" onClick={() => setGuildMenu({ ...guildMenu, page: "root" })}><ChevronLeft size={15}/> Notificacoes do servidor</button>
            <div className="context-menu-separator"/>
            <div className="context-menu-label">MODO DE NOTIFICACAO</div>
            <button onClick={() => { setGuildNotificationMode(guildMenu.guild.id, "ALL"); setGuildPreferencesRevision((value) => value + 1); setToast("Todas as notificacoes ativadas"); setGuildMenu(null); }}>
              <Bell size={15}/><span className="context-menu-rich-label"><strong>Todas as mensagens</strong><small>Mensagens, mencoes e sons do servidor</small></span>{notificationMode === "ALL" ? <Check className="context-menu-trailing" size={15}/> : null}
            </button>
            <button onClick={() => { setGuildNotificationMode(guildMenu.guild.id, "MENTIONS"); setGuildPreferencesRevision((value) => value + 1); setToast("Somente mencoes ativado"); setGuildMenu(null); }}>
              <MessageCircle size={15}/><span className="context-menu-rich-label"><strong>Somente mencoes</strong><small>Notifica e toca som apenas quando chamarem voce</small></span>{notificationMode === "MENTIONS" ? <Check className="context-menu-trailing" size={15}/> : null}
            </button>
            <button onClick={() => { setGuildNotificationMode(guildMenu.guild.id, "SILENT"); setGuildPreferencesRevision((value) => value + 1); setToast(`${guildMenu.guild.name} esta no silencioso`); setGuildMenu(null); }}>
              <BellOff size={15}/><span className="context-menu-rich-label"><strong>Silencioso</strong><small>Sem som, popup do Windows ou badge de atencao</small></span>{notificationMode === "SILENT" ? <Check className="context-menu-trailing" size={15}/> : null}
            </button>
            <div className="context-menu-separator"/>
            <div className="context-menu-label">SILENCIAR TEMPORARIAMENTE</div>
            {([["1 hora", 60*60_000],["8 horas",8*60*60_000],["24 horas",24*60*60_000]] as const).map(([label,duration]) => <button key={label} onClick={() => { muteGuildFor(guildMenu.guild.id,duration); setGuildPreferencesRevision(v=>v+1); setToast(`${guildMenu.guild.name} silenciado por ${label}`); setGuildMenu(null); }}><Clock3 size={15}/>{label}</button>)}
            {preferences.muteUntil && preferences.muteUntil > Date.now() ? <button onClick={() => { unmuteGuild(guildMenu.guild.id); setGuildPreferencesRevision(v=>v+1); setToast("Silencio temporario removido"); setGuildMenu(null); }}><Bell size={15}/> Reativar agora</button> : null}
            <div className="context-menu-separator"/>
            <button onClick={() => { updateLocalGuildPreferences(guildMenu.guild.id, { hideMutedChannels: !preferences.hideMutedChannels }); setGuildMenu(null); }}><EyeOff size={15}/> Ocultar canais silenciados {preferences.hideMutedChannels ? <Check className="context-menu-trailing" size={15}/> : null}</button>
            <div className="context-menu-note">O modo Silencioso vale so para este servidor e fica salvo neste dispositivo. As mensagens continuam disponiveis quando voce abrir o Ginga.</div>
          </ContextMenu>;
        }
        return <ContextMenu x={guildMenu.x} y={guildMenu.y} onClose={() => setGuildMenu(null)}>
          <div className="context-menu-heading server-context-heading">{guildMenu.guild.name}</div>
          <button disabled={!hasUnread} onClick={() => { markGuildRead(guildMenu.guild); setGuildMenu(null); }}><Check size={15}/> Marcar servidor como lido</button>
          {guildMenu.guild.permissions.canCreateInvites && <button onClick={() => { const target = guildMenu.guild; setSelectedGuildId(target.id); setSection("space"); setGuildMenu(null); void openInvite(target); }}><UserPlus size={15}/> Convidar pessoas</button>}
          <div className="context-menu-separator"/>
          <button className={notificationMode === "SILENT" ? "context-menu-active" : ""} onClick={() => setGuildMenu({ ...guildMenu, page: "notifications" })}>
            {notificationMode === "SILENT" ? <BellOff size={15}/> : notificationMode === "MENTIONS" ? <MessageCircle size={15}/> : <Bell size={15}/>}<span className="context-menu-rich-label"><strong>Notificacoes</strong><small>{notificationMode === "SILENT" ? "Silencioso" : notificationMode === "MENTIONS" ? "Somente mencoes" : "Todas as mensagens"}</small></span><ChevronRight className="context-menu-trailing" size={15}/>
          </button>
          <div className="context-menu-separator"/>
          {guildMenu.guild.permissions.canManageServer && <button onClick={() => { const target = guildMenu.guild; setGuildMenu(null); openServerSettingsForGuild(target); }}><Settings size={15}/> Configuracoes do servidor</button>}
          <button onClick={() => { setGuildMenu(null); setUserSettingsTab("privacy"); setShowUserSettings(true); }}><ShieldCheck size={15}/> Configuracoes de privacidade</button>
          {guildMenu.guild.permissions.canManageEvents && <button onClick={() => { const target = guildMenu.guild; setGuildMenu(null); openEventCreator(target); }}><CalendarDays size={15}/> Criar evento</button>}
          {(guildMenu.guild.permissions.canManageBots || guildMenu.guild.permissions.canManageWebhooks) && <button onClick={() => { const target = guildMenu.guild; setGuildMenu(null); openServerSettingsForGuild(target, "integrations"); }}><Code2 size={15}/> Aplicativos e bots</button>}
          {folderForGuild(guildMenu.guild.id) && <button onClick={() => { removeGuildFromFolder(guildMenu.guild.id); setGuildMenu(null); }}><FolderInput size={15}/> Remover da pasta</button>}
          {guildMenu.guild.ownerId !== user.id && <><div className="context-menu-separator"/><button className="danger" onClick={() => { const target = guildMenu.guild; setGuildMenu(null); void leaveGuild(target).catch((caught) => setToast(caught instanceof Error ? caught.message : "Nao foi possivel sair do servidor")); }}><LogOut size={15}/> Sair do servidor</button></>}
          {developerMode && <><div className="context-menu-separator"/><button onClick={() => { void copyIdentifier("ID do servidor", guildMenu.guild.id); setGuildMenu(null); }}><Copy size={15}/> Copiar ID do servidor</button></>}
        </ContextMenu>;
      })()}


      {memberMenu && (() => {
        const target = memberMenu.member.user;
        const guild = selectedGuild;
        const voiceEntry = guild ? Object.entries(voicePresence).find(([, users]) => users.some((entry) => entry.id === target.id)) : undefined;
        const voiceChannelId = voiceEntry?.[0] ?? "";
        const hasRelationship = [...friends.friends, ...friends.incoming, ...friends.outgoing].some((entry) => entry.user.id === target.id);
        const memberRoles = guild ? (contextRolesByGuild[guild.id] ?? []) : [];
        if (memberMenu.page === "roles" && guild) return <ContextMenu x={memberMenu.x} y={memberMenu.y} onClose={() => setMemberMenu(null)}>
          <button type="button" className="context-menu-back" onClick={() => setMemberMenu({ ...memberMenu, page: "root" })}><ChevronLeft size={15}/> Cargos de {memberMenu.member.nickname || target.displayName}</button>
          <div className="context-menu-separator"/>
          <div className="context-menu-label">CARGOS PERSONALIZADOS</div>
          {contextRolesLoadingGuildId === guild.id && <div className="context-menu-note">Carregando cargos...</div>}
          {contextRolesLoadingGuildId !== guild.id && memberRoles.length === 0 && <div className="context-menu-note">Nenhum cargo personalizado criado neste servidor.</div>}
          {memberRoles.map((role) => { const assigned = (memberMenu.member.customRoles ?? []).some((item) => item.id === role.id); return <button type="button" key={role.id} className={assigned ? "context-role-assigned" : ""} disabled={role.managed || Boolean(contextRoleSavingId)} onClick={() => void setContextMemberCustomRole(guild.id, memberMenu.member, role, !assigned)}><span className="context-role-dot" style={{ background: role.color }}/><span className="context-menu-rich-label"><strong>{role.icon ? `${role.icon} ` : ""}{role.name}</strong><small>{role.managed ? "Gerenciado por integracao" : assigned ? "Clique para remover" : "Clique para adicionar"}</small></span>{assigned ? <Check className="context-menu-trailing" size={15}/> : null}</button>; })}
          <div className="context-menu-separator"/><button type="button" onClick={() => { setMemberMenu(null); setServerSettingsInitialTab("roles"); setShowServerSettings(true); }}><ShieldCheck size={15}/> Abrir configuracao de cargos</button>
        </ContextMenu>;
        return <ContextMenu x={memberMenu.x} y={memberMenu.y} onClose={() => setMemberMenu(null)}>
          <div className="user-context-menu-head"><Avatar user={target} size="sm" status={onlineUserIds.has(target.id) || target.id === user.id ? "online" : "offline"}/><div><strong>{memberMenu.member.nickname || target.displayName}</strong><span>@{target.username}{memberMenu.member.nickname ? ` · ${target.displayName}` : ""}</span></div></div>
          <button onClick={() => { setMemberMenu(null); openFullProfile(target, selectedGuildId); }}><UserRound size={15}/> Ver perfil</button>
          {target.id !== user.id && <button onClick={() => { setMemberMenu(null); void startConversation(target.id); }}><MessageCircle size={15}/> Mensagem</button>}
          {target.id !== user.id && <button onClick={() => { setMemberMenu(null); void startDirectCallWithUser(target.id); }}><Phone size={15}/> Iniciar chamada</button>}
          {target.id !== user.id && !hasRelationship && <button onClick={() => { setMemberMenu(null); void requestFriend(target).catch((caught)=>setToast(caught instanceof Error?caught.message:"Nao foi possivel adicionar amigo")); }}><UserPlus size={15}/> Adicionar amigo</button>}
          {target.id !== user.id && voiceChannelId && <button onClick={() => { const muted=!localVoiceMuteState(target.id); setLocalVoiceMuteState(target.id,muted); setMemberMenu(null); setToast(muted?"Usuario silenciado so para voce":"Audio local reativado"); }}><VolumeX size={15}/> {localVoiceMuteState(target.id)?"Ouvir novamente":"Silenciar localmente"}</button>}
          {target.id !== user.id && guild?.permissions.canManageNicknames && <button onClick={() => { setMemberMenu(null); openNicknameEditor(target,guild.id,memberMenu.member.nickname??""); }}><Pencil size={15}/> Alterar apelido</button>}
          {target.id !== user.id && guild?.permissions.canManageRoles && <button onClick={() => { setMemberMenu({ ...memberMenu, page: "roles" }); void loadContextRoles(guild.id).catch((caught) => setToast(caught instanceof Error ? caught.message : "Nao foi possivel carregar os cargos")); }}><ShieldCheck size={15}/> Cargos <ChevronRight className="context-menu-trailing" size={15}/></button>}
          {target.id !== user.id && voiceChannelId && guild && <><div className="context-menu-separator"/><div className="context-menu-label">CONTROLE DE VOZ</div>
            {guild.permissions.canMuteMembers && <button onClick={() => { setMemberMenu(null); void setServerVoiceModeration(target.id,{muted:!Boolean(memberMenu.member.serverMuted)},guild.id).catch((caught)=>setToast(caught instanceof Error?caught.message:"Nao foi possivel alterar o mute")); }}>{memberMenu.member.serverMuted?<Mic size={15}/>:<MicOff size={15}/>} {memberMenu.member.serverMuted?"Desmutar no servidor":"Mutar no servidor"}</button>}
            {guild.permissions.canDeafenMembers && <button onClick={() => { setMemberMenu(null); void setServerVoiceModeration(target.id,{deafened:!Boolean(memberMenu.member.serverDeafened)},guild.id).catch((caught)=>setToast(caught instanceof Error?caught.message:"Nao foi possivel alterar o ensurdecimento")); }}>{memberMenu.member.serverDeafened?<Volume2 size={15}/>:<Headphones size={15}/>} {memberMenu.member.serverDeafened?"Remover ensurdecimento":"Ensurdecer no servidor"}</button>}
            {guild.permissions.canMoveMembers && <button className="voice-disconnect-action" onClick={() => { setMemberMenu(null); void disconnectVoiceParticipant(guild.id,target.id).catch((caught)=>setToast(caught instanceof Error?caught.message:"Nao foi possivel desconectar")); }}><PhoneOff size={15}/> Desconectar da voz</button>}
            {guild.permissions.canMoveMembers && <><div className="context-menu-label">MOVER PARA</div>{guild.channels.filter((item)=>item.type==="VOICE").map((room)=><button key={room.id} disabled={room.id===voiceChannelId} onClick={()=>{setMemberMenu(null);void moveVoiceParticipant(target.id,room.id).catch((caught)=>setToast(caught instanceof Error?caught.message:"Nao foi possivel mover"));}}><Headphones size={15}/>{room.name}</button>)}</>}
          </>}
          {target.id !== user.id && guild && (guild.permissions.canManageMembers || guild.permissions.canKickMembers || guild.permissions.canBanMembers) && <><div className="context-menu-separator"/><div className="context-menu-label">MODERACAO</div>
            {(guild.permissions.canManageMembers||guild.permissions.canKickMembers)&&<button onClick={()=>{setMemberMenu(null);setVoiceTimeoutDuration(10);setVoiceTimeoutReason("");setVoiceModerationTarget({action:"timeout",user:target,guildId:guild.id});}}><Clock3 size={15}/> Aplicar timeout</button>}
            {guild.permissions.canKickMembers&&<button className="danger" onClick={()=>{setMemberMenu(null);setVoiceBanReason("");setVoiceModerationTarget({action:"kick",user:target,guildId:guild.id});}}><UserMinus size={15}/> Expulsar do servidor</button>}
            {guild.permissions.canBanMembers&&<button className="danger" onClick={()=>{setMemberMenu(null);setVoiceBanDuration("7D");setVoiceBanReason("");setVoiceBanDeleteMinutes(0);setVoiceModerationTarget({action:"ban",user:target,guildId:guild.id});}}><Ban size={15}/> Banir</button>}
          </>}
          <div className="context-menu-separator"/><button onClick={() => { void copyTextToClipboard(`@${target.username}`); setMemberMenu(null); }}><Copy size={15}/> Copiar nome de usuario</button>
          {developerMode && <button onClick={() => { void copyIdentifier("ID do usuario", target.id); setMemberMenu(null); }}><Copy size={15}/> Copiar ID do usuario</button>}
        </ContextMenu>;
      })()}

      {directMenu && <ContextMenu x={directMenu.x} y={directMenu.y} onClose={() => setDirectMenu(null)}>
        <div className="user-context-menu-head"><Avatar user={directMenu.conversation.otherUser} size="sm" status={onlineUserIds.has(directMenu.conversation.otherUser.id) ? "online" : "offline"}/><div><strong>{directMenu.conversation.otherUser.displayName}</strong><span>@{directMenu.conversation.otherUser.username}</span></div></div>
        {unreadDirect[directMenu.conversation.id] && <button onClick={() => { markDirectRead(directMenu.conversation.id); setDirectMenu(null); }}><Check size={15}/> Marcar como lida</button>}
        <button onClick={() => { const target = directMenu.conversation.otherUser; setDirectMenu(null); openFullProfile(target); }}><UserRound size={15}/> Ver perfil</button>
        <button onClick={() => { const id = directMenu.conversation.otherUser.id; setDirectMenu(null); void startDirectCallWithUser(id); }}><Phone size={15}/> Iniciar chamada</button>
        {developerMode && <><div className="context-menu-separator"/>
          <button onClick={() => { void copyIdentifier("ID do usuario", directMenu.conversation.otherUser.id); setDirectMenu(null); }}><Copy size={15}/> Copiar ID do usuario</button>
          <button onClick={() => { void copyIdentifier("ID da conversa", directMenu.conversation.id); setDirectMenu(null); }}><Copy size={15}/> Copiar ID da conversa</button>
        </>}
      </ContextMenu>}

      {folderMenu && (() => {
        const folder = serverFolders.find((item) => item.id === folderMenu.folderId);
        if (!folder) return null;
        return <ContextMenu x={folderMenu.x} y={folderMenu.y} onClose={() => setFolderMenu(null)}>
          <div className="context-menu-heading">{folder.name}</div>
          <button onClick={async () => { const name = (await gingaPrompt("Informe o novo nome da pasta.", folder.name, { title: "Renomear pasta", confirmLabel: "Salvar" }))?.trim(); if (name) updateFolder(folder.id, { name: name.slice(0,32) }); setFolderMenu(null); }}><Pencil size={15}/> Renomear pasta</button>
          <div className="rail-folder-color-picker">{SERVER_FOLDER_COLORS.map((color) => <button key={color} aria-label={`Cor ${color}`} style={{ background: color }} onClick={() => { updateFolder(folder.id, { color }); setFolderMenu(null); }} />)}</div>
          <button className="danger" onClick={() => deleteFolder(folder.id)}><Trash2 size={15}/> Desfazer pasta</button>
        </ContextMenu>;
      })()}
      {folderGuildMenu && <ContextMenu x={folderGuildMenu.x} y={folderGuildMenu.y} onClose={() => setFolderGuildMenu(null)}><button onClick={() => removeGuildFromFolder(folderGuildMenu.guildId)}><FolderInput size={15}/> Remover da pasta</button></ContextMenu>}
      {channelMenu && selectedGuild && (() => {
        const channelMuted = Boolean(selectedGuildPreferences && isChannelMuted(selectedGuildPreferences, channelMenu.channel.id));
        if (channelMenu.page === "mute-duration") return <ContextMenu x={channelMenu.x} y={channelMenu.y} onClose={() => setChannelMenu(null)}><button className="context-menu-back" onClick={()=>setChannelMenu({...channelMenu,page:"root"})}><ChevronLeft size={15}/> Silenciar #{channelMenu.channel.name}</button><div className="context-menu-separator"/>{([["1 hora",60*60_000],["8 horas",8*60*60_000],["24 horas",24*60*60_000]] as const).map(([label,duration])=><button key={label} onClick={()=>{muteChannelFor(selectedGuild.id,channelMenu.channel.id,duration);setGuildPreferencesRevision(v=>v+1);setToast(`#${channelMenu.channel.name} silenciado por ${label}`);setChannelMenu(null)}}><Clock3 size={15}/>{label}</button>)}<button onClick={()=>{muteChannelFor(selectedGuild.id,channelMenu.channel.id,null);setGuildPreferencesRevision(v=>v+1);setToast("Canal silenciado ate reativar");setChannelMenu(null)}}><BellOff size={15}/> Ate eu reativar</button></ContextMenu>;
        return <ContextMenu x={channelMenu.x} y={channelMenu.y} onClose={() => setChannelMenu(null)}>
        {unreadChannels[channelMenu.channel.id] ? <button onClick={() => { markChannelRead(channelMenu.channel.id); setChannelMenu(null); }}><Check size={15}/> Marcar como lido</button> : null}
        {channelMuted ? <button onClick={()=>{unmuteChannel(selectedGuild.id,channelMenu.channel.id);setGuildPreferencesRevision(v=>v+1);setToast("Som do canal reativado");setChannelMenu(null)}}><Bell size={15}/> Ativar som do canal</button> : <button onClick={()=>setChannelMenu({...channelMenu,page:"mute-duration"})}><BellOff size={15}/> Silenciar canal <ChevronRight className="context-menu-trailing" size={15}/></button>}
        {canManageChannels && <><div className="context-menu-separator"/><button onClick={() => void renameChannelQuick(channelMenu.channel)}><Pencil size={15} /> Editar canal</button></>}
        {canManageChannels && <button onClick={() => void duplicateChannelQuick(channelMenu.channel)}><Copy size={15} /> Duplicar canal</button>}
        {canManageChannels && ["TEXT","ANNOUNCEMENT","FORUM","EVENT"].includes(channelMenu.channel.type) && <button onClick={() => void configureSlowModeQuick(channelMenu.channel)}><Clock3 size={15}/> Modo lento <span className="context-menu-trailing">{channelMenu.channel.slowModeSeconds ? `${channelMenu.channel.slowModeSeconds}s` : "OFF"}</span></button>}
        {selectedGuild.permissions.canManageMessages && ["TEXT","ANNOUNCEMENT","FORUM","EVENT"].includes(channelMenu.channel.type) && <button className="danger-soft" onClick={() => void clearChannelMessagesQuick(channelMenu.channel)}><Trash2 size={15}/> Limpar mensagens</button>}
        {canManageChannelPermissions && <button onClick={() => { setChannelMenu(null); setServerSettingsInitialTab("roles"); setShowServerSettings(true); }}><ShieldCheck size={15}/> Permissoes</button>}
        {canManageChannels && channelMenu.channel.categoryId && <button onClick={() => void setChannelPermissionInheritance(channelMenu.channel, !channelMenu.channel.syncPermissionsWithCategory)}><Link2 size={15}/> {channelMenu.channel.syncPermissionsWithCategory ? "Desvincular da categoria" : "Sincronizar com a categoria"}<span className="context-menu-trailing">{channelMenu.channel.syncPermissionsWithCategory ? "SIM" : "NAO"}</span></button>}
        {canManageChannels && <><div className="context-menu-label">MOVER PARA</div>
        {orderedCategories.map((category) => <button key={category.id} disabled={channelMenu.channel.categoryId === category.id} onClick={() => void moveChannelToCategory(channelMenu.channel, category.id)}><FolderInput size={15} /> {category.name}</button>)}
        <button disabled={!channelMenu.channel.categoryId} onClick={() => void moveChannelToCategory(channelMenu.channel, null)}><FolderInput size={15} /> Sem categoria</button></>}
        {developerMode && <><div className="context-menu-separator" /><button onClick={() => { void copyIdentifier("ID do canal", channelMenu.channel.id); setChannelMenu(null); }}><Copy size={15}/> Copiar ID do canal</button></>}
        {canManageChannels && <><div className="context-menu-separator"/><button className="danger" onClick={() => void deleteChannelQuick(channelMenu.channel)}><Trash2 size={15} /> Excluir canal</button></>}
      </ContextMenu>; })()}

      {categoryMenu && <ContextMenu x={categoryMenu.x} y={categoryMenu.y} onClose={() => setCategoryMenu(null)}>
        {canManageChannels && <button onClick={() => void renameCategoryQuick(categoryMenu.category)}><Pencil size={15} /> Editar categoria</button>}
        {canManageChannels && <button onClick={() => void duplicateCategoryQuick(categoryMenu.category)}><Copy size={15} /> Duplicar categoria</button>}
        {canManageChannelPermissions && <button onClick={() => { setCategoryMenu(null); setServerSettingsInitialTab("roles"); setShowServerSettings(true); }}><ShieldCheck size={15}/> Permissoes da categoria</button>}
        {developerMode && <button onClick={() => { void copyIdentifier("ID da categoria", categoryMenu.category.id); setCategoryMenu(null); }}><Copy size={15}/> Copiar ID da categoria</button>}
        {canManageChannels && <button className="danger" onClick={() => void deleteCategoryQuick(categoryMenu.category)}><Trash2 size={15} /> Excluir categoria</button>}
      </ContextMenu>}

      {error && <div className="global-alert" onClick={() => setError("")}>{error}</div>}
      {toast && <div className={`toast ${toastTone}`} role="status" aria-live="polite">{toastTone === "error" ? <TriangleAlert size={17} /> : <Check size={17} />} {toast}</div>}
    </main>
  );
}
