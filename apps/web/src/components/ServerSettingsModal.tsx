import { useEffect, useMemo, useState, type CSSProperties, type FormEvent, type ReactNode } from "react";
import {
  BadgeCheck,
  Ban,
  BarChart3,
  Bot,
  CalendarDays,
  Camera,
  Clock3,
  Copy,
  Download,
  Hash,
  Headphones,
  KeyRound,
  Link2,
  Megaphone,
  MessageSquareText,
  MicOff,
  Music2,
  Pencil,
  RefreshCw,
  Save,
  ScrollText,
  Settings2,
  ShieldAlert,
  ShieldCheck,
  Trash2,
  Upload,
  UserMinus,
  Users,
  VolumeX,
  Webhook
} from "lucide-react";
import { api } from "../lib/api";
import { friendlyWebhookError } from "../lib/webhookErrors";
import { copyTextToClipboard } from "../lib/clipboard";
import { builtinGuildRoleId, useDeveloperMode } from "../lib/developerMode";
import { imageFileToSquareWebp, imageFileToWideWebp } from "../lib/imageUpload";
import type {
  Guild,
  GuildAuditLog,
  GuildBan,
  GuildMember,
  GuildRole,
  GuildPermissions,
  GuildRolePermission,
  GuildStructure,
  InviteSummary,
  ManagedChannel,
  MusicPayload,
  CustomRole,
  DeveloperApplication,
  WebhookItem
} from "../types";
import { Avatar } from "./Avatar";
import { CustomRolesPanel } from "./CustomRolesPanel";
import { Modal } from "./Modal";
import { SettingsShell } from "./SettingsShell";

import { gingaConfirm } from "../lib/dialogs";
export type ServerSettingsTab = "overview" | "community" | "members" | "roles" | "channels" | "integrations" | "music" | "security" | "automod" | "insights" | "templates" | "invites" | "bans" | "audit";
type PermissionKey = keyof Omit<GuildRolePermission, "id" | "guildId" | "role">;
type BanDuration = "PERMANENT" | "1H" | "24H" | "7D" | "30D";

interface PermissionPreview {
  membership: { role: GuildRole };
  permissions: GuildPermissions;
  customRoles: CustomRole[];
  visibleChannels: Array<{ id: string; name: string; type: ManagedChannel["type"] }>;
}
interface UserPermissionOverride { canView:boolean|null; canSendMessages:boolean|null; canConnect:boolean|null; }
const emptyUserPermissionOverride:UserPermissionOverride={canView:null,canSendMessages:null,canConnect:null};


interface SecurityOverview {
  score: number;
  level: "FORTE" | "ATENCAO" | "RISCO";
  checks: Array<{ id: string; status: "PASS" | "WARN" | "CRITICAL"; title: string; detail: string; action?: string }>;
  metrics: { memberCount: number; enabledAutoModRules: number; activeUnlimitedInvites: number; bots: number; webhooks: number; privilegedMembers: number; communityEnabled: boolean; lockdownEnabled: boolean };
  lockdown: { enabled: boolean; reason: string; updatedAt: string | null };
}

interface ServerSettingsModalProps {
  guild: Guild;
  members: GuildMember[];
  onClose: () => void;
  onGuildsRefresh: () => Promise<void>;
  onMembersRefresh: () => Promise<void>;
  initialTab?: ServerSettingsTab;
}

const roleLabel: Record<GuildRole, string> = {
  OWNER: "Proprietario",
  ADMIN: "Administrador",
  MODERATOR: "Moderador",
  MEMBER: "Membro"
};

const roleDescription: Record<GuildRole, string> = {
  OWNER: "Controle total do espaco e da estrutura.",
  ADMIN: "Administracao completa, abaixo apenas do proprietario.",
  MODERATOR: "Moderacao e operacao conforme as permissoes configuradas.",
  MEMBER: "Acesso padrao definido pelos cargos, categorias e canais."
};

const guildPermissionLabels: Array<{ key: PermissionKey; title: string; description: string }> = [
  { key: "canManageServer", title: "Gerenciar servidor", description: "Alterar nome, descricao e configuracoes gerais." },
  { key: "canManageChannels", title: "Gerenciar canais", description: "Criar, editar, mover e excluir categorias e canais." },
  { key: "canManageRoles", title: "Gerenciar cargos", description: "Alterar permissoes de Moderadores e Membros." },
  { key: "canManageMessages", title: "Moderar mensagens", description: "Permite acoes de moderacao sobre mensagens." },
  { key: "canManageMembers", title: "Gerenciar membros", description: "Permissoes administrativas gerais sobre membros." },
  { key: "canKickMembers", title: "Expulsar membros", description: "Remove membros com cargo inferior ao do moderador." },
  { key: "canMoveMembers", title: "Mover membros", description: "Move membros entre salas de voz respeitando a hierarquia." },
  { key: "canMuteMembers", title: "Mutar membros", description: "Forca o microfone de membros a ficar desativado nas salas de voz." },
  { key: "canDeafenMembers", title: "Ensurdecer membros", description: "Impede membros de falar e ouvir nas salas de voz." },
  { key: "canManageNicknames", title: "Gerenciar apelidos", description: "Altera e remove apelidos de membros neste servidor." },
  { key: "canBanMembers", title: "Banir membros", description: "Aplica ban temporario ou permanente e gerencia banidos." },
  { key: "canViewAuditLog", title: "Ver auditoria", description: "Consulta a trilha de alteracoes e moderacao do espaco." },
  { key: "canCreateInvites", title: "Criar convites", description: "Gera novos codigos de convite." },
  { key: "canManageInvites", title: "Gerenciar convites", description: "Lista e revoga convites existentes." },
  { key: "canManageWebhooks", title: "Gerenciar webhooks", description: "Autoriza gerenciamento de webhooks por integracoes aprovadas." },
  { key: "canManageBots", title: "Gerenciar bots", description: "Permite instalar/remover aplicativos e bots do servidor." },
  { key: "canManageEvents", title: "Gerenciar eventos", description: "Criar, editar e cancelar eventos do servidor." },
  { key: "canManageForums", title: "Gerenciar foruns", description: "Moderar topicos, tags e organizacao de canais Forum." },
  { key: "canManageAutoMod", title: "Gerenciar AutoMod", description: "Criar e alterar regras automaticas de protecao." },
  { key: "canPinMessages", title: "Fixar mensagens", description: "Fixar e desafixar mensagens importantes." },
  { key: "canScheduleMessages", title: "Agendar mensagens", description: "Criar mensagens para envio futuro." },
  { key: "canMentionEveryone", title: "Mencionar todos", description: "Usar @todos em canais permitidos." },
  { key: "canShareScreen", title: "Compartilhar tela", description: "Publicar compartilhamento de tela nas salas de voz." },
  { key: "canUseVideo", title: "Usar camera", description: "Publicar video nas salas de voz." }
];

function channelTypeLabel(type: ManagedChannel["type"]) {
  switch (type) {
    case "VOICE": return "Sala de voz";
    case "ANNOUNCEMENT": return "Anuncios";
    case "FORUM": return "Forum";
    case "EVENT": return "Eventos";
    default: return "Texto";
  }
}

function channelTypeIcon(type: ManagedChannel["type"]) {
  switch (type) {
    case "VOICE": return <Headphones size={18} />;
    case "ANNOUNCEMENT": return <Megaphone size={18} />;
    case "FORUM": return <MessageSquareText size={18} />;
    case "EVENT": return <CalendarDays size={18} />;
    default: return <Hash size={18} />;
  }
}

function auditLabel(action: string) {
  const labels: Record<string, string> = {
    GUILD_UPDATE: "Configuracoes do espaco alteradas",
    GUILD_LOCKDOWN_ENABLE: "Modo de contencao ativado",
    GUILD_LOCKDOWN_DISABLE: "Modo de contencao desativado",
    MEMBER_ROLE_UPDATE: "Cargo de membro alterado",
    MEMBER_KICK: "Membro expulso",
    MEMBER_LEAVE: "Membro saiu do servidor",
    MEMBER_BAN: "Membro banido",
    MEMBER_TIMEOUT: "Timeout aplicado ao membro",
    MEMBER_TIMEOUT_REMOVE: "Timeout removido do membro",
    MEMBER_NICKNAME_UPDATE: "Apelido do membro alterado",
    MEMBER_VOICE_MUTE: "Membro mutado no servidor",
    MEMBER_VOICE_UNMUTE: "Mute de servidor removido",
    MEMBER_VOICE_DEAFEN: "Membro ensurdecido no servidor",
    MEMBER_VOICE_UNDEAFEN: "Ensurdecimento removido",
    MEMBER_UNBAN: "Banimento removido",
    CATEGORY_CREATE: "Categoria criada",
    CATEGORY_UPDATE: "Categoria alterada",
    CATEGORY_DELETE: "Categoria excluida",
    CATEGORY_REORDER: "Categorias reorganizadas",
    CHANNEL_CREATE: "Canal criado",
    CHANNEL_UPDATE: "Canal alterado",
    CHANNEL_DELETE: "Canal excluido",
    CHANNEL_REORDER: "Canais reorganizados",
    ROLE_PERMISSION_UPDATE: "Permissoes de cargo alteradas",
    CATEGORY_PERMISSION_UPDATE: "Permissoes de categoria alteradas",
    CHANNEL_PERMISSION_UPDATE: "Permissoes de canal alteradas",
    CUSTOM_ROLE_CREATE: "Cargo personalizado criado",
    CUSTOM_ROLE_UPDATE: "Cargo personalizado alterado",
    CUSTOM_ROLE_DELETE: "Cargo personalizado excluido",
    CUSTOM_ROLE_REORDER: "Hierarquia de cargos reorganizada",
    MEMBER_CUSTOM_ROLES_UPDATE: "Cargos personalizados de membro alterados",
    CATEGORY_CUSTOM_ROLE_PERMISSION_UPDATE: "Permissao de cargo na categoria alterada",
    CHANNEL_CUSTOM_ROLE_PERMISSION_UPDATE: "Permissao de cargo no canal alterada",
    INVITE_CREATE: "Convite criado",
    INVITE_REVOKE: "Convite revogado",
    COMMUNITY_JOIN: "Membro entrou pela descoberta de comunidades",
    MUSIC_SETTINGS_UPDATE: "Configuracoes do Ginga Music alteradas"
  };
  return labels[action] ?? action;
}

export function ServerSettingsModal({ guild, members, onClose, onGuildsRefresh, onMembersRefresh, initialTab }: ServerSettingsModalProps) {
  const developerMode = useDeveloperMode();
  const [tab, setTab] = useState<ServerSettingsTab>(initialTab ?? (guild.permissions.canManageServer ? "overview" : "members"));
  const [busy, setBusy] = useState(false);
  const [tabLoading, setTabLoading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [structure, setStructure] = useState<GuildStructure>({ categories: [], channels: [], rolePermissions: [], customRoles: [] });
  const [invites, setInvites] = useState<InviteSummary[]>([]);
  const [bans, setBans] = useState<GuildBan[]>([]);
  const [auditLogs, setAuditLogs] = useState<GuildAuditLog[]>([]);
  const [autoModRules, setAutoModRules] = useState<Array<{ id: string; name: string; type: string; enabled: boolean; blockedTerms: string[]; mentionLimit?: number | null; repetitionLimit?: number | null }>>([]);
  const [insights, setInsights] = useState<{ members: number; channels: number; messages24h: number; messages7d: number; forumPosts7d: number; eventsUpcoming: number; bans: number; bots: number } | null>(null);
  const [securityOverview, setSecurityOverview] = useState<SecurityOverview | null>(null);
  const [botInstalls, setBotInstalls] = useState<Array<{ id: string; applicationId: string; permissions: string[]; application: DeveloperApplication; installedBy: { displayName: string } }>>([]);
  const [templateJson, setTemplateJson] = useState("");
  const [editingChannelId, setEditingChannelId] = useState("");
  const [editingChannelName, setEditingChannelName] = useState("");
  const [banTarget, setBanTarget] = useState<GuildMember | null>(null);
  const [banDuration, setBanDuration] = useState<BanDuration>("7D");
  const [banReason, setBanReason] = useState("");
  const [banDeleteMessageMinutes, setBanDeleteMessageMinutes] = useState(0);
  const [kickTarget, setKickTarget] = useState<GuildMember | null>(null);
  const [kickReason, setKickReason] = useState("");
  const [nicknameTarget, setNicknameTarget] = useState<GuildMember | null>(null);
  const [nicknameDraft, setNicknameDraft] = useState("");
  const [auditSearch, setAuditSearch] = useState("");
  const [auditAction, setAuditAction] = useState("");
  const [timeoutTarget, setTimeoutTarget] = useState<GuildMember | null>(null);
  const [timeoutDurationMinutes, setTimeoutDurationMinutes] = useState(10);
  const [timeoutReason, setTimeoutReason] = useState("");
  const [lockdownReason, setLockdownReason] = useState("");
  const [previewUserId, setPreviewUserId] = useState("");
  const [permissionPreview, setPermissionPreview] = useState<PermissionPreview | null>(null);
  const [previewBusy, setPreviewBusy] = useState(false);
  const [overrideUserId,setOverrideUserId]=useState("");
  const [overrideScope,setOverrideScope]=useState<"channel"|"category">("channel");
  const [overrideResourceId,setOverrideResourceId]=useState("");
  const [userPermissionOverride,setUserPermissionOverride]=useState<UserPermissionOverride>({...emptyUserPermissionOverride});
  const [overrideBusy,setOverrideBusy]=useState(false);
  const [webhooks, setWebhooks] = useState<WebhookItem[]>([]);
  const [webhookReveal, setWebhookReveal] = useState<{ id: string; endpoint: string; token: string } | null>(null);
  const [deleteConfirmation, setDeleteConfirmation] = useState("");
  const [guildIconUrl, setGuildIconUrl] = useState<string | null>(guild.iconUrl ?? null);
  const [guildIconBusy, setGuildIconBusy] = useState(false);
  const [guildBannerUrl,setGuildBannerUrl]=useState<string|null>(guild.bannerUrl??null);
  const [guildBannerBusy,setGuildBannerBusy]=useState(false);
  const [communityEnabled, setCommunityEnabled] = useState(Boolean(guild.communityEnabled));
  const [communityCategory, setCommunityCategory] = useState(guild.communityCategory || "Geral");
  const [communityTags, setCommunityTags] = useState((guild.communityTags ?? []).join(", "));
  const [afkEnabled, setAfkEnabled] = useState(Boolean(guild.afkEnabled));
  const [afkTimeoutMinutes, setAfkTimeoutMinutes] = useState(guild.afkTimeoutMinutes ?? 15);
  const [musicSettings, setMusicSettings] = useState<MusicPayload["settings"] | null>(null);

  useEffect(() => { setGuildIconUrl(guild.iconUrl ?? null); }, [guild.id, guild.iconUrl]);
  useEffect(() => { setGuildBannerUrl(guild.bannerUrl ?? null); }, [guild.id, guild.bannerUrl]);
  useEffect(() => {
    setCommunityEnabled(Boolean(guild.communityEnabled));
    setCommunityCategory(guild.communityCategory || "Geral");
    setCommunityTags((guild.communityTags ?? []).join(", "));
    setAfkEnabled(Boolean(guild.afkEnabled));
    setAfkTimeoutMinutes(guild.afkTimeoutMinutes ?? 15);
  }, [guild.id, guild.communityEnabled, guild.communityCategory, guild.communityTags, guild.afkEnabled, guild.afkTimeoutMinutes]);

  async function uploadGuildIcon(file: File | null) {
    if (!file || guildIconBusy) return;
    setGuildIconBusy(true); setError(""); setNotice("");
    try {
      const blob = await imageFileToSquareWebp(file, 512, 0.9);
      const result = await api<{ iconUrl: string }>(`/api/guilds/${guild.id}/icon`, {
        method: "POST",
        headers: { "Content-Type": "image/webp" },
        body: blob
      });
      setGuildIconUrl(result.iconUrl);
      await onGuildsRefresh();
      setNotice("Icone do servidor atualizado");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Nao foi possivel atualizar o icone do servidor");
    } finally { setGuildIconBusy(false); }
  }

  async function removeGuildIconImage() {
    if (guildIconBusy) return;
    setGuildIconBusy(true); setError(""); setNotice("");
    try {
      await api(`/api/guilds/${guild.id}/icon`, { method: "DELETE" });
      setGuildIconUrl(null);
      await onGuildsRefresh();
      setNotice("Icone do servidor removido");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Nao foi possivel remover o icone do servidor");
    } finally { setGuildIconBusy(false); }
  }

  const tabs = useMemo(() => {
    const items: Array<{ id: ServerSettingsTab; label: string; icon: ReactNode; group?: string }> = [];
    if (guild.permissions.canManageServer) items.push({ id: "overview", label: "Visao geral", icon: <Settings2 size={18} />, group: "ESPACO" });
    if (guild.permissions.canManageServer) items.push({ id: "community", label: "Comunidade", icon: <Users size={18} /> });
    if (guild.permissions.canManageMembers || guild.permissions.canManageRoles || guild.permissions.canKickMembers || guild.permissions.canMoveMembers || guild.permissions.canMuteMembers || guild.permissions.canDeafenMembers || guild.permissions.canManageNicknames || guild.permissions.canBanMembers) {
      items.push({ id: "members", label: "Membros", icon: <Users size={18} />, group: items.length ? undefined : "ESPACO" });
    }
    if (guild.permissions.canManageRoles) items.push({ id: "roles", label: "Cargos", icon: <ShieldCheck size={18} />, group: "CONTROLE" });
    if (guild.permissions.canManageChannels) items.push({ id: "channels", label: "Canais", icon: <Hash size={18} /> });
    if (guild.permissions.canManageBots || guild.permissions.canManageWebhooks) items.push({ id: "integrations", label: "Integracoes", icon: <Webhook size={18} />, group: "INTEGRACOES" });
    if (guild.permissions.canManageServer || guild.permissions.canManageBots) items.push({ id: "music", label: "Ginga Music", icon: <Music2 size={18} /> });
    if (guild.permissions.canManageServer || guild.permissions.canViewAuditLog || guild.permissions.canManageAutoMod) items.push({ id: "security", label: "Seguranca", icon: <ShieldCheck size={18} />, group: "SEGURANCA" });
    if (guild.permissions.canManageAutoMod) items.push({ id: "automod", label: "AutoMod", icon: <ShieldAlert size={18} /> });
    if (guild.permissions.canViewAuditLog) items.push({ id: "insights", label: "Insights", icon: <BarChart3 size={18} /> });
    if (guild.permissions.canManageServer) items.push({ id: "templates", label: "Backup e modelos", icon: <Download size={18} />, group: "PORTABILIDADE" });
    if (guild.permissions.canManageInvites || guild.permissions.canCreateInvites) items.push({ id: "invites", label: "Convites", icon: <Link2 size={18} />, group: "ACESSO" });
    if (guild.permissions.canBanMembers) items.push({ id: "bans", label: "Banidos", icon: <Ban size={18} />, group: "MODERACAO" });
    if (guild.permissions.canViewAuditLog) items.push({ id: "audit", label: "Auditoria", icon: <ScrollText size={18} /> });
    return items;
  }, [guild.permissions]);

  useEffect(() => {
    if (!tabs.some((item) => item.id === tab) && tabs[0]) setTab(tabs[0].id);
  }, [tab, tabs]);

  const roleCounts = useMemo(() => {
    const counts: Record<GuildRole, number> = { OWNER: 0, ADMIN: 0, MODERATOR: 0, MEMBER: 0 };
    members.forEach((member) => { counts[member.role] += 1; });
    return counts;
  }, [members]);

  const auditActionOptions = useMemo(() => Array.from(new Set(auditLogs.map((log) => log.action))).sort((a, b) => auditLabel(a).localeCompare(auditLabel(b), "pt-BR")), [auditLogs]);
  const filteredAuditLogs = useMemo(() => {
    const query = auditSearch.trim().toLocaleLowerCase("pt-BR");
    return auditLogs.filter((log) => {
      if (auditAction && log.action !== auditAction) return false;
      if (!query) return true;
      const targetMember = log.targetUserId ? members.find((member) => member.user.id === log.targetUserId) : null;
      const searchable = [auditLabel(log.action), log.actor?.displayName, log.actor?.username, targetMember?.nickname, targetMember?.user.displayName, targetMember?.user.username, log.targetUserId]
        .filter(Boolean).join(" ").toLocaleLowerCase("pt-BR");
      return searchable.includes(query);
    });
  }, [auditAction, auditLogs, auditSearch, members]);

  async function loadStructure() {
    const result = await api<GuildStructure>(`/api/guilds/${guild.id}/structure`);
    setStructure(result);
  }

  async function loadInvites() {
    if (!guild.permissions.canManageInvites) return setInvites([]);
    const result = await api<{ invites: InviteSummary[] }>(`/api/guilds/${guild.id}/invites`);
    setInvites(result.invites);
  }

  async function loadBans() {
    const result = await api<{ bans: GuildBan[] }>(`/api/guilds/${guild.id}/bans`);
    setBans(result.bans);
  }

  async function loadBots() {
    const result = await api<{ installs: typeof botInstalls }>(`/api/guilds/${guild.id}/bots`);
    setBotInstalls(result.installs);
  }

  async function loadWebhooks() {
    if (!guild.permissions.canManageWebhooks) return setWebhooks([]);
    const result = await api<{ webhooks: WebhookItem[] }>(`/api/developers/guilds/${guild.id}/webhooks`);
    setWebhooks(result.webhooks);
  }

  async function loadMusicSettings() {
    const result = await api<MusicPayload>(`/api/guilds/${guild.id}/music`);
    setMusicSettings(result.settings);
  }

  async function saveMusicSettings() {
    if (!musicSettings) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const result = await api<MusicPayload>(`/api/guilds/${guild.id}/music/settings`, {
        method: "PATCH",
        body: JSON.stringify({
          enabled: musicSettings.enabled,
          allowMembers: musicSettings.allowMembers,
          defaultVolume: musicSettings.defaultVolume,
          defaultVoiceChannelId: musicSettings.defaultVoiceChannelId || null
        })
      });
      setMusicSettings(result.settings);
      await onGuildsRefresh();
      setNotice(result.settings.enabled ? "Ginga Music ativado e configurado" : "Ginga Music desativado");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Nao foi possivel salvar o Ginga Music");
    } finally { setBusy(false); }
  }

  async function loadAutoMod() {
    const result = await api<{ rules: typeof autoModRules }>(`/api/guilds/${guild.id}/automod`);
    setAutoModRules(result.rules);
  }

  async function loadInsights() {
    const result = await api<typeof insights>(`/api/guilds/${guild.id}/insights`);
    setInsights(result);
  }

  async function loadSecurityOverview() {
    const result = await api<SecurityOverview>(`/api/guilds/${guild.id}/security-overview`);
    setSecurityOverview(result);
  }

  async function setLockdown(enabled: boolean) {
    if (enabled && !(await gingaConfirm("Membros comuns serao removidos das salas de voz e ficarao impedidos de enviar mensagens ate a liberacao.", { title: "Ativar modo de contencao?", confirmLabel: "Ativar contencao", tone: "danger" }))) return;
    if (!enabled && !(await gingaConfirm("Mensagens e voz serao liberadas novamente para os membros.", { title: "Desativar contencao?", confirmLabel: "Desativar" }))) return;
    setBusy(true); setError(""); setNotice("");
    try {
      await api(`/api/guilds/${guild.id}/lockdown`, {
        method: "PATCH",
        body: JSON.stringify({ enabled, reason: enabled ? lockdownReason.trim() : "" })
      });
      await loadSecurityOverview();
      setLockdownReason("");
      setNotice(enabled ? "Modo de contencao ativado" : "Modo de contencao desativado");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Nao foi possivel alterar o modo de contencao");
    } finally { setBusy(false); }
  }

  async function loadTemplate() {
    const result = await api<Record<string, unknown>>(`/api/guilds/${guild.id}/snapshot`);
    setTemplateJson(JSON.stringify(result, null, 2));
  }

  async function loadAudit() {
    const result = await api<{ logs: GuildAuditLog[] }>(`/api/guilds/${guild.id}/audit?limit=100`);
    setAuditLogs(result.logs);
  }

  async function loadPermissionPreview(userId = previewUserId) {
    if (!userId) { setPermissionPreview(null); return; }
    setPreviewBusy(true); setError("");
    try {
      const result = await api<PermissionPreview>(`/api/guilds/${guild.id}/permission-preview/${userId}`);
      setPermissionPreview(result);
    } catch (caught) {
      setPermissionPreview(null);
      setError(caught instanceof Error ? caught.message : "Nao foi possivel simular as permissoes");
    } finally { setPreviewBusy(false); }
  }

  useEffect(() => {
    let cancelled = false;
    setError("");
    setNotice("");
    const jobs: Array<Promise<unknown>> = [];
    if (tab === "roles" || tab === "channels" || (tab === "members" && guild.permissions.canManageRoles)) jobs.push(loadStructure());
    if (tab === "integrations") {
      if (guild.permissions.canManageBots) jobs.push(loadBots());
      if (guild.permissions.canManageWebhooks) jobs.push(loadWebhooks(), loadStructure());
    }
    if (tab === "music") jobs.push(loadMusicSettings());
    if (tab === "security") jobs.push(loadSecurityOverview());
    if (tab === "automod") jobs.push(loadAutoMod());
    if (tab === "insights") jobs.push(loadInsights());
    if (tab === "templates") jobs.push(loadTemplate());
    if (tab === "invites") jobs.push(loadInvites());
    if (tab === "bans") jobs.push(loadBans());
    if (tab === "audit") jobs.push(loadAudit());

    if (jobs.length === 0) {
      setTabLoading(false);
      return () => { cancelled = true; };
    }

    setTabLoading(true);
    void Promise.allSettled(jobs).then((results) => {
      if (cancelled) return;
      const failed = results.find((result) => result.status === "rejected");
      if (failed && failed.status === "rejected") {
        const caught = failed.reason;
        setError(caught instanceof Error ? caught.message : "Falha ao carregar esta area das configuracoes");
      }
      setTabLoading(false);
    });
    return () => { cancelled = true; };
  }, [guild.id, tab]);

  async function saveOverview(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true); setError(""); setNotice("");
    try {
      await api(`/api/guilds/${guild.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          name: String(form.get("name") ?? ""),
          iconColor: String(form.get("iconColor") ?? guild.iconColor),
          description: String(form.get("description") ?? ""),
          welcomeMessage: String(form.get("welcomeMessage") ?? ""),
          rules: String(form.get("rules") ?? ""),
          welcomeChannelId: String(form.get("welcomeChannelId") ?? "") || null,
          memberJoinMessagesEnabled: Boolean(form.get("memberJoinMessagesEnabled")),
          memberLeaveMessagesEnabled: Boolean(form.get("memberLeaveMessagesEnabled")),
          memberSystemMessageChannelId: String(form.get("memberSystemMessageChannelId") ?? "") || null
        })
      });
      await onGuildsRefresh();
      setNotice("Configuracoes do espaco salvas");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Nao foi possivel salvar o espaco");
    } finally { setBusy(false); }
  }

  async function uploadGuildBanner(file:File|null){if(!file||guildBannerBusy)return;setGuildBannerBusy(true);setError("");try{const blob=await imageFileToWideWebp(file);const result=await api<{bannerUrl:string}>(`/api/guilds/${guild.id}/banner`,{method:"POST",headers:{"Content-Type":"image/webp"},body:blob});setGuildBannerUrl(result.bannerUrl);await onGuildsRefresh();setNotice("Banner atualizado");}catch(e){setError(e instanceof Error?e.message:"Falha ao atualizar banner")}finally{setGuildBannerBusy(false)}}
  async function removeGuildBannerImage(){if(guildBannerBusy)return;setGuildBannerBusy(true);try{await api(`/api/guilds/${guild.id}/banner`,{method:"DELETE"});setGuildBannerUrl(null);await onGuildsRefresh();setNotice("Banner removido");}catch(e){setError(e instanceof Error?e.message:"Falha ao remover banner")}finally{setGuildBannerBusy(false)}}

  async function saveCommunitySettings() {
    setBusy(true); setError(""); setNotice("");
    try {
      const tags = communityTags.split(",").map((tag) => tag.trim().replace(/^#/, "")).filter(Boolean).slice(0, 6);
      await api(`/api/guilds/${guild.id}`, {
        method: "PATCH",
        body: JSON.stringify({ communityEnabled, communityCategory: communityCategory.trim() || "Geral", communityTags: tags, afkEnabled, afkTimeoutMinutes })
      });
      await onGuildsRefresh();
      setNotice(afkEnabled ? "Comunidade e canal Ausente configurados" : "Configuracoes de comunidade salvas");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Nao foi possivel salvar as configuracoes");
    } finally { setBusy(false); }
  }

  async function setMemberRole(member: GuildMember, role: "ADMIN" | "MODERATOR" | "MEMBER") {
    setBusy(true); setError(""); setNotice("");
    try {
      await api(`/api/guilds/${guild.id}/members/${member.user.id}`, { method: "PATCH", body: JSON.stringify({ role }) });
      await Promise.all([onMembersRefresh(), onGuildsRefresh()]);
      setNotice(`Cargo de ${member.user.displayName} atualizado`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Nao foi possivel alterar o cargo");
    } finally { setBusy(false); }
  }

  async function kickMember() {
    if (!kickTarget) return;
    setBusy(true); setError(""); setNotice("");
    try {
      await api<void>(`/api/guilds/${guild.id}/members/${kickTarget.user.id}/kick`, { method: "POST", body: JSON.stringify({ reason: kickReason.trim() }) });
      const name = kickTarget.user.displayName;
      setKickTarget(null); setKickReason("");
      await Promise.all([onMembersRefresh(), onGuildsRefresh()]);
      setNotice(`${name} foi expulso`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Nao foi possivel expulsar o membro");
    } finally { setBusy(false); }
  }

  async function saveNickname() {
    if (!nicknameTarget) return;
    setBusy(true); setError(""); setNotice("");
    try {
      await api(`/api/guilds/${guild.id}/members/${nicknameTarget.user.id}/nickname`, {
        method: "PATCH",
        body: JSON.stringify({ nickname: nicknameDraft.trim() })
      });
      const name = nicknameTarget.user.displayName;
      setNicknameTarget(null); setNicknameDraft("");
      await onMembersRefresh();
      setNotice(nicknameDraft.trim() ? `Apelido de ${name} atualizado` : `Apelido de ${name} removido`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Nao foi possivel alterar o apelido");
    } finally { setBusy(false); }
  }

  async function setVoiceModeration(member: GuildMember, state: { muted?: boolean; deafened?: boolean }) {
    setBusy(true); setError(""); setNotice("");
    try {
      await api(`/api/guilds/${guild.id}/members/${member.user.id}/voice-moderation`, {
        method: "PATCH",
        body: JSON.stringify(state)
      });
      await onMembersRefresh();
      if (typeof state.muted === "boolean") setNotice(state.muted ? `${member.user.displayName} foi mutado no servidor` : `Mute de ${member.user.displayName} removido`);
      else if (typeof state.deafened === "boolean") setNotice(state.deafened ? `${member.user.displayName} foi ensurdecido` : `Ensurdecimento de ${member.user.displayName} removido`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Nao foi possivel alterar o estado de voz");
    } finally { setBusy(false); }
  }

  async function applyTimeout() {
    if (!timeoutTarget) return;
    setBusy(true); setError(""); setNotice("");
    try {
      await api(`/api/guilds/${guild.id}/members/${timeoutTarget.user.id}/timeout`, {
        method: "POST",
        body: JSON.stringify({ durationMinutes: timeoutDurationMinutes, reason: timeoutReason.trim() })
      });
      const name = timeoutTarget.user.displayName;
      setTimeoutTarget(null); setTimeoutReason(""); setTimeoutDurationMinutes(10);
      await onMembersRefresh();
      setNotice(`Timeout aplicado em ${name}`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Nao foi possivel aplicar o timeout");
    } finally { setBusy(false); }
  }

  async function removeTimeout(member: GuildMember) {
    setBusy(true); setError(""); setNotice("");
    try {
      await api<void>(`/api/guilds/${guild.id}/members/${member.user.id}/timeout`, { method: "DELETE" });
      await onMembersRefresh();
      setNotice(`Timeout de ${member.user.displayName} removido`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Nao foi possivel remover o timeout");
    } finally { setBusy(false); }
  }

  async function banMember() {
    if (!banTarget) return;
    setBusy(true); setError(""); setNotice("");
    try {
      await api(`/api/guilds/${guild.id}/bans/${banTarget.user.id}`, {
        method: "POST",
        body: JSON.stringify({ duration: banDuration, reason: banReason.trim(), deleteMessageMinutes: banDeleteMessageMinutes })
      });
      const name = banTarget.user.displayName;
      setBanTarget(null); setBanReason(""); setBanDuration("7D"); setBanDeleteMessageMinutes(0);
      await Promise.all([onMembersRefresh(), onGuildsRefresh()]);
      setNotice(`${name} foi banido`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Nao foi possivel banir o membro");
    } finally { setBusy(false); }
  }

  async function unban(userId: string, displayName: string) {
    if (!(await gingaConfirm(`O acesso de ${displayName} ao servidor sera liberado.`, { title: "Remover banimento?", confirmLabel: "Desbanir" }))) return;
    setBusy(true); setError(""); setNotice("");
    try {
      await api<void>(`/api/guilds/${guild.id}/bans/${userId}`, { method: "DELETE" });
      await loadBans();
      setNotice(`Banimento de ${displayName} removido`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Nao foi possivel remover o banimento");
    } finally { setBusy(false); }
  }

  function userOverrideEndpoint(scope=overrideScope,resourceId=overrideResourceId,userId=overrideUserId){if(!resourceId||!userId)return"";return scope==="channel"?`/api/channels/${resourceId}/user-permissions/${userId}`:`/api/categories/${resourceId}/user-permissions/${userId}`;}
  async function loadUserPermissionOverride(scope=overrideScope,resourceId=overrideResourceId,userId=overrideUserId){const endpoint=userOverrideEndpoint(scope,resourceId,userId);if(!endpoint)return;setOverrideBusy(true);try{const result=await api<{permission:UserPermissionOverride|null}>(endpoint);setUserPermissionOverride(result.permission??{...emptyUserPermissionOverride})}catch(e){setError(e instanceof Error?e.message:"Falha ao carregar excecao")}finally{setOverrideBusy(false)}}
  async function saveUserPermissionOverride(next=userPermissionOverride){const endpoint=userOverrideEndpoint();if(!endpoint)return;setOverrideBusy(true);try{const result=await api<{permission:UserPermissionOverride|null}>(endpoint,{method:"PUT",body:JSON.stringify(next)});setUserPermissionOverride(result.permission??{...emptyUserPermissionOverride});setNotice(result.permission?"Excecao individual salva":"Membro voltou a herdar as permissoes");if(previewUserId===overrideUserId)void loadPermissionPreview(overrideUserId)}catch(e){setError(e instanceof Error?e.message:"Falha ao salvar excecao")}finally{setOverrideBusy(false)}}
  const overrideValue=(v:boolean|null)=>v===null?"inherit":v?"allow":"deny";
  const parseOverrideValue=(v:string):boolean|null=>v==="allow"?true:v==="deny"?false:null;

  function permissionFor(channel: ManagedChannel, role: "MODERATOR" | "MEMBER") {
    return channel.permissions.find((permission) => permission.role === role) ?? {
      channelId: channel.id,
      role,
      canView: true,
      canSendMessages: true,
      canConnect: true
    };
  }

  function rolePermissionFor(role: "MODERATOR" | "MEMBER"): GuildRolePermission {
    return structure.rolePermissions.find((permission) => permission.role === role) ?? {
      role,
      canManageChannels: false, canManageMessages: role === "MODERATOR", canManageMembers: false, canManageServer: false, canManageRoles: false,
      canKickMembers: role === "MODERATOR", canMoveMembers: role === "MODERATOR", canMuteMembers: role === "MODERATOR", canDeafenMembers: role === "MODERATOR",
      canManageNicknames: role === "MODERATOR", canBanMembers: role === "MODERATOR", canViewAuditLog: role === "MODERATOR",
      canCreateInvites: true, canManageInvites: false, canManageWebhooks: false, canManageBots: false, canManageEvents: false,
      canManageForums: role === "MODERATOR", canManageAutoMod: false, canPinMessages: role === "MODERATOR", canScheduleMessages: false,
      canMentionEveryone: false, canShareScreen: true, canUseVideo: true
    };
  }

  async function toggleGuildPermission(role: "MODERATOR" | "MEMBER", key: PermissionKey) {
    const current = rolePermissionFor(role);
    const next = { ...current, [key]: !current[key] };
    setStructure((value) => ({
      ...value,
      rolePermissions: [...value.rolePermissions.filter((item) => item.role !== role), next]
    }));
    try {
      await api(`/api/guilds/${guild.id}/role-permissions/${role}`, {
        method: "PUT",
        body: JSON.stringify(Object.fromEntries(guildPermissionLabels.map((item) => [item.key, Boolean(next[item.key])])))
      });
      await onGuildsRefresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Nao foi possivel salvar a permissao");
      await loadStructure().catch(() => undefined);
    }
  }

  async function toggleChannelPermission(channel: ManagedChannel, role: "MODERATOR" | "MEMBER", key: "canView" | "canSendMessages" | "canConnect") {
    const current = permissionFor(channel, role);
    const next = { ...current, [key]: !current[key] };
    if (key === "canView" && !next.canView) { next.canSendMessages = false; next.canConnect = false; }
    if ((key === "canSendMessages" || key === "canConnect") && next[key]) next.canView = true;

    setStructure((value) => ({
      ...value,
      channels: value.channels.map((item) => item.id === channel.id
        ? { ...item, permissions: [...item.permissions.filter((permission) => permission.role !== role), next] }
        : item)
    }));

    try {
      await api(`/api/channels/${channel.id}/permissions/${role}`, {
        method: "PUT",
        body: JSON.stringify({ canView: next.canView, canSendMessages: next.canSendMessages, canConnect: next.canConnect })
      });
      await onGuildsRefresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Nao foi possivel salvar a permissao");
      await loadStructure().catch(() => undefined);
    }
  }

  async function renameChannel(channel: ManagedChannel) {
    const name = editingChannelName.trim();
    if (!name || name === channel.name) { setEditingChannelId(""); return; }
    setBusy(true); setError("");
    try {
      await api(`/api/channels/${channel.id}`, { method: "PATCH", body: JSON.stringify({ name }) });
      setEditingChannelId("");
      await Promise.all([loadStructure(), onGuildsRefresh()]);
      setNotice("Canal renomeado");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Nao foi possivel renomear o canal");
    } finally { setBusy(false); }
  }

  async function deleteChannel(channel: ManagedChannel) {
    if (!(await gingaConfirm(`As mensagens de #${channel.name} tambem serao removidas.`, { title: `Excluir #${channel.name}?`, confirmLabel: "Excluir canal", tone: "danger" }))) return;
    setBusy(true); setError(""); setNotice("");
    try {
      await api<void>(`/api/channels/${channel.id}`, { method: "DELETE" });
      await Promise.all([loadStructure(), onGuildsRefresh()]);
      setNotice("Canal removido");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Nao foi possivel excluir o canal");
    } finally { setBusy(false); }
  }

  async function createInvite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const expiresInMinutes = Number(form.get("expiresInMinutes") ?? 10080);
    const maxUsesRaw = String(form.get("maxUses") ?? "0").trim();
    setBusy(true); setError(""); setNotice("");
    try {
      await api(`/api/guilds/${guild.id}/invites`, {
        method: "POST",
        body: JSON.stringify({ expiresInMinutes: expiresInMinutes > 0 ? expiresInMinutes : null, maxUses: maxUsesRaw && Number(maxUsesRaw) > 0 ? Number(maxUsesRaw) : null })
      });
      if (guild.permissions.canManageInvites) await loadInvites();
      formElement.reset();
      setNotice("Novo convite criado");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Nao foi possivel criar o convite");
    } finally { setBusy(false); }
  }

  async function revokeInvite(code: string) {
    setBusy(true); setError("");
    try {
      await api<void>(`/api/guilds/${guild.id}/invites/${encodeURIComponent(code)}`, { method: "DELETE" });
      await loadInvites();
      setNotice("Convite revogado");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Nao foi possivel revogar o convite");
    } finally { setBusy(false); }
  }

  async function copyInvite(code: string) {
    await navigator.clipboard.writeText(`${window.location.origin}/invite/${code}`);
    setNotice("Link de convite copiado");
  }

  async function createWebhook(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const name = String(form.get("name") ?? "").trim();
    const channelId = String(form.get("channelId") ?? "").trim();
    if (!channelId) return setError("Escolha o canal que vai receber as mensagens do webhook.");
    if (name.length < 2) return setError("Digite um nome com pelo menos 2 caracteres para identificar o webhook.");
    setBusy(true); setError(""); setNotice(""); setWebhookReveal(null);
    try {
      const result = await api<{ webhook: WebhookItem; token: string }>("/api/developers/webhooks", {
        method: "POST",
        body: JSON.stringify({ guildId: guild.id, channelId, name })
      });
      const endpoint = `${window.location.origin}/api/webhooks/${result.webhook.id}`;
      setWebhookReveal({ id: result.webhook.id, endpoint, token: result.token });
      await loadWebhooks();
      formElement.reset();
      setNotice("Webhook criado. Copie o segredo agora; ele nao sera exibido novamente.");
    } catch (caught) {
      const friendly = friendlyWebhookError(caught);
      setError([friendly.message, friendly.hint].filter(Boolean).join(" "));
      if (friendly.field) formElement.querySelector<HTMLElement>(`[name="${friendly.field}"]`)?.focus();
    } finally { setBusy(false); }
  }

  async function resetWebhook(webhook: WebhookItem) {
    if (!(await gingaConfirm("O segredo antigo deixa de funcionar imediatamente.", { title: `Rotacionar segredo de ${webhook.name}?`, confirmLabel: "Rotacionar" }))) return;
    setBusy(true); setError(""); setWebhookReveal(null);
    try {
      const result = await api<{ token: string }>(`/api/developers/webhooks/${webhook.id}/token/reset`, { method: "POST" });
      setWebhookReveal({ id: webhook.id, endpoint: `${window.location.origin}/api/webhooks/${webhook.id}`, token: result.token });
      await loadWebhooks();
      setNotice("Segredo rotacionado. Copie o novo segredo agora.");
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Nao foi possivel rotacionar o webhook"); }
    finally { setBusy(false); }
  }

  async function removeWebhook(webhook: WebhookItem) {
    if (!(await gingaConfirm("O endpoint deixa de aceitar novas chamadas imediatamente.", { title: `Excluir ${webhook.name}?`, confirmLabel: "Excluir webhook", tone: "danger" }))) return;
    setBusy(true); setError("");
    try {
      await api(`/api/developers/webhooks/${webhook.id}`, { method: "DELETE" });
      setWebhookReveal((current) => current?.id === webhook.id ? null : current);
      await loadWebhooks();
      setNotice("Webhook removido");
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Nao foi possivel excluir o webhook"); }
    finally { setBusy(false); }
  }

  async function deleteGuild() {
    if (guild.role !== "OWNER" || deleteConfirmation !== "EXCLUIR") return;
    setBusy(true); setError("");
    try {
      await api(`/api/guilds/${guild.id}`, { method: "DELETE", body: JSON.stringify({ confirmation: deleteConfirmation }) });
      await onGuildsRefresh();
      onClose();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Nao foi possivel excluir o servidor"); }
    finally { setBusy(false); }
  }

  const customPermissionMap: Record<PermissionKey, string> = {
    canManageChannels: "manageChannels", canManageMessages: "manageMessages", canManageMembers: "manageMembers", canManageServer: "manageServer",
    canManageRoles: "manageRoles", canKickMembers: "kickMembers", canMoveMembers: "moveMembers", canMuteMembers: "muteMembers", canDeafenMembers: "deafenMembers", canManageNicknames: "manageNicknames", canBanMembers: "banMembers", canViewAuditLog: "viewAuditLog",
    canCreateInvites: "createInvites", canManageInvites: "manageInvites", canManageWebhooks: "manageWebhooks", canManageBots: "manageBots",
    canManageEvents: "manageEvents", canManageForums: "manageForums", canManageAutoMod: "manageAutoMod", canPinMessages: "pinMessages",
    canScheduleMessages: "scheduleMessages", canMentionEveryone: "mentionEveryone", canShareScreen: "shareScreen", canUseVideo: "useVideo"
  };

  async function createCustomRole(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true); setError(""); setNotice("");
    try {
      await api(`/api/guilds/${guild.id}/custom-roles`, { method: "POST", body: JSON.stringify({ name: String(form.get("name") ?? ""), color: String(form.get("color") ?? "#8b93a7"), hoist: Boolean(form.get("hoist")), mentionable: Boolean(form.get("mentionable")), permissions: [] }) });
      formElement.reset();
      await loadStructure();
      setNotice("Cargo personalizado criado");
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Nao foi possivel criar o cargo"); } finally { setBusy(false); }
  }

  async function toggleCustomRolePermission(role: CustomRole, key: PermissionKey) {
    const capability = customPermissionMap[key];
    const permissions = role.permissions.includes(capability) ? role.permissions.filter((item) => item !== capability) : [...role.permissions, capability];
    setStructure((value) => ({ ...value, customRoles: value.customRoles.map((item) => item.id === role.id ? { ...item, permissions } : item) }));
    try {
      await api(`/api/guilds/${guild.id}/custom-roles/${role.id}`, { method: "PATCH", body: JSON.stringify({ permissions }) });
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Nao foi possivel salvar o cargo"); await loadStructure().catch(() => undefined); }
  }

  async function deleteCustomRole(role: CustomRole) {
    if (!(await gingaConfirm("As atribuicoes deste cargo serao removidas.", { title: `Excluir ${role.name}?`, confirmLabel: "Excluir cargo", tone: "danger" }))) return;
    setBusy(true); setError("");
    try { await api(`/api/guilds/${guild.id}/custom-roles/${role.id}`, { method: "DELETE" }); await Promise.all([loadStructure(), onMembersRefresh()]); setNotice("Cargo removido"); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Nao foi possivel excluir o cargo"); } finally { setBusy(false); }
  }

  async function setMemberCustomRole(member: GuildMember, roleId: string, enabled: boolean) {
    const current = (member.customRoles ?? []).map((role) => role.id);
    const roleIds = enabled ? [...new Set([...current, roleId])] : current.filter((id) => id !== roleId);
    setBusy(true); setError("");
    try { await api(`/api/guilds/${guild.id}/members/${member.user.id}/custom-roles`, { method: "PUT", body: JSON.stringify({ roleIds }) }); await onMembersRefresh(); setNotice(`Cargos de ${member.user.displayName} atualizados`); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Nao foi possivel atribuir o cargo"); } finally { setBusy(false); }
  }

  async function createAutoMod(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = new FormData(event.currentTarget); const type = String(form.get("type") ?? "KEYWORDS");
    const blockedTerms = String(form.get("blockedTerms") ?? "").split(",").map((value) => value.trim()).filter(Boolean);
    const mentionLimit = String(form.get("mentionLimit") ?? "").trim(); const repetitionLimit = String(form.get("repetitionLimit") ?? "").trim();
    setBusy(true); setError("");
    try {
      await api(`/api/guilds/${guild.id}/automod`, { method: "POST", body: JSON.stringify({ name: String(form.get("name") ?? ""), type, enabled: true, blockedTerms, mentionLimit: mentionLimit ? Number(mentionLimit) : null, repetitionLimit: repetitionLimit ? Number(repetitionLimit) : null, blockMessage: true, exemptRoleIds: [], exemptChannelIds: [] }) });
      event.currentTarget.reset(); await loadAutoMod(); setNotice("Regra AutoMod criada");
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Nao foi possivel criar a regra"); } finally { setBusy(false); }
  }

  async function toggleAutoMod(rule: { id: string; enabled: boolean }) {
    try { await api(`/api/automod/${rule.id}`, { method: "PATCH", body: JSON.stringify({ enabled: !rule.enabled }) }); await loadAutoMod(); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Nao foi possivel alterar o AutoMod"); }
  }

  async function deleteAutoMod(ruleId: string) {
    if (!(await gingaConfirm("A protecao desta regra deixa de valer imediatamente.", { title: "Excluir regra do AutoMod?", confirmLabel: "Excluir regra", tone: "danger" }))) return;
    try { await api(`/api/automod/${ruleId}`, { method: "DELETE" }); await loadAutoMod(); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Nao foi possivel excluir a regra"); }
  }

  async function removeBot(install: { applicationId: string; application: DeveloperApplication }) {
    if (!(await gingaConfirm("O bot perde o acesso a este servidor e suas permissoes instaladas.", { title: `Remover ${install.application.name}?`, confirmLabel: "Remover bot", tone: "danger" }))) return;
    setBusy(true); setError("");
    try { await api(`/api/guilds/${guild.id}/bots/${install.applicationId}`, { method: "DELETE" }); await loadBots(); await onMembersRefresh(); setNotice("Bot removido"); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Nao foi possivel remover o bot"); } finally { setBusy(false); }
  }

  function downloadTemplate() {
    if (!templateJson) return;
    const blob = new Blob([templateJson], { type: "application/json" }); const url = URL.createObjectURL(blob); const a = document.createElement("a");
    a.href = url; a.download = `ginga-${guild.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-template.json`; a.click(); URL.revokeObjectURL(url);
  }

  async function importTemplate(file: File | null) {
    if (!file) return; setBusy(true); setError("");
    try { const snapshot = JSON.parse(await file.text()); const result = await api<{ guild: { name: string } }>("/api/guilds/from-snapshot", { method: "POST", body: JSON.stringify(snapshot) }); await onGuildsRefresh(); setNotice(`Novo servidor ${result.guild.name} criado a partir do modelo`); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Modelo invalido"); } finally { setBusy(false); }
  }

  return (
    <>
      <SettingsShell
        title="Configuracoes do espaco"
        subtitle={guild.name}
        tabs={tabs}
        activeTab={tab}
        onTabChange={(next) => { setTab(next); setError(""); setNotice(""); }}
        onClose={onClose}
        footer={<div className="server-settings-footer"><span className={`space-nav-icon ${guildIconUrl ? "with-image" : ""}`} style={{ "--space-color": guild.iconColor } as CSSProperties}>{guildIconUrl ? <img src={guildIconUrl} alt=""/> : guild.name.slice(0, 1).toUpperCase()}</span><div><strong>{guild.name}</strong><span>{guild.memberCount} membros</span></div></div>}
      >
        {tabLoading && <div className="settings-load-progress" aria-label="Carregando configuracoes"><span /></div>}
        {error && <div className="inline-error settings-inline-error"><ShieldAlert size={16}/><span>{error}</span></div>}
        {notice && <div className="inline-success settings-inline-success"><BadgeCheck size={15} /> {notice}</div>}

        {tab === "overview" && (
          <form className="settings-page-section" onSubmit={saveOverview}>
            <div className="settings-page-title"><h1>Visao geral do espaco</h1><p>Nome, identidade e boas-vindas deste servidor.</p></div>
            <div className="server-overview-hero"><span className={`server-overview-icon ${guildIconUrl ? "with-image" : ""}`} style={{ background: guild.iconColor }}>{guildIconUrl ? <img src={guildIconUrl} alt=""/> : guild.name.slice(0, 1).toUpperCase()}</span><div><strong>{guild.name}</strong><span>{guild.memberCount} membros · voce e {roleLabel[guild.role].toLowerCase()}</span></div></div>
            <div className="avatar-settings-card server-icon-editor">
              <div className="avatar-settings-preview"><span className={`server-overview-icon ${guildIconUrl ? "with-image" : ""}`} style={{ background: guild.iconColor }}>{guildIconUrl ? <img src={guildIconUrl} alt=""/> : guild.name.slice(0, 1).toUpperCase()}</span></div>
              <div className="avatar-settings-copy"><strong>Icone do servidor</strong><span>Envie PNG, JPG ou WebP. A imagem e recortada em quadrado e otimizada automaticamente.</span><small>Recomendado: 512 x 512.</small></div>
              <div className="avatar-settings-actions"><label className={`secondary-button avatar-upload-button ${guildIconBusy ? "disabled" : ""}`}><Camera size={16}/> {guildIconBusy ? "Processando..." : "Enviar imagem"}<input type="file" accept="image/png,image/jpeg,image/webp" disabled={guildIconBusy} onChange={(event) => { const file = event.target.files?.[0] ?? null; event.currentTarget.value = ""; void uploadGuildIcon(file); }}/></label>{guildIconUrl && <button type="button" className="ghost-danger-button" disabled={guildIconBusy} onClick={() => void removeGuildIconImage()}><Trash2 size={15}/> Remover</button>}</div>
            </div>
            <div className="server-banner-editor"><div className="server-banner-preview" style={{background:guild.iconColor}}>{guildBannerUrl?<img src={guildBannerUrl} alt="Banner"/>:<><Camera size={26}/><span>Banner da comunidade</span></>}</div><div className="server-banner-actions"><div><strong>Banner do servidor</strong><span>Usado na pagina publica. Recomendado 1600x600.</span></div><label className="secondary-button avatar-upload-button"><Upload size={16}/> {guildBannerBusy?"Processando...":"Enviar banner"}<input type="file" accept="image/png,image/jpeg,image/webp" disabled={guildBannerBusy} onChange={e=>{const f=e.target.files?.[0]??null;e.currentTarget.value="";void uploadGuildBanner(f)}}/></label>{guildBannerUrl&&<button type="button" className="ghost-danger-button" onClick={()=>void removeGuildBannerImage()}><Trash2 size={15}/> Remover</button>}</div></div>
            <div className="settings-form-grid">
              <label>Nome do servidor<input name="name" defaultValue={guild.name} minLength={2} maxLength={64} required /></label>
              <label>Cor principal<input name="iconColor" type="color" defaultValue={guild.iconColor} /></label>
              <label className="full">Descricao<textarea name="description" defaultValue={guild.description ?? ""} maxLength={240} rows={4} /></label>
              <label className="full">Mensagem de boas-vindas<textarea name="welcomeMessage" defaultValue={guild.welcomeMessage ?? ""} maxLength={240} rows={3} /></label><label>Canal de boas-vindas<select name="welcomeChannelId" defaultValue={guild.welcomeChannelId??""}><option value="">Sem canal especifico</option>{guild.channels.filter(c=>["TEXT","ANNOUNCEMENT"].includes(c.type)).map(c=><option key={c.id} value={c.id}>#{c.name}</option>)}</select></label><label className="full">Regras da comunidade<textarea name="rules" defaultValue={guild.rules??""} maxLength={8000} rows={6}/></label>
            </div>
            <section className="settings-card member-system-messages-card">
              <div className="settings-subheading"><div><h2>Entrada e saida de membros</h2><p>O Ginga pode publicar automaticamente no chat quando alguem entra ou sai do servidor.</p></div></div>
              <div className="settings-toggle-list">
                <label className="settings-toggle-row"><div><strong>Mensagem quando um membro entrar</strong><span>Publica uma mensagem do sistema assim que uma nova pessoa entrar pelo convite ou pela comunidade.</span></div><input name="memberJoinMessagesEnabled" type="checkbox" defaultChecked={guild.memberJoinMessagesEnabled !== false}/></label>
                <label className="settings-toggle-row"><div><strong>Mensagem quando um membro sair</strong><span>Tambem funciona para saida voluntaria, expulsao e banimento.</span></div><input name="memberLeaveMessagesEnabled" type="checkbox" defaultChecked={guild.memberLeaveMessagesEnabled !== false}/></label>
              </div>
              <div className="settings-form-grid member-system-channel-grid">
                <label className="full">Canal das mensagens do sistema<select name="memberSystemMessageChannelId" defaultValue={guild.memberSystemMessageChannelId ?? ""}><option value="">Automatico - canal de boas-vindas ou primeiro canal de texto</option>{guild.channels.filter((channel) => ["TEXT", "ANNOUNCEMENT"].includes(channel.type)).map((channel) => <option key={channel.id} value={channel.id}>#{channel.name}</option>)}</select><small>Somente canais de texto e anuncios podem receber essas mensagens.</small></label>
              </div>
            </section>
            <div className="settings-action-row"><button className="primary-button" disabled={busy}><Save size={16} /> Salvar servidor</button></div>
            {guild.role === "OWNER" && <section className="settings-danger-zone"><div><Trash2 size={20}/><span><strong>Excluir servidor</strong><small>Remove canais, mensagens, cargos, convites e configuracoes deste espaco de forma irreversivel.</small></span></div><label>Para confirmar, digite <code>EXCLUIR</code><input value={deleteConfirmation} onChange={(event) => setDeleteConfirmation(event.target.value)} placeholder="EXCLUIR" autoComplete="off" /></label><button type="button" className="danger-button" disabled={busy || deleteConfirmation !== "EXCLUIR"} onClick={() => void deleteGuild()}><Trash2 size={16}/> Excluir servidor permanentemente</button></section>}
          </form>
        )}

        {tab === "community" && (
          <section className="settings-page-section community-settings-page">
            <div className="settings-page-title"><h1>Comunidade e AFK</h1><p>Decida se o servidor aparece no Explorar do Ginga e configure a sala de usuarios ausentes.</p></div>
            <section className="community-settings-card">
              <div className="community-settings-heading"><div className="settings-feature-icon"><Users size={22}/></div><div><strong>Servidor da comunidade</strong><span>Quando habilitado, qualquer usuario do Ginga pode encontrar este servidor em Explorar Comunidades e entrar sem precisar de codigo.</span></div><label className="switch-control"><input type="checkbox" checked={communityEnabled} onChange={(event) => setCommunityEnabled(event.target.checked)}/><i/></label></div>
              {communityEnabled && <div className="settings-form-grid community-public-fields">
                <label>Categoria<input value={communityCategory} onChange={(event) => setCommunityCategory(event.target.value)} maxLength={32} placeholder="Jogos, Tecnologia, Estudos..."/></label>
                <label>Tags<input value={communityTags} onChange={(event) => setCommunityTags(event.target.value)} maxLength={150} placeholder="fps, brasil, competitivo"/><small>Separe por virgula. Maximo de 6.</small></label>
                <div className="full community-discovery-preview"><span className={`server-overview-icon ${guildIconUrl ? "with-image" : ""}`} style={{ background: guild.iconColor }}>{guildIconUrl ? <img src={guildIconUrl} alt=""/> : guild.name.slice(0,1).toUpperCase()}</span><div><small>PREVIA NO EXPLORAR</small><strong>{guild.name}</strong><p>{guild.description || "Adicione uma descricao na Visao geral para apresentar sua comunidade."}</p><div>{communityTags.split(",").map((tag) => tag.trim()).filter(Boolean).slice(0,4).map((tag) => <span key={tag}>#{tag.replace(/^#/, "")}</span>)}</div></div></div>
              </div>}
            </section>
            <section className="community-settings-card afk-settings-card">
              <div className="community-settings-heading"><div className="settings-feature-icon afk"><Headphones size={22}/></div><div><strong>Canal AFK / Ausente</strong><span>Ao habilitar, o Ginga cria automaticamente uma sala de voz chamada <b>Ausente</b>. Usuarios sem atividade sao movidos para ela.</span></div><label className="switch-control"><input type="checkbox" checked={afkEnabled} onChange={(event) => setAfkEnabled(event.target.checked)}/><i/></label></div>
              {afkEnabled && <div className="afk-timeout-row"><label>Tempo sem atividade<select value={afkTimeoutMinutes} onChange={(event) => setAfkTimeoutMinutes(Number(event.target.value))}><option value={5}>5 minutos</option><option value={10}>10 minutos</option><option value={15}>15 minutos</option><option value={30}>30 minutos</option><option value={60}>1 hora</option></select></label><span>{guild.afkChannelId ? "Sala Ausente configurada" : "A sala Ausente sera criada ao salvar"}</span></div>}
            </section>
            <div className="settings-action-row"><button type="button" className="primary-button" disabled={busy} onClick={() => void saveCommunitySettings()}><Save size={16}/> {busy ? "Salvando..." : "Salvar configuracoes"}</button></div>
          </section>
        )}

        {tab === "members" && (
          <section className="settings-page-section">
            <div className="settings-page-title"><h1>Membros e moderacao</h1><p>Hierarquia protegida: ninguem pode moderar cargo igual ou superior ao proprio.</p></div>
            <div className="member-admin-list">
              {members.map((member) => {
                const cannotTarget = member.role === "OWNER" || (guild.role === "ADMIN" && member.role === "ADMIN") || (guild.role === "MODERATOR" && member.role !== "MEMBER");
                return <div className="member-admin-row member-admin-row-v3" key={member.user.id}>
                  <div className="member-admin-identity">
                    <Avatar user={member.user} size="md" />
                    <div className="member-admin-copy"><strong>{member.nickname || member.user.displayName}</strong><span>@{member.user.username} · {roleLabel[member.role]}{member.nickname ? ` · ${member.user.displayName}` : ""}</span>{member.timeoutUntil && new Date(member.timeoutUntil).getTime() > Date.now() && <span className="member-timeout-badge"><Clock3 size={12}/> Timeout ate {new Date(member.timeoutUntil).toLocaleString("pt-BR")}{member.timeoutReason ? ` · ${member.timeoutReason}` : ""}</span>}{(member.serverMuted || member.serverDeafened) && <div className="member-voice-state-chips">{member.serverMuted && <span><MicOff size={12}/> Mutado</span>}{member.serverDeafened && <span><VolumeX size={12}/> Ensurdecido</span>}</div>}{(member.customRoles ?? []).length > 0 && <div className="member-custom-role-chips">{(member.customRoles ?? []).map((customRole) => <span key={customRole.id} style={{ borderColor: customRole.color }}>{customRole.icon ? `${customRole.icon} ` : ""}{customRole.name}</span>)}</div>}</div>
                  </div>
                  <div className="member-admin-controls">
                    <div className="member-admin-role-controls">
                      {guild.permissions.canManageRoles && member.role !== "OWNER" ? (
                        <label className="member-role-select"><span>Cargo base</span><select value={member.role} disabled={busy || cannotTarget} onChange={(event) => void setMemberRole(member, event.target.value as "ADMIN" | "MODERATOR" | "MEMBER")}>
                          {guild.role === "OWNER" && <option value="ADMIN">Administrador</option>}
                          <option value="MODERATOR">Moderador</option><option value="MEMBER">Membro</option>
                        </select></label>
                      ) : <div className="member-role-static"><span>Cargo base</span><strong className="role-chip">{roleLabel[member.role]}</strong></div>}
                      {guild.permissions.canManageRoles && structure.customRoles.length > 0 && <details className="member-role-picker"><summary>Cargos personalizados</summary><div>{structure.customRoles.filter((customRole) => !customRole.managed).map((customRole) => <label key={customRole.id}><input type="checkbox" checked={(member.customRoles ?? []).some((assigned) => assigned.id === customRole.id)} disabled={busy || cannotTarget} onChange={(event) => void setMemberCustomRole(member, customRole.id, event.target.checked)} /><i style={{ background: customRole.color }} /> {customRole.name}</label>)}</div></details>}
                    </div>
                    {member.role !== "OWNER" && <div className="member-moderation-actions">
                      {guild.permissions.canManageNicknames && <button className="secondary-button compact-button" disabled={busy || cannotTarget} onClick={() => { setNicknameTarget(member); setNicknameDraft(member.nickname ?? ""); }}><Pencil size={15}/> Apelido</button>}
                      {guild.permissions.canMuteMembers && <button className="secondary-button compact-button" disabled={busy || cannotTarget} onClick={() => void setVoiceModeration(member, { muted: !Boolean(member.serverMuted) })}><MicOff size={15}/> {member.serverMuted ? "Desmutar" : "Mutar"}</button>}
                      {guild.permissions.canDeafenMembers && <button className="secondary-button compact-button" disabled={busy || cannotTarget} onClick={() => void setVoiceModeration(member, { deafened: !Boolean(member.serverDeafened) })}><VolumeX size={15}/> {member.serverDeafened ? "Reativar audio" : "Ensurdecer"}</button>}
                      {(guild.permissions.canManageMembers || guild.permissions.canKickMembers) && (member.timeoutUntil && new Date(member.timeoutUntil).getTime() > Date.now()
                        ? <button className="secondary-button compact-button" disabled={busy || cannotTarget} onClick={() => void removeTimeout(member)}><Clock3 size={15} /> Tirar timeout</button>
                        : <button className="secondary-button compact-button" disabled={busy || cannotTarget} onClick={() => setTimeoutTarget(member)}><Clock3 size={15} /> Timeout</button>)}
                      {guild.permissions.canKickMembers && <button className="secondary-button compact-button" disabled={busy || cannotTarget} onClick={() => { setKickTarget(member); setKickReason(""); }}><UserMinus size={15} /> Expulsar</button>}
                      {guild.permissions.canBanMembers && <button className="danger-button compact-button" disabled={busy || cannotTarget} onClick={() => { setBanTarget(member); setBanDuration("7D"); setBanReason(""); setBanDeleteMessageMinutes(0); }}><Ban size={15} /> Banir</button>}
                    </div>}
                  </div>
                </div>;
              })}
            </div>
          </section>
        )}

        {tab === "roles" && (
          <section className="settings-page-section roles-settings-page">
            <div className="settings-page-title"><h1>Cargos e permissoes</h1><p>Organize a hierarquia, defina o que cada cargo pode fazer e controle o acesso aos canais sem misturar tudo na mesma tela.</p></div>
            <div className="role-base-strip">
              {(["OWNER", "ADMIN", "MODERATOR", "MEMBER"] as GuildRole[]).map((role) => <article className={`role-base-pill role-${role.toLowerCase()}`} key={role}><span>{roleLabel[role]}</span><strong>{roleCounts[role]}</strong><small>{roleDescription[role]}</small>{developerMode && <button type="button" className="role-base-copy-id" title={`Copiar ID do cargo ${roleLabel[role]}`} onClick={() => void copyTextToClipboard(builtinGuildRoleId(guild.id, role)).then(() => setNotice(`ID do cargo ${roleLabel[role]} copiado`)).catch(() => setError("Nao foi possivel copiar o ID do cargo"))}><Copy size={13}/> ID</button>}</article>)}
            </div>

            <CustomRolesPanel
              guildId={guild.id}
              structure={structure}
              members={members}
              busy={busy}
              onBusy={setBusy}
              onStructureRefresh={loadStructure}
              onMembersRefresh={onMembersRefresh}
              onGuildsRefresh={onGuildsRefresh}
              onNotice={setNotice}
              onError={setError}
            />

            <details className="role-advanced-panel">
              <summary><div><strong>Permissoes base e diagnostico</strong><span>Configuracoes avancadas dos cargos Moderador/Membro e simulador de acesso.</span></div><span className="role-advanced-badge">Avancado</span></summary>
              <div className="role-advanced-content">
                <div className="permission-simulator">
                  <div className="settings-subheading"><div><h2>Simulador de acesso</h2><p>Veja o resultado final das permissoes para um membro antes de alterar a estrutura.</p></div></div>
                  <div className="permission-simulator-controls">
                    <select value={previewUserId} onChange={(event) => { const userId = event.target.value; setPreviewUserId(userId); setPermissionPreview(null); if (userId) void loadPermissionPreview(userId); }}><option value="">Selecione um membro...</option>{members.map((member) => <option key={member.user.id} value={member.user.id}>{member.user.displayName} (@{member.user.username})</option>)}</select>
                    <button className="secondary-button" disabled={!previewUserId || previewBusy} onClick={() => void loadPermissionPreview()}>{previewBusy ? "Calculando..." : "Recalcular"}</button>
                  </div>
                  {permissionPreview && <div className="permission-preview-grid"><article><span className="eyebrow">ACESSO EFETIVO</span><strong>{roleLabel[permissionPreview.membership.role]}</strong><div className="permission-chip-cloud">{guildPermissionLabels.filter((item) => permissionPreview.permissions[item.key]).map((item) => <span key={item.key}>{item.title}</span>)}{guildPermissionLabels.every((item) => !permissionPreview.permissions[item.key]) && <small>Sem permissoes administrativas extras.</small>}</div></article><article><span className="eyebrow">CARGOS APLICADOS</span><strong>{permissionPreview.customRoles.length} personalizado{permissionPreview.customRoles.length === 1 ? "" : "s"}</strong><div className="member-custom-role-chips">{permissionPreview.customRoles.map((role) => <span key={role.id} style={{ borderColor: role.color }}>{role.icon ? `${role.icon} ` : ""}{role.name}</span>)}{permissionPreview.customRoles.length === 0 && <small>Nenhum cargo personalizado.</small>}</div></article><article className="permission-preview-channels"><span className="eyebrow">CANAIS VISIVEIS</span><strong>{permissionPreview.visibleChannels.length} de {structure.channels.length}</strong><div>{permissionPreview.visibleChannels.map((channel) => <span key={channel.id}>{channelTypeIcon(channel.type)} {channel.name}</span>)}</div></article></div>}
                </div>

                <section className="user-permission-override-card"><div className="settings-subheading"><div><h2>Excecao por usuario</h2><p>Regra mais especifica para um membro, sem criar cargo novo.</p></div></div><div className="user-override-controls"><label>Membro<select value={overrideUserId} onChange={e=>{const v=e.target.value;setOverrideUserId(v);if(v&&overrideResourceId)void loadUserPermissionOverride(overrideScope,overrideResourceId,v)}}><option value="">Selecione...</option>{members.map(m=><option key={m.user.id} value={m.user.id}>{m.user.displayName} (@{m.user.username})</option>)}</select></label><label>Nivel<select value={overrideScope} onChange={e=>{setOverrideScope(e.target.value as "channel"|"category");setOverrideResourceId("");setUserPermissionOverride({...emptyUserPermissionOverride})}}><option value="channel">Canal</option><option value="category">Categoria</option></select></label><label>Destino<select value={overrideResourceId} onChange={e=>{const v=e.target.value;setOverrideResourceId(v);if(v&&overrideUserId)void loadUserPermissionOverride(overrideScope,v,overrideUserId)}}><option value="">Selecione...</option>{(overrideScope==="channel"?structure.channels:structure.categories).map(i=><option key={i.id} value={i.id}>{i.name}</option>)}</select></label></div><div className="user-override-permissions">{([['canView','Ver'],['canSendMessages','Enviar mensagens'],['canConnect','Entrar na voz']] as Array<[keyof UserPermissionOverride,string]>).map(([key,label])=><label key={key}><strong>{label}</strong><select value={overrideValue(userPermissionOverride[key])} onChange={e=>setUserPermissionOverride(v=>({...v,[key]:parseOverrideValue(e.target.value)}))}><option value="inherit">Herdar</option><option value="allow">Permitir</option><option value="deny">Bloquear</option></select></label>)}</div><div className="settings-action-row"><button type="button" className="primary-button" disabled={overrideBusy||!overrideUserId||!overrideResourceId} onClick={()=>void saveUserPermissionOverride()}><Save size={15}/> Salvar excecao</button><button type="button" className="secondary-button" disabled={overrideBusy||!overrideUserId||!overrideResourceId} onClick={()=>void saveUserPermissionOverride({...emptyUserPermissionOverride})}>Voltar a herdar</button></div></section>

                <div className="base-permission-columns">
                  {(["MODERATOR", "MEMBER"] as const).map((role) => { const permission = rolePermissionFor(role); return <section className="permission-role-card" key={role}><div className="permission-role-card-head"><div><strong>{role === "MODERATOR" ? "Moderadores" : "Membros"}</strong><span>Permissoes gerais herdadas antes dos cargos personalizados.</span></div></div><div className="settings-toggle-list">{guildPermissionLabels.map((item) => <label className="settings-toggle-row" key={item.key}><div><strong>{item.title}</strong><span>{item.description}</span></div><input type="checkbox" checked={Boolean(permission[item.key])} onChange={() => void toggleGuildPermission(role, item.key)} /></label>)}</div></section>; })}
                </div>

                <div className="role-access-caption"><strong>Permissoes base por canal</strong><span>Compatibilidade para Moderador e Membro. Cargos personalizados podem adicionar regras especificas.</span></div>
                <div className="permission-matrix compact-permission-matrix">{structure.channels.map((channel) => <div className="permission-channel-card" key={channel.id}><div className="permission-channel-head">{channelTypeIcon(channel.type)}<div><strong>{channel.name}</strong><span>{channelTypeLabel(channel.type)}</span></div></div>{(["MODERATOR", "MEMBER"] as const).map((role) => { const permission = permissionFor(channel, role); return <div className="permission-line" key={role}><strong>{role === "MODERATOR" ? "Moderadores" : "Membros"}</strong><label><input type="checkbox" checked={permission.canView} onChange={() => void toggleChannelPermission(channel, role, "canView")} /> Ver</label>{channel.type === "VOICE" ? <label><input type="checkbox" checked={permission.canConnect} onChange={() => void toggleChannelPermission(channel, role, "canConnect")} /> Entrar</label> : <label><input type="checkbox" checked={permission.canSendMessages} onChange={() => void toggleChannelPermission(channel, role, "canSendMessages")} /> Enviar</label>}</div>; })}</div>)}</div>
              </div>
            </details>
          </section>
        )}

        {tab === "channels" && (
          <section className="settings-page-section">
            <div className="settings-page-title"><h1>Canais</h1><p>Tipos disponiveis: texto, voz, anuncios, forum e eventos. A organizacao por categorias fica na barra lateral.</p></div>
            <div className="channel-admin-list">
              {structure.channels.map((channel) => <div className="channel-admin-row" key={channel.id}>
                <span className="channel-admin-icon">{channelTypeIcon(channel.type)}</span>
                {editingChannelId === channel.id ? <input value={editingChannelName} onChange={(event) => setEditingChannelName(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void renameChannel(channel); if (event.key === "Escape") setEditingChannelId(""); }} autoFocus /> : <div><strong>{channel.name}</strong><span>{channelTypeLabel(channel.type)}</span></div>}
                {editingChannelId === channel.id ? <button className="secondary-button compact-button" disabled={busy} onClick={() => void renameChannel(channel)}>Salvar</button> : <button className="secondary-button compact-button" onClick={() => { setEditingChannelId(channel.id); setEditingChannelName(channel.name); }}>Editar</button>}
                {guild.permissions.canManageChannels && <button className="danger-icon-button" disabled={busy} onClick={() => void deleteChannel(channel)} aria-label="Excluir canal"><Trash2 size={17} /></button>}
              </div>)}
            </div>
          </section>
        )}

        {tab === "integrations" && (
          <section className="settings-page-section">
            <div className="settings-page-title"><h1>Integracoes</h1><p>Bots e webhooks conectam servicos ao servidor sem misturar credenciais pessoais.</p></div>

            {guild.permissions.canManageBots && <section className="integration-settings-block">
              <div className="settings-subheading"><div><h2>Bots instalados</h2><p>Aplicacoes autorizadas neste servidor.</p></div></div>
              <div className="integration-list">
                {botInstalls.length === 0 && <div className="settings-empty-state">Nenhum bot instalado neste servidor.</div>}
                {botInstalls.map((install) => <article className="integration-row" key={install.id}><div className="integration-icon" style={{ background: install.application.iconColor }}><Bot size={20}/></div><div><strong>{install.application.name}</strong><span>{install.application.botUser ? `@${install.application.botUser.username}` : "Bot"} · instalado por {install.installedBy.displayName}</span><small>{install.permissions.length ? install.permissions.join(" · ") : "Sem permissoes adicionais"}</small></div><button className="danger-button compact-button" disabled={busy} onClick={() => void removeBot(install)}>Remover</button></article>)}
              </div>
            </section>}

            {guild.permissions.canManageWebhooks && <section className="integration-settings-block webhook-settings-block">
              <div className="settings-subheading"><div><h2>Webhooks</h2><p>Conecte monitoramento, CI/CD ou qualquer sistema HTTP para publicar mensagens automaticamente em um canal.</p></div></div>
              <div className="webhook-create-explainer"><Webhook size={20}/><div><strong>Como criar um webhook</strong><p>Escolha um nome e o canal de destino. Ao criar, o Ginga mostra um <b>endpoint</b> e um <b>segredo</b> que voce copia para o sistema externo.</p></div></div>
              <form className="webhook-create-grid" onSubmit={createWebhook}>
                <label><span>1. Nome</span><input name="name" required minLength={2} maxLength={64} placeholder="Ex.: Zabbix, Deploy, Alertas" /><small>Identifica quem esta enviando.</small></label>
                <label><span>2. Canal</span><select name="channelId" required defaultValue=""><option value="" disabled>Escolha o canal de destino</option>{structure.channels.filter((channel) => ["TEXT","ANNOUNCEMENT"].includes(channel.type)).map((channel) => <option key={channel.id} value={channel.id}>#{channel.name}</option>)}</select><small>As mensagens serao publicadas aqui.</small></label>
                <button className="primary-button" disabled={busy}><Webhook size={16}/> 3. Criar webhook</button>
              </form>
              {webhookReveal && <div className="webhook-secret-reveal"><KeyRound size={18}/><div><strong>Segredo do webhook</strong><code>{webhookReveal.token}</code><small>Endpoint: {webhookReveal.endpoint}<br/>Use <code>Authorization: Bearer &lt;token&gt;</code>. O segredo nao e colocado na URL.</small></div><div className="webhook-secret-actions"><button type="button" className="secondary-button" onClick={() => void navigator.clipboard.writeText(webhookReveal.token).then(() => setNotice("Segredo copiado"))}><Copy size={15}/> Segredo</button><button type="button" className="secondary-button" onClick={() => void navigator.clipboard.writeText(webhookReveal.endpoint).then(() => setNotice("Endpoint copiado"))}><Copy size={15}/> Endpoint</button></div></div>}
              <div className="webhook-admin-list">
                {webhooks.length === 0 && <div className="settings-empty-state">Nenhum webhook configurado.</div>}
                {webhooks.map((webhook) => <article key={webhook.id}><div className="integration-icon"><Webhook size={18}/></div><div><strong>{webhook.name}</strong><span>#{webhook.channel?.name ?? "canal"} · segredo {webhook.tokenPrefix}••••</span></div><div className="webhook-row-actions"><button type="button" onClick={() => void resetWebhook(webhook)} aria-label={`Rotacionar segredo de ${webhook.name}`}><RefreshCw size={15}/></button><button type="button" className="danger" onClick={() => void removeWebhook(webhook)} aria-label={`Excluir webhook ${webhook.name}`}><Trash2 size={15}/></button></div></article>)}
              </div>
            </section>}
          </section>
        )}

        {tab === "music" && (
          <section className="settings-page-section music-settings-page">
            <div className="settings-page-title"><span className="settings-eyebrow">RECURSO NATIVO</span><h1>Ginga Music</h1><p>Musica compartilhada nas salas de voz, com fila sincronizada para todo mundo conectado.</p></div>
            {!musicSettings ? <div className="settings-empty-state">Carregando configuracoes do Ginga Music...</div> : <>
              <div className={`music-settings-hero ${musicSettings.enabled ? "enabled" : ""}`}>
                <div className="music-settings-hero-icon"><Music2 size={26}/></div>
                <div><small>BOT NATIVO DO GINGA</small><h2>{musicSettings.enabled ? "Ginga Music esta ativo" : "Ative musica neste servidor"}</h2><p>O bot aparece como participante virtual na sala de voz e sincroniza play, pause, pular, repetir e fila. Volume e mute ficam individuais para cada usuario.</p></div>
                <label className="music-master-switch"><input type="checkbox" checked={musicSettings.enabled} onChange={(event) => setMusicSettings({ ...musicSettings, enabled: event.target.checked })}/><span>{musicSettings.enabled ? "Ativado" : "Desativado"}</span></label>
              </div>

              <div className="settings-card music-provider-card">
                <div className="settings-subheading"><div><h2>Fontes de musica</h2><p>O Ginga usa players oficiais no cliente. Ele nao baixa nem re-hospeda audio dos provedores.</p></div></div>
                <div className="music-provider-grid">
                  <article><span className="music-provider-logo youtube">YT</span><div><strong>YouTube</strong><span>Links de videos individuais</span><small className="status-ok">Pronto</small></div></article>
                  <article><span className="music-provider-logo youtube">PL</span><div><strong>Playlists e busca do YouTube</strong><span>Ate {musicSettings.maxPlaylistItems} itens por playlist</span><small className={musicSettings.youtubeSearchEnabled ? "status-ok" : "status-warn"}>{musicSettings.youtubeSearchEnabled ? "API configurada" : "Configure YOUTUBE_API_KEY"}</small></div></article>
                  <article><span className="music-provider-logo soundcloud">SC</span><div><strong>SoundCloud</strong><span>Links, faixas e pesquisa nativa</span><small className={musicSettings.soundcloudSearchEnabled ? "status-ok" : "status-warn"}>{musicSettings.soundcloudSearchEnabled ? "API configurada" : "Configure credenciais SoundCloud"}</small></div></article>
                </div>
              </div>

              <div className="settings-card">
                <div className="settings-subheading"><div><h2>Comportamento</h2><p>Defina quem controla a fila e onde o bot entra por padrao.</p></div></div>
                <div className="settings-toggle-list">
                  <label className="settings-toggle-row"><div><strong>Permitir que membros controlem a musica</strong><span>Quando desativado, somente administracao e cargos com gerenciamento de bots/servidor podem adicionar, pausar ou pular.</span></div><input type="checkbox" checked={musicSettings.allowMembers} onChange={(event) => setMusicSettings({ ...musicSettings, allowMembers: event.target.checked })}/></label>
                </div>
                <div className="settings-form-grid music-settings-grid">
                  <label>Canal de voz padrao<select value={musicSettings.defaultVoiceChannelId ?? ""} onChange={(event) => setMusicSettings({ ...musicSettings, defaultVoiceChannelId: event.target.value || null })}><option value="">Nenhum - entrar na sala atual</option>{guild.channels.filter((item) => item.type === "VOICE").map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
                  <label>Volume padrao para novos usuarios <strong className="inline-value">{musicSettings.defaultVolume}%</strong><input className="settings-range" type="range" min="0" max="100" step="5" value={musicSettings.defaultVolume} onChange={(event) => setMusicSettings({ ...musicSettings, defaultVolume: Number(event.target.value) })}/><small className="settings-field-hint">Depois cada usuario controla o proprio volume sem alterar o som dos outros.</small></label>
                </div>
              </div>

              <div className="music-settings-note"><Music2 size={18}/><div><strong>Como usar</strong><span>Ative aqui, entre em uma sala de voz e abra o painel Ginga Music. Cole um link do YouTube/SoundCloud ou use as buscas separadas do YouTube e SoundCloud quando as APIs estiverem configuradas.</span></div></div>
              <div className="settings-action-row"><button type="button" className="primary-button" disabled={busy} onClick={() => void saveMusicSettings()}><Save size={16}/> Salvar Ginga Music</button></div>
            </>}
          </section>
        )}

        {tab === "security" && (
          <section className="settings-page-section server-security-page">
            <div className="settings-page-title"><h1>Seguranca do servidor</h1><p>Ferramentas que voce controla para reduzir spam, invasoes de comunidade e abuso de permissoes.</p></div>
            {!securityOverview ? <div className="settings-empty-state">Analisando configuracoes de seguranca...</div> : <>
              <div className={`security-score-card level-${securityOverview.level.toLowerCase()}`}>
                <div className="security-score-ring"><strong>{securityOverview.score}</strong><span>/100</span></div>
                <div><small>NIVEL ATUAL</small><h2>{securityOverview.level === "FORTE" ? "Protecao forte" : securityOverview.level === "ATENCAO" ? "Vale revisar alguns pontos" : "Protecao baixa"}</h2><p>{securityOverview.level === "FORTE" ? "As configuracoes principais deste servidor estao bem protegidas." : "Veja as recomendacoes abaixo e ajuste o que fizer sentido para sua comunidade."}</p></div>
                <button className="secondary-button compact-button" type="button" onClick={() => void loadSecurityOverview()}><RefreshCw size={15}/> Reavaliar</button>
              </div>
              <div className={`lockdown-control-card ${securityOverview.lockdown.enabled ? "active" : ""}`}>
                <div className="lockdown-control-icon"><ShieldAlert size={21}/></div>
                <div className="lockdown-control-copy">
                  <small>RESPOSTA A RAID / ABUSO</small>
                  <strong>{securityOverview.lockdown.enabled ? "Modo de contencao ATIVO" : "Modo de contencao pronto"}</strong>
                  <p>{securityOverview.lockdown.enabled ? (securityOverview.lockdown.reason || "Mensagens e voz estao bloqueadas para membros comuns.") : "Em uma emergencia, bloqueia envio de mensagens e entrada em voz de membros comuns. Administradores e moderadores continuam operando."}</p>
                  {!securityOverview.lockdown.enabled && guild.permissions.canManageServer && <input value={lockdownReason} maxLength={160} onChange={(event) => setLockdownReason(event.target.value)} placeholder="Motivo opcional: raid, spam coordenado, incidente..." />}
                </div>
                {guild.permissions.canManageServer && <button className={securityOverview.lockdown.enabled ? "danger-button compact-button" : "secondary-button compact-button"} disabled={busy} type="button" onClick={() => void setLockdown(!securityOverview.lockdown.enabled)}>{securityOverview.lockdown.enabled ? "Desativar contencao" : "Ativar contencao"}</button>}
              </div>
              <div className="security-metrics-grid">
                <article><ShieldCheck size={18}/><strong>{securityOverview.metrics.enabledAutoModRules}</strong><span>regras AutoMod ativas</span></article>
                <article><Link2 size={18}/><strong>{securityOverview.metrics.activeUnlimitedInvites}</strong><span>convites ilimitados</span></article>
                <article><Bot size={18}/><strong>{securityOverview.metrics.bots}</strong><span>bots instalados</span></article>
                <article><Webhook size={18}/><strong>{securityOverview.metrics.webhooks}</strong><span>webhooks ativos</span></article>
                <article><Users size={18}/><strong>{securityOverview.metrics.privilegedMembers}</strong><span>moderadores e admins</span></article>
              </div>
              <div className="security-check-list">
                {securityOverview.checks.map((check) => <article className={`security-check status-${check.status.toLowerCase()}`} key={check.id}><span className="security-check-icon">{check.status === "PASS" ? <ShieldCheck size={18}/> : <ShieldAlert size={18}/>}</span><div><strong>{check.title}</strong><p>{check.detail}</p>{check.action && <small>Recomendacao: {check.action}</small>}</div><span className="security-check-state">{check.status === "PASS" ? "OK" : check.status === "WARN" ? "ATENCAO" : "CRITICO"}</span></article>)}
              </div>
            </>}
          </section>
        )}

        {tab === "automod" && (
          <section className="settings-page-section">
            <div className="settings-page-title"><h1>AutoMod</h1><p>Bloqueio acontece no backend antes da mensagem ser persistida ou distribuida aos clientes.</p></div>
            <form className="automod-create-grid" onSubmit={createAutoMod}>
              <label>Nome<input name="name" required maxLength={64} placeholder="Anti-spam principal"/></label>
              <label>Tipo<select name="type"><option value="KEYWORDS">Palavras bloqueadas</option><option value="MENTION_SPAM">Spam de mencoes</option><option value="INVITE_SPAM">Convites externos</option><option value="REPETITION">Repeticao</option></select></label>
              <label className="full">Palavras, separadas por virgula<input name="blockedTerms" placeholder="termo1, termo2, termo3"/></label>
              <label>Limite de mencoes<input name="mentionLimit" type="number" min="1" max="100" placeholder="5"/></label>
              <label>Limite de repeticao<input name="repetitionLimit" type="number" min="2" max="20" placeholder="4"/></label>
              <button className="primary-button" disabled={busy}><ShieldAlert size={16}/> Criar regra</button>
            </form>
            <div className="automod-rule-list">{autoModRules.length === 0 && <div className="settings-empty-state">Nenhuma regra AutoMod configurada.</div>}{autoModRules.map((rule) => <article key={rule.id}><div><strong>{rule.name}</strong><span>{rule.type.replaceAll("_", " ")}{rule.blockedTerms.length ? ` · ${rule.blockedTerms.length} termos` : ""}</span></div><label className="switch-row compact"><input type="checkbox" checked={rule.enabled} onChange={() => void toggleAutoMod(rule)}/> Ativa</label><button className="danger-icon-button" onClick={() => void deleteAutoMod(rule.id)}><Trash2 size={16}/></button></article>)}</div>
          </section>
        )}

        {tab === "insights" && (
          <section className="settings-page-section">
            <div className="settings-page-title"><h1>Insights operacionais</h1><p>Um painel leve para administracao: atividade, comunidade, moderacao e integracoes.</p></div>
            {insights ? <div className="insights-grid">
              <article><Users/><strong>{insights.members}</strong><span>Membros</span></article>
              <article><Hash/><strong>{insights.channels}</strong><span>Canais</span></article>
              <article><MessageSquareText/><strong>{insights.messages24h}</strong><span>Mensagens 24h</span></article>
              <article><MessageSquareText/><strong>{insights.messages7d}</strong><span>Mensagens 7d</span></article>
              <article><MessageSquareText/><strong>{insights.forumPosts7d}</strong><span>Topicos 7d</span></article>
              <article><CalendarDays/><strong>{insights.eventsUpcoming}</strong><span>Eventos futuros</span></article>
              <article><Ban/><strong>{insights.bans}</strong><span>Bans ativos</span></article>
              <article><Bot/><strong>{insights.bots}</strong><span>Bots</span></article>
            </div> : <div className="settings-empty-state">Carregando metricas...</div>}
            <div className="qol-callout"><BadgeCheck size={20}/><div><strong>QoL: leitura rapida</strong><p>O objetivo aqui nao e virar um BI pesado; e responder em segundos se o servidor esta ativo, crescendo ou com problemas de moderacao.</p></div></div>
          </section>
        )}

        {tab === "templates" && (
          <section className="settings-page-section">
            <div className="settings-page-title"><h1>Modelos e portabilidade</h1><p>Exporte a estrutura do servidor sem mensagens e dados pessoais. Depois voce pode criar outro servidor com a mesma base.</p></div>
            <div className="template-actions"><button className="primary-button" disabled={!templateJson} onClick={downloadTemplate}><Download size={16}/> Baixar modelo JSON</button><label className="secondary-button file-button"><Upload size={16}/> Criar servidor a partir de modelo<input type="file" accept="application/json,.json" hidden onChange={(event) => void importTemplate(event.target.files?.[0] ?? null)}/></label></div>
            <div className="qol-callout"><ShieldCheck size={20}/><div><strong>Backup sem carregar conversa junto</strong><p>O modelo leva categorias, canais, cargos personalizados e regras AutoMod. Historico, membros e segredos nao sao exportados.</p></div></div>
            <textarea className="template-preview" readOnly value={templateJson} rows={18}/>
          </section>
        )}

        {tab === "invites" && (
          <section className="settings-page-section">
            <div className="settings-page-title"><h1>Convites</h1><p>Codigos podem expirar e ter limite de uso.</p></div>
            {guild.permissions.canCreateInvites && <form className="invite-create-panel" onSubmit={createInvite}><label>Validade<select name="expiresInMinutes" defaultValue="10080"><option value="30">30 minutos</option><option value="60">1 hora</option><option value="360">6 horas</option><option value="720">12 horas</option><option value="1440">1 dia</option><option value="10080">7 dias</option><option value="0">Nunca expira</option></select></label><label>Limite de usos<select name="maxUses" defaultValue="0"><option value="0">Ilimitado</option><option value="1">1 uso</option><option value="5">5 usos</option><option value="10">10 usos</option><option value="25">25 usos</option><option value="50">50 usos</option><option value="100">100 usos</option></select></label><button className="primary-button" disabled={busy}><Link2 size={16} /> Criar convite</button></form>}
            {guild.permissions.canManageInvites ? <div className="invite-admin-list">
              {invites.length === 0 && <div className="settings-empty-state">Nenhum convite ativo.</div>}
              {invites.map((invite) => { const expired = Boolean(invite.expiresAt && new Date(invite.expiresAt).getTime() < Date.now()); return <div className={`invite-admin-row ${expired ? "expired" : ""}`} key={invite.code}><code>{invite.code}</code><div><strong>{expired ? "Expirado" : "Ativo"}</strong><span>{invite.uses}{invite.maxUses ? `/${invite.maxUses}` : ""} usos · {invite.expiresAt ? `expira ${new Date(invite.expiresAt).toLocaleString("pt-BR")} · ` : "sem expiracao · "}{invite.createdBy.displayName}</span></div><button className="round-action" onClick={() => void copyInvite(invite.code)} aria-label="Copiar convite"><Copy size={16} /></button><button className="danger-icon-button" disabled={busy} onClick={() => void revokeInvite(invite.code)} aria-label="Revogar convite"><Trash2 size={16} /></button></div>; })}
            </div> : <div className="settings-empty-state">Voce pode criar convites, mas nao listar ou revogar convites de outras pessoas.</div>}
          </section>
        )}

        {tab === "bans" && (
          <section className="settings-page-section">
            <div className="settings-page-title"><h1>Lista de banidos</h1><p>Banimentos expirados sao limpos automaticamente quando esta lista e consultada.</p></div>
            <div className="member-admin-list">
              {bans.length === 0 && <div className="settings-empty-state">Nao ha usuarios banidos.</div>}
              {bans.map((ban) => <div className="ban-admin-row" key={ban.id}><div className="member-admin-identity"><Avatar user={ban.user} size="md" /><div className="member-admin-copy"><strong>{ban.user.displayName}</strong><span>@{ban.user.username} · {ban.expiresAt ? `ate ${new Date(ban.expiresAt).toLocaleString("pt-BR")}` : "permanente"}{ban.reason ? ` · ${ban.reason}` : ""}</span></div></div><button className="secondary-button compact-button" disabled={busy} onClick={() => void unban(ban.userId, ban.user.displayName)}>Desbanir</button></div>)}
            </div>
          </section>
        )}

        {tab === "audit" && (
          <section className="settings-page-section">
            <div className="settings-page-title"><h1>Auditoria</h1><p>Registro das acoes administrativas. O IP bruto nao e armazenado; apenas um identificador HMAC para correlacao.</p></div>
            <div className="audit-filter-bar"><label>Buscar<input value={auditSearch} onChange={(event) => setAuditSearch(event.target.value)} placeholder="Moderador, usuario ou acao" /></label><label>Acao<select value={auditAction} onChange={(event) => setAuditAction(event.target.value)}><option value="">Todas</option>{auditActionOptions.map((action) => <option key={action} value={action}>{auditLabel(action)}</option>)}</select></label></div>
            <div className="audit-list">
              {filteredAuditLogs.length === 0 && <div className="settings-empty-state">Nenhum evento encontrado.</div>}
              {filteredAuditLogs.map((log) => { const targetMember = log.targetUserId ? members.find((member) => member.user.id === log.targetUserId) : null; const targetUser = targetMember?.user ?? log.targetUser ?? null; return <div className="audit-row" key={log.id}><ScrollText size={17} /><div><strong>{auditLabel(log.action)}</strong><span>{log.actor?.displayName ?? "Sistema"} · {new Date(log.createdAt).toLocaleString("pt-BR")}</span>{log.targetUserId && <small>Alvo: {targetUser ? `${targetMember?.nickname || targetUser.displayName} (@${targetUser.username})` : log.targetUserId}</small>}</div></div>; })}
            </div>
          </section>
        )}
      </SettingsShell>

      {kickTarget && <Modal title={`Expulsar ${kickTarget.user.displayName}`} onClose={() => { if (!busy) { setKickTarget(null); setKickReason(""); } }} width="sm"><div className="stack-form"><p className="muted-copy">O membro sera removido do servidor, mas podera entrar novamente com um novo convite.</p><label>Motivo<textarea rows={4} maxLength={500} value={kickReason} onChange={(event) => setKickReason(event.target.value)} placeholder="Opcional, mas recomendado para auditoria" /></label><div className="modal-actions"><button className="secondary-button" disabled={busy} onClick={() => { setKickTarget(null); setKickReason(""); }}>Cancelar</button><button className="danger-button" disabled={busy} onClick={() => void kickMember()}><UserMinus size={16}/> Expulsar</button></div></div></Modal>}

      {nicknameTarget && <Modal title={`Apelido de ${nicknameTarget.user.displayName}`} onClose={() => { if (!busy) setNicknameTarget(null); }} width="sm"><div className="stack-form"><p className="muted-copy">O apelido aparece apenas neste servidor. Deixe vazio para voltar ao nome normal da conta.</p><label>Apelido<input value={nicknameDraft} maxLength={32} onChange={(event) => setNicknameDraft(event.target.value)} placeholder={nicknameTarget.user.displayName} autoFocus /></label><div className="modal-actions"><button className="secondary-button" disabled={busy} onClick={() => setNicknameTarget(null)}>Cancelar</button><button className="primary-button" disabled={busy} onClick={() => void saveNickname()}><Save size={16}/> Salvar apelido</button></div></div></Modal>}

      {timeoutTarget && <Modal title={`Aplicar timeout em ${timeoutTarget.user.displayName}`} onClose={() => setTimeoutTarget(null)} width="sm"><div className="stack-form"><p className="muted-copy">Durante o timeout o membro continua no servidor, mas nao consegue enviar mensagens nem entrar em salas de voz.</p><label>Duracao<select value={timeoutDurationMinutes} onChange={(event) => setTimeoutDurationMinutes(Number(event.target.value))}><option value={5}>5 minutos</option><option value={10}>10 minutos</option><option value={30}>30 minutos</option><option value={60}>1 hora</option><option value={360}>6 horas</option><option value={1440}>24 horas</option><option value={10080}>7 dias</option></select></label><label>Motivo<textarea rows={4} maxLength={300} value={timeoutReason} onChange={(event) => setTimeoutReason(event.target.value)} placeholder="Opcional, mas recomendado para auditoria" /></label><div className="modal-actions"><button className="secondary-button" onClick={() => setTimeoutTarget(null)}>Cancelar</button><button className="primary-button" disabled={busy} onClick={() => void applyTimeout()}><Clock3 size={16} /> Aplicar timeout</button></div></div></Modal>}

      {banTarget && <Modal title={`Banir ${banTarget.user.displayName}`} onClose={() => { setBanTarget(null); setBanReason(""); setBanDeleteMessageMinutes(0); }} width="sm"><div className="stack-form"><p className="muted-copy">O usuario sera removido imediatamente das conexoes atuais e nao podera usar convite enquanto o ban estiver ativo.</p><label>Duracao<select value={banDuration} onChange={(event) => setBanDuration(event.target.value as BanDuration)}><option value="1H">1 hora</option><option value="24H">24 horas</option><option value="7D">7 dias</option><option value="30D">30 dias</option><option value="PERMANENT">Permanente</option></select></label><label>Excluir mensagens recentes<select value={banDeleteMessageMinutes} onChange={(event) => setBanDeleteMessageMinutes(Number(event.target.value))}><option value={0}>Nenhuma</option><option value={60}>Ultima hora</option><option value={360}>Ultimas 6 horas</option><option value={1440}>Ultimas 24 horas</option><option value={10080}>Ultimos 7 dias</option></select></label><label>Motivo<textarea rows={4} maxLength={500} value={banReason} onChange={(event) => setBanReason(event.target.value)} placeholder="Opcional" /></label><div className="modal-actions"><button className="secondary-button" onClick={() => setBanTarget(null)}>Cancelar</button><button className="danger-button" disabled={busy} onClick={() => void banMember()}><Ban size={16} /> Confirmar banimento</button></div></div></Modal>}
    </>
  );
}
