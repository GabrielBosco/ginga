import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import {
  Activity, Ban, Bot, Building2, Check, ChevronRight, Clipboard, Clock3, Eye, EyeOff,
  Laptop, LayoutDashboard, LogOut, Mail, Megaphone, Power, PowerOff, RefreshCw, Search,
  ScrollText, ShieldAlert, ShieldCheck, Trash2, UserCog, Users, X
} from "lucide-react";
import { api } from "../lib/api";
import type { PlatformAnnouncement, SystemRole, User } from "../types";
import { Avatar } from "./Avatar";
import { UserBadges } from "./UserBadges";

interface Overview {
  users: number;
  humans: number;
  bots: number;
  guilds: number;
  messages: number;
  directMessages: number;
  webhooks: number;
  applications: number;
  version: string;
}

interface AdminUser extends User {
  email: string;
  lastLoginAt?: string | null;
  accountDisabled?: boolean;
  accountDisabledAt?: string | null;
  accountDisabledReason?: string;
  online?: boolean;
  twoFactorEnabled?: boolean;
}

interface AdminSession {
  id: string;
  createdAt: string;
  lastSeenAt: string;
  revokedAt: string | null;
  ipHash: string | null;
  userAgent: string;
}

interface AdminModerationLog {
  id: string;
  action: string;
  createdAt: string;
  metadata?: Record<string, unknown> | null;
  guild: { id: string; name: string };
  actor?: { id: string; username: string; displayName: string; avatarColor: string } | null;
}

interface AdminActiveBan {
  id: string;
  reason: string;
  expiresAt: string | null;
  createdAt: string;
  guild: { id: string; name: string };
  bannedBy: { id: string; username: string; displayName: string; avatarColor: string };
}

interface AdminGuild {
  id: string;
  name: string;
  description?: string;
  createdAt: string;
  owner: { id: string; username: string; displayName: string };
  _count: { members: number; channels: number; bans: number; botInstalls: number };
}

interface PlatformAudit {
  id: string;
  action: string;
  targetType?: string | null;
  targetId?: string | null;
  createdAt: string;
  actor?: User | null;
}

type AdminSection = "overview" | "users" | "guilds" | "announcements" | "audit";
type UserFilter = "all" | "online" | "disabled" | "admins" | "developers" | "no2fa";

const sectionMeta: Record<AdminSection, { title: string; subtitle: string }> = {
  overview: { title: "Visão geral", subtitle: "Saúde da plataforma, uso e atividade administrativa." },
  users: { title: "Usuários", subtitle: "Contas, permissões globais, sessões e segurança." },
  guilds: { title: "Servidores", subtitle: "Servidores criados, proprietários e tamanho da operação." },
  announcements: { title: "Comunicados", subtitle: "Avisos globais, manutenção e notas de versão." },
  audit: { title: "Auditoria", subtitle: "Histórico das ações administrativas da plataforma." }
};

function safeDate(value?: string | null, includeTime = true) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return includeTime ? date.toLocaleString("pt-BR") : date.toLocaleDateString("pt-BR");
}

function actionLabel(value: string) {
  return value.replaceAll("_", " ").toLocaleLowerCase("pt-BR");
}

export function AdminPortal({ user, onExit }: { user: User; onExit: () => void }) {
  const [section, setSection] = useState<AdminSection>("overview");
  const [overview, setOverview] = useState<Overview | null>(null);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [guilds, setGuilds] = useState<AdminGuild[]>([]);
  const [announcements, setAnnouncements] = useState<PlatformAnnouncement[]>([]);
  const [audit, setAudit] = useState<PlatformAudit[]>([]);
  const [query, setQuery] = useState("");
  const [userFilter, setUserFilter] = useState<UserFilter>("all");
  const [guildQuery, setGuildQuery] = useState("");
  const [auditQuery, setAuditQuery] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [baseLoading, setBaseLoading] = useState(true);
  const [usersLoading, setUsersLoading] = useState(true);
  const [selectedUser, setSelectedUser] = useState<AdminUser | null>(null);
  const [userActionBusy, setUserActionBusy] = useState(false);
  const [announcementBusyId, setAnnouncementBusyId] = useState("");
  const [announcementDeleteTarget, setAnnouncementDeleteTarget] = useState<PlatformAnnouncement | null>(null);
  const [deleteConfirmation, setDeleteConfirmation] = useState("");
  const [sessions, setSessions] = useState<AdminSession[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(false);
  const [moderationLogs, setModerationLogs] = useState<AdminModerationLog[]>([]);
  const [activeBans, setActiveBans] = useState<AdminActiveBan[]>([]);
  const [disableReason, setDisableReason] = useState("");

  const setFailure = useCallback((caught: unknown, fallback: string) => {
    setError(caught instanceof Error && caught.message ? caught.message : fallback);
  }, []);

  const loadOverview = useCallback(async () => {
    setOverview(await api<Overview>("/api/platform/admin/overview"));
  }, []);

  const loadGuilds = useCallback(async () => {
    const response = await api<{ guilds: AdminGuild[] }>("/api/platform/admin/guilds");
    setGuilds(response.guilds);
  }, []);

  const loadAnnouncements = useCallback(async () => {
    const response = await api<{ announcements: PlatformAnnouncement[] }>("/api/platform/admin/announcements");
    setAnnouncements(response.announcements);
  }, []);

  const loadAudit = useCallback(async () => {
    const response = await api<{ logs: PlatformAudit[] }>("/api/platform/admin/audit?limit=200");
    setAudit(response.logs);
  }, []);

  const loadUsers = useCallback(async (search = "") => {
    setUsersLoading(true);
    try {
      const response = await api<{ users: AdminUser[] }>(`/api/platform/admin/users?q=${encodeURIComponent(search)}`);
      setUsers(response.users);
      setSelectedUser((current) => current ? (response.users.find((item) => item.id === current.id) ?? current) : null);
    } catch (caught) {
      setFailure(caught, "Não foi possível carregar os usuários");
    } finally {
      setUsersLoading(false);
    }
  }, [setFailure]);

  const loadBase = useCallback(async () => {
    setBaseLoading(true);
    setError("");
    const results = await Promise.allSettled([loadOverview(), loadGuilds(), loadAnnouncements(), loadAudit()]);
    const failed = results.find((result) => result.status === "rejected");
    if (failed?.status === "rejected") setFailure(failed.reason, "Falha ao atualizar o painel administrativo");
    setBaseLoading(false);
  }, [loadAnnouncements, loadAudit, loadGuilds, loadOverview, setFailure]);

  useEffect(() => {
    void loadBase();
  }, [loadBase]);

  useEffect(() => {
    const timer = window.setTimeout(() => { void loadUsers(query.trim()); }, query.trim() ? 280 : 0);
    return () => window.clearTimeout(timer);
  }, [loadUsers, query]);

  useEffect(() => {
    if (!selectedUser) {
      setSessions([]);
      setModerationLogs([]);
      setActiveBans([]);
      return;
    }
    let cancelled = false;
    setDisableReason(selectedUser.accountDisabledReason ?? "");
    setSessionsLoading(true);
    Promise.all([
      api<{ sessions: AdminSession[] }>(`/api/platform/admin/users/${selectedUser.id}/sessions`),
      api<{ logs: AdminModerationLog[]; activeBans: AdminActiveBan[] }>(`/api/platform/admin/users/${selectedUser.id}/moderation-history`)
    ]).then(([sessionResponse, moderationResponse]) => {
      if (cancelled) return;
      setSessions(sessionResponse.sessions);
      setModerationLogs(moderationResponse.logs);
      setActiveBans(moderationResponse.activeBans);
    }).catch((caught) => {
      if (!cancelled) setFailure(caught, "Não foi possível carregar os detalhes da conta");
    }).finally(() => {
      if (!cancelled) setSessionsLoading(false);
    });
    return () => { cancelled = true; };
  }, [selectedUser?.id, setFailure]);

  async function refreshCurrent() {
    setError("");
    if (section === "users") return loadUsers(query.trim());
    if (section === "guilds") return loadGuilds().catch((caught) => setFailure(caught, "Não foi possível carregar os servidores"));
    if (section === "announcements") return loadAnnouncements().catch((caught) => setFailure(caught, "Não foi possível carregar os comunicados"));
    if (section === "audit") return loadAudit().catch((caught) => setFailure(caught, "Não foi possível carregar a auditoria"));
    await Promise.all([loadBase(), loadUsers(query.trim())]);
  }

  async function setAccountDisabled(disabled: boolean) {
    if (!selectedUser) return;
    setUserActionBusy(true);
    setError("");
    try {
      await api(`/api/platform/admin/users/${selectedUser.id}/account-state`, { method: "PATCH", body: JSON.stringify({ disabled, reason: disableReason }) });
      setNotice(disabled ? "Conta desativada e sessões encerradas." : "Conta reativada.");
      await loadUsers(query.trim());
    } catch (caught) {
      setFailure(caught, "Falha ao alterar a conta");
    } finally {
      setUserActionBusy(false);
    }
  }

  async function revokeSingleSession(sessionId: string) {
    if (!selectedUser) return;
    setUserActionBusy(true);
    setError("");
    try {
      await api(`/api/platform/admin/users/${selectedUser.id}/sessions/${sessionId}`, { method: "DELETE" });
      setSessions((current) => current.map((item) => item.id === sessionId ? { ...item, revokedAt: new Date().toISOString() } : item));
      setNotice("Sessão encerrada.");
    } catch (caught) {
      setFailure(caught, "Falha ao encerrar a sessão");
    } finally {
      setUserActionBusy(false);
    }
  }

  async function setRole(id: string, systemRole: SystemRole) {
    setError("");
    setNotice("");
    try {
      await api(`/api/platform/admin/users/${id}/system-role`, { method: "PATCH", body: JSON.stringify({ systemRole }) });
      setNotice("Permissão global atualizada.");
      await loadUsers(query.trim());
      await loadAudit();
    } catch (caught) {
      setFailure(caught, "Não foi possível alterar a permissão");
    }
  }

  async function sendPasswordReset() {
    if (!selectedUser || userActionBusy) return;
    setUserActionBusy(true);
    setError("");
    setNotice("");
    try {
      await api("/api/auth/password-reset/request", { method: "POST", body: JSON.stringify({ email: selectedUser.email }) });
      setNotice(`Link de redefinição enviado para ${selectedUser.email}.`);
    } catch (caught) {
      setFailure(caught, "Não foi possível enviar o link de redefinição");
    } finally {
      setUserActionBusy(false);
    }
  }

  async function revokeUserSessions() {
    if (!selectedUser || userActionBusy) return;
    setUserActionBusy(true);
    setError("");
    setNotice("");
    try {
      await api(`/api/platform/admin/users/${selectedUser.id}/revoke-sessions`, { method: "POST" });
      setNotice(`Todas as sessões de @${selectedUser.username} foram encerradas.`);
      await loadUsers(query.trim());
    } catch (caught) {
      setFailure(caught, "Não foi possível encerrar as sessões");
    } finally {
      setUserActionBusy(false);
    }
  }

  async function deleteUserAccount() {
    if (!selectedUser || userActionBusy) return;
    if (deleteConfirmation.trim().toLocaleLowerCase("pt-BR") !== `@${selectedUser.username}`.toLocaleLowerCase("pt-BR")) {
      setError(`Digite @${selectedUser.username} para confirmar a exclusão`);
      return;
    }
    setUserActionBusy(true);
    setError("");
    setNotice("");
    try {
      await api(`/api/platform/admin/users/${selectedUser.id}`, { method: "DELETE", body: JSON.stringify({ confirmUsername: selectedUser.username }) });
      const removed = selectedUser.username;
      setSelectedUser(null);
      setDeleteConfirmation("");
      setNotice(`Conta @${removed} excluída permanentemente.`);
      await Promise.all([loadUsers(query.trim()), loadOverview(), loadAudit()]);
    } catch (caught) {
      setFailure(caught, "Não foi possível excluir a conta");
    } finally {
      setUserActionBusy(false);
    }
  }

  async function publish(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setNotice("");
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    try {
      await api("/api/platform/admin/announcements", {
        method: "POST",
        body: JSON.stringify({
          title: String(form.get("title") || ""),
          body: String(form.get("body") || ""),
          severity: String(form.get("severity") || "INFO"),
          published: true
        })
      });
      formElement.reset();
      setNotice("Comunicado publicado.");
      await Promise.all([loadAnnouncements(), loadAudit()]);
    } catch (caught) {
      setFailure(caught, "Não foi possível publicar o comunicado");
    }
  }

  async function toggleAnnouncement(item: PlatformAnnouncement) {
    setAnnouncementBusyId(item.id);
    setError("");
    try {
      await api(`/api/platform/admin/announcements/${item.id}`, { method: "PATCH", body: JSON.stringify({ published: !item.published }) });
      setNotice(item.published ? "Comunicado ocultado." : "Comunicado republicado.");
      await Promise.all([loadAnnouncements(), loadAudit()]);
    } catch (caught) {
      setFailure(caught, "Não foi possível alterar o comunicado");
    } finally {
      setAnnouncementBusyId("");
    }
  }

  async function deleteAnnouncement(item: PlatformAnnouncement) {
    setAnnouncementBusyId(item.id);
    setError("");
    try {
      await api(`/api/platform/admin/announcements/${item.id}`, { method: "DELETE" });
      setNotice("Comunicado excluído.");
      setAnnouncementDeleteTarget(null);
      await Promise.all([loadAnnouncements(), loadAudit()]);
    } catch (caught) {
      setFailure(caught, "Não foi possível excluir o comunicado");
    } finally {
      setAnnouncementBusyId("");
    }
  }

  async function copyGuildId(id: string) {
    try {
      await navigator.clipboard.writeText(id);
      setNotice("ID do servidor copiado.");
    } catch {
      setError("Não foi possível copiar o ID.");
    }
  }

  const loading = baseLoading || usersLoading;
  const totalMessages = (overview?.messages ?? 0) + (overview?.directMessages ?? 0);
  const privilegedUsers = useMemo(() => users.filter((item) => item.platformOwner || item.systemRole === "PLATFORM_ADMIN" || item.systemRole === "DEVELOPER"), [users]);
  const onlineUsers = useMemo(() => users.filter((item) => item.online && !item.accountDisabled).length, [users]);
  const disabledUsers = useMemo(() => users.filter((item) => item.accountDisabled).length, [users]);
  const recentGuilds = useMemo(() => guilds.slice(0, 6), [guilds]);
  const recentAudit = useMemo(() => audit.slice(0, 8), [audit]);
  const filteredUsers = useMemo(() => users.filter((item) => {
    if (userFilter === "online") return Boolean(item.online) && !item.accountDisabled;
    if (userFilter === "disabled") return Boolean(item.accountDisabled);
    if (userFilter === "admins") return Boolean(item.platformOwner) || item.systemRole === "PLATFORM_ADMIN";
    if (userFilter === "developers") return item.systemRole === "DEVELOPER";
    if (userFilter === "no2fa") return !item.twoFactorEnabled;
    return true;
  }), [users, userFilter]);

  const filteredGuilds = useMemo(() => {
    const needle = guildQuery.trim().toLocaleLowerCase("pt-BR");
    if (!needle) return guilds;
    return guilds.filter((guild) => [guild.name, guild.description ?? "", guild.owner.displayName, guild.owner.username, guild.id].join(" ").toLocaleLowerCase("pt-BR").includes(needle));
  }, [guildQuery, guilds]);
  const filteredAudit = useMemo(() => {
    const needle = auditQuery.trim().toLocaleLowerCase("pt-BR");
    if (!needle) return audit;
    return audit.filter((item) => [item.action, item.targetType ?? "", item.targetId ?? "", item.actor?.displayName ?? "", item.actor?.username ?? ""].join(" ").toLocaleLowerCase("pt-BR").includes(needle));
  }, [audit, auditQuery]);

  const nav = [
    { id: "overview" as const, label: "Visão geral", icon: LayoutDashboard },
    { id: "users" as const, label: "Usuários", icon: Users },
    { id: "guilds" as const, label: "Servidores", icon: Building2 },
    { id: "announcements" as const, label: "Comunicados", icon: Megaphone },
    { id: "audit" as const, label: "Auditoria", icon: ScrollText }
  ];

  return (
    <main className="admin-console-v2">
      <aside className="admin-sidebar-v2">
        <div className="admin-brand-v2">
          <span><ShieldCheck size={19}/></span>
          <div><strong>Ginga Control</strong><small>Administração da plataforma</small></div>
        </div>
        <button className="admin-back-v2" onClick={onExit}>← Voltar ao Ginga</button>
        <nav className="admin-nav-v2" aria-label="Administração">
          <small>OPERAÇÃO</small>
          {nav.map(({ id, label, icon: Icon }) => (
            <button key={id} className={section === id ? "active" : ""} onClick={() => setSection(id)}>
              <Icon size={17}/><span>{label}</span>{section === id && <ChevronRight size={15}/>} 
            </button>
          ))}
        </nav>
        <div className="admin-session-v2">
          <Avatar user={user} size="sm"/>
          <div><strong>{user.displayName}</strong><span>@{user.username}</span></div>
          <UserBadges user={user} compact/>
        </div>
      </aside>

      <section className="admin-main-v2">
        <header className="admin-topbar-v2">
          <div>
            <span>GINGA ADMIN</span>
            <h1>{sectionMeta[section].title}</h1>
            <p>{sectionMeta[section].subtitle}</p>
          </div>
          <div className="admin-topbar-actions-v2">
            <span className={`admin-health-pill ${error ? "warning" : "ok"}`}><i/>{error ? "Atenção" : "Operacional"}</span>
            <button className="secondary-button" disabled={loading} onClick={() => void refreshCurrent()}><RefreshCw size={16} className={loading ? "spin" : ""}/> Atualizar</button>
          </div>
        </header>

        <div className="admin-feedback-v2">
          {error && <div className="inline-alert danger">{error}</div>}
          {notice && <div className="inline-success"><Check size={15}/> {notice}</div>}
        </div>

        {section === "overview" && <div className="admin-page-v2">
          <div className="admin-metrics-v2">
            <article><span><Users size={18}/></span><div><small>USUÁRIOS</small><strong>{(overview?.humans ?? 0).toLocaleString("pt-BR")}</strong><em>{onlineUsers} online · {disabledUsers} desativados</em></div></article>
            <article><span><Building2 size={18}/></span><div><small>SERVIDORES</small><strong>{(overview?.guilds ?? 0).toLocaleString("pt-BR")}</strong><em>{overview?.applications ?? 0} apps registradas</em></div></article>
            <article><span><Bot size={18}/></span><div><small>BOTS</small><strong>{(overview?.bots ?? 0).toLocaleString("pt-BR")}</strong><em>{overview?.webhooks ?? 0} webhooks</em></div></article>
            <article><span><Activity size={18}/></span><div><small>MENSAGENS</small><strong>{totalMessages.toLocaleString("pt-BR")}</strong><em>canais + mensagens diretas</em></div></article>
          </div>

          <div className="admin-dashboard-grid-v2">
            <section className="admin-panel-v2 admin-panel-wide-v2">
              <header><div><span>SERVIDORES</span><h2>Operação recente</h2><p>Tamanho, bots e moderação dos servidores mais recentes.</p></div><button onClick={() => setSection("guilds")}>Ver todos <ChevronRight size={15}/></button></header>
              <div className="admin-server-table-v2">
                {recentGuilds.length === 0 && <div className="admin-empty-v2">Nenhum servidor criado.</div>}
                {recentGuilds.map((guild) => <article key={guild.id}>
                  <span className="admin-server-icon-v2">{guild.name.slice(0, 1).toUpperCase()}</span>
                  <div className="admin-server-name-v2"><strong>{guild.name}</strong><small>@{guild.owner.username}</small></div>
                  <div><small>MEMBROS</small><strong>{guild._count.members}</strong></div>
                  <div><small>CANAIS</small><strong>{guild._count.channels}</strong></div>
                  <div><small>BOTS</small><strong>{guild._count.botInstalls}</strong></div>
                  <div><small>BANS</small><strong>{guild._count.bans}</strong></div>
                </article>)}
              </div>
            </section>

            <section className="admin-panel-v2">
              <header><div><span>PRIVILÉGIOS</span><h2>Contas especiais</h2><p>Owner, admins globais e developers.</p></div><button onClick={() => setSection("users")}>Gerenciar <ChevronRight size={15}/></button></header>
              <div className="admin-privileged-list-v2">
                {privilegedUsers.slice(0, 6).map((item) => <div key={item.id}><Avatar user={item} size="sm"/><span><strong>{item.displayName}</strong><small>{item.platformOwner ? "GINGA OWNER" : item.systemRole === "PLATFORM_ADMIN" ? "GINGA ADMIN" : "DEVELOPER"}</small></span></div>)}
                {privilegedUsers.length === 0 && <div className="admin-empty-v2">Nenhuma conta privilegiada.</div>}
              </div>
            </section>

            <section className="admin-panel-v2">
              <header><div><span>ATIVIDADE</span><h2>Últimas alterações</h2><p>Ações administrativas recentes.</p></div><button onClick={() => setSection("audit")}>Abrir log <ChevronRight size={15}/></button></header>
              <div className="admin-mini-audit-v2">{recentAudit.map((item) => <div key={item.id}><ScrollText size={15}/><span><strong>{actionLabel(item.action)}</strong><small>{item.actor?.displayName ?? "Sistema"} · {safeDate(item.createdAt)}</small></span></div>)}{recentAudit.length === 0 && <div className="admin-empty-v2">Nenhuma atividade global.</div>}</div>
            </section>
          </div>
        </div>}

        {section === "users" && <div className="admin-page-v2">
          <section className="admin-panel-v2 admin-users-panel-v2">
            <header className="admin-users-header-v2"><div><span>CONTAS</span><h2>Usuários e privilégios</h2><p>Busque uma conta e abra Gerenciar para sessões, moderação e ações de segurança.</p></div><label className="admin-search-v2"><Search size={16}/><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Nome, @usuário ou e-mail"/>{query&&<button type="button" onClick={()=>setQuery("")} aria-label="Limpar busca"><X size={14}/></button>}</label></header><div className="admin-user-filter-v2"><button className={userFilter==="all"?"active":""} onClick={()=>setUserFilter("all")}>Todos <b>{users.length}</b></button><button className={userFilter==="online"?"active":""} onClick={()=>setUserFilter("online")}>Online</button><button className={userFilter==="disabled"?"active":""} onClick={()=>setUserFilter("disabled")}>Desativados</button><button className={userFilter==="admins"?"active":""} onClick={()=>setUserFilter("admins")}>Admins</button><button className={userFilter==="developers"?"active":""} onClick={()=>setUserFilter("developers")}>Developers</button><button className={userFilter==="no2fa"?"active":""} onClick={()=>setUserFilter("no2fa")}><ShieldAlert size={13}/> Sem 2FA</button></div>
            <div className="admin-user-table-v2">
              <div className="admin-user-table-head-v2"><span>Usuário</span><span>E-mail</span><span>Último acesso</span><span>Permissão</span><span>Ações</span></div>
              {filteredUsers.map((item) => <article key={item.id} className={selectedUser?.id === item.id ? "selected" : ""}>
                <button type="button" className="admin-user-identity-v2 admin-user-open-v2" onClick={() => { setSelectedUser(item); setDeleteConfirmation(""); setError(""); }}>
                  <Avatar user={item} size="sm" status={item.online ? "online" : "offline"}/><span><strong>{item.displayName} <UserBadges user={item} compact/></strong><small><i className={`admin-presence-dot-v2 ${item.online ? "online" : "offline"}`}/>{item.online ? "Online" : "Offline"} · @{item.username}{item.accountDisabled ? " · DESATIVADA" : ""} <span className={`admin-2fa-inline-v2 ${item.twoFactorEnabled ? "enabled" : "disabled"}`}>{item.twoFactorEnabled ? "2FA ativo" : "sem 2FA"}</span></small></span>
                </button>
                <span className="admin-user-email-v2">{item.email}</span>
                <span className="admin-user-login-v2">{safeDate(item.lastLoginAt)}</span>
                <select value={item.systemRole ?? "USER"} disabled={Boolean(item.platformOwner) || (item.id === user.id && (item.systemRole ?? "USER") === "PLATFORM_ADMIN")} onChange={(event) => void setRole(item.id, event.target.value as SystemRole)}>
                  <option value="USER">Usuário</option><option value="DEVELOPER">Developer</option><option value="PLATFORM_ADMIN">Ginga Admin</option>
                </select>
                <button type="button" className="admin-manage-user-v2" onClick={() => { setSelectedUser(item); setDeleteConfirmation(""); setError(""); }}><UserCog size={15}/> Gerenciar</button>
              </article>)}
              {!usersLoading && filteredUsers.length === 0 && <div className="admin-empty-v2">Nenhum usuário encontrado neste filtro.</div>}
            </div>
          </section>
        </div>}

        {section === "guilds" && <div className="admin-page-v2">
          <section className="admin-panel-v2">
            <header className="admin-users-header-v2"><div><span>PLATAFORMA</span><h2>Servidores</h2><p>{guilds.length} servidor{guilds.length === 1 ? "" : "es"} registrado{guilds.length === 1 ? "" : "s"}.</p></div><label className="admin-search-v2"><Search size={16}/><input value={guildQuery} onChange={(event) => setGuildQuery(event.target.value)} placeholder="Buscar servidor ou owner"/></label></header>
            <div className="admin-guild-cards-v2">
              {filteredGuilds.map((guild) => <article key={guild.id}>
                <div className="admin-guild-card-top-v2"><span className="admin-server-icon-v2">{guild.name.slice(0, 1).toUpperCase()}</span><div><h3>{guild.name}</h3><p>{guild.description || "Sem descrição."}</p></div></div>
                <dl><div><dt>Proprietário</dt><dd>{guild.owner.displayName}<small>@{guild.owner.username}</small></dd></div><div><dt>Criado</dt><dd>{safeDate(guild.createdAt, false)}</dd></div></dl>
                <div className="admin-guild-stats-v2"><span><b>{guild._count.members}</b> membros</span><span><b>{guild._count.channels}</b> canais</span><span><b>{guild._count.botInstalls}</b> bots</span><span className={guild._count.bans ? "danger" : ""}><b>{guild._count.bans}</b> bans</span></div>
                <div className="admin-guild-actions-v2"><code>{guild.id}</code><button type="button" onClick={() => void copyGuildId(guild.id)}><Clipboard size={14}/> Copiar ID</button></div>
              </article>)}
              {!baseLoading && filteredGuilds.length === 0 && <div className="admin-empty-v2">Nenhum servidor encontrado.</div>}
            </div>
          </section>
        </div>}

        {section === "announcements" && <div className="admin-page-v2 admin-announcement-layout-v2">
          <section className="admin-panel-v2">
            <header><div><span>PUBLICAR</span><h2>Novo comunicado</h2><p>Use para manutenção, release ou aviso importante.</p></div></header>
            <form className="admin-announcement-form-v2" onSubmit={publish}>
              <label>Título<input name="title" required maxLength={120} placeholder="Ex.: Manutenção hoje às 23h"/></label>
              <label>Tipo<select name="severity" defaultValue="INFO"><option value="INFO">Informação</option><option value="UPDATE">Atualização</option><option value="WARNING">Atenção</option><option value="CRITICAL">Crítico</option></select></label>
              <label className="full">Mensagem<textarea name="body" required rows={8} maxLength={8000} placeholder="Escreva o comunicado..."/></label>
              <div className="full admin-publish-actions-v2"><small>O aviso aparece para usuários autenticados.</small><button className="primary-button"><Megaphone size={16}/> Publicar</button></div>
            </form>
          </section>
          <section className="admin-panel-v2">
            <header><div><span>HISTÓRICO</span><h2>Publicações</h2><p>Comunicados ativos e ocultos.</p></div></header>
            <div className="admin-announcement-list-v2">{announcements.slice(0, 30).map((item) => <article key={item.id} className={!item.published ? "is-hidden" : ""}><i className={String(item.severity).toLowerCase()}/><div><strong>{item.title}</strong><p>{item.body}</p><small>{item.severity} · {safeDate(item.createdAt)} · {item.published ? "Publicado" : "Oculto"}</small><div className="admin-announcement-actions-v2"><button type="button" disabled={announcementBusyId === item.id} onClick={() => void toggleAnnouncement(item)}>{item.published ? <EyeOff size={13}/> : <Eye size={13}/>} {item.published ? "Ocultar" : "Publicar"}</button><button type="button" className="danger" disabled={announcementBusyId === item.id} onClick={() => setAnnouncementDeleteTarget(item)}><Trash2 size={13}/> Excluir</button></div></div></article>)}{announcements.length === 0 && <div className="admin-empty-v2">Nenhum comunicado publicado.</div>}</div>
          </section>
        </div>}

        {section === "audit" && <div className="admin-page-v2">
          <section className="admin-panel-v2">
            <header className="admin-users-header-v2"><div><span>LOG GLOBAL</span><h2>Auditoria da plataforma</h2><p>Ações administrativas globais, separadas da auditoria de cada servidor.</p></div><label className="admin-search-v2"><Search size={16}/><input value={auditQuery} onChange={(event) => setAuditQuery(event.target.value)} placeholder="Buscar ação, usuário ou ID"/></label></header>
            <div className="admin-audit-table-v2">{filteredAudit.map((item) => <article key={item.id}><span className="admin-audit-icon-v2"><ScrollText size={16}/></span><div><strong>{actionLabel(item.action)}</strong><small>{item.actor?.displayName ?? "Sistema"}</small></div><span>{item.targetType ?? "-"}</span><code>{item.targetId ?? "-"}</code><time>{safeDate(item.createdAt)}</time></article>)}{!baseLoading && filteredAudit.length === 0 && <div className="admin-empty-v2">Nenhuma ação encontrada.</div>}</div>
          </section>
        </div>}
      </section>

      {announcementDeleteTarget && <div className="admin-confirm-backdrop-v2" onMouseDown={() => { if (!announcementBusyId) setAnnouncementDeleteTarget(null); }}>
        <section className="admin-confirm-dialog-v2" role="alertdialog" aria-modal="true" aria-label="Excluir comunicado" onMouseDown={(event) => event.stopPropagation()}>
          <span className="admin-confirm-icon-v2"><Trash2 size={20}/></span>
          <div><small>EXCLUIR COMUNICADO</small><h2>{announcementDeleteTarget.title}</h2><p>O comunicado será removido da plataforma. Essa ação não pode ser desfeita.</p></div>
          <div className="admin-confirm-actions-v2"><button type="button" className="secondary-button" disabled={Boolean(announcementBusyId)} onClick={() => setAnnouncementDeleteTarget(null)}>Cancelar</button><button type="button" className="admin-danger-button-v2" disabled={Boolean(announcementBusyId)} onClick={() => void deleteAnnouncement(announcementDeleteTarget)}><Trash2 size={15}/> {announcementBusyId ? "Excluindo..." : "Excluir"}</button></div>
        </section>
      </div>}

      {selectedUser && <div className="admin-user-drawer-backdrop-v2" onMouseDown={() => { if (!userActionBusy) setSelectedUser(null); }}>
        <aside className="admin-user-drawer-v2" onMouseDown={(event) => event.stopPropagation()}>
          <header>
            <div className="admin-user-drawer-identity-v2"><Avatar user={selectedUser} size="lg"/><div><small>CONTA</small><h2>{selectedUser.displayName}</h2><span>@{selectedUser.username}</span></div></div>
            <button type="button" className="admin-user-drawer-close-v2" disabled={userActionBusy} onClick={() => setSelectedUser(null)} aria-label="Fechar"><X size={18}/></button>
          </header>

          <div className="admin-user-drawer-summary-v2">
            <div><small>E-mail</small><strong>{selectedUser.email}</strong></div>
            <div><small>Criada em</small><strong>{safeDate(selectedUser.createdAt, false)}</strong></div>
            <div><small>Último acesso</small><strong>{safeDate(selectedUser.lastLoginAt)}</strong></div>
            <div><small>Nível</small><strong>{selectedUser.platformOwner ? "GINGA OWNER" : selectedUser.systemRole === "PLATFORM_ADMIN" ? "Ginga Admin" : selectedUser.systemRole === "DEVELOPER" ? "Developer" : "Usuário"}</strong></div>
            <div><small>Estado</small><strong>{selectedUser.accountDisabled ? "Desativada" : selectedUser.online ? "Online" : "Ativa"}</strong></div>
            <div><small>Verificacao em duas etapas</small><strong className={selectedUser.twoFactorEnabled ? "admin-security-good-v2" : "admin-security-warn-v2"}>{selectedUser.twoFactorEnabled ? "Ativada" : "Nao ativada"}</strong></div>
          </div>

          <section className="admin-user-action-section-v2">
            <div className="admin-user-action-title-v2">{selectedUser.accountDisabled ? <Power size={17}/> : <PowerOff size={17}/>}<div><strong>{selectedUser.accountDisabled ? "Reativar conta" : "Desativar conta"}</strong><span>Desativar bloqueia novos logins e encerra as sessões existentes.</span></div></div>
            {!selectedUser.accountDisabled && <label className="admin-inline-label-v2">Motivo<input value={disableReason} onChange={(event) => setDisableReason(event.target.value)} maxLength={300} placeholder="Motivo administrativo"/></label>}
            <button type="button" className="secondary-button admin-wide-action-v2" disabled={userActionBusy || selectedUser.id === user.id || Boolean(selectedUser.platformOwner)} onClick={() => void setAccountDisabled(!selectedUser.accountDisabled)}>{selectedUser.accountDisabled ? "Reativar" : "Desativar e desconectar"}</button>
          </section>

          <section className="admin-user-action-section-v2">
            <div className="admin-user-action-title-v2"><Mail size={17}/><div><strong>Redefinir senha</strong><span>Envia para o e-mail da conta o mesmo link seguro de recuperação usado na tela de login.</span></div></div>
            <button type="button" className="secondary-button admin-wide-action-v2" disabled={userActionBusy || selectedUser.id === user.id || Boolean(selectedUser.platformOwner)} onClick={() => void sendPasswordReset()}><Mail size={15}/> Enviar link de redefinição</button>
            {(selectedUser.id === user.id || selectedUser.platformOwner) && <small className="admin-user-action-note-v2">Para a própria conta ou Owner, use a recuperação de senha normal.</small>}
          </section>

          <section className="admin-user-action-section-v2">
            <div className="admin-user-action-title-v2"><LogOut size={17}/><div><strong>Encerrar sessões</strong><span>Revoga os tokens e desconecta a conta dos clientes conectados.</span></div></div>
            <button type="button" className="secondary-button admin-wide-action-v2" disabled={userActionBusy || selectedUser.id === user.id || Boolean(selectedUser.platformOwner)} onClick={() => void revokeUserSessions()}><LogOut size={15}/> Sair de todos os dispositivos</button>
          </section>

          <section className="admin-user-action-section-v2">
            <div className="admin-user-action-title-v2"><Laptop size={17}/><div><strong>Sessões e dispositivos</strong><span>O endereço IP é exibido apenas como hash.</span></div></div>
            <div className="admin-session-list-v2">{sessionsLoading ? <div className="admin-session-empty-v2">Carregando sessões...</div> : sessions.length ? sessions.map((session) => <article key={session.id} className={session.revokedAt ? "revoked" : "active"}><Laptop size={15}/><div><strong>{session.userAgent || "Dispositivo não identificado"}</strong><small><Clock3 size={11}/> {safeDate(session.lastSeenAt)} · IP #{session.ipHash?.slice(0, 10) ?? "-"}</small></div><span>{session.revokedAt ? "Encerrada" : "Ativa"}</span>{!session.revokedAt && <button type="button" disabled={userActionBusy} onClick={() => void revokeSingleSession(session.id)}>Encerrar</button>}</article>) : <div className="admin-session-empty-v2">Nenhuma sessão registrada.</div>}</div>
          </section>

          <section className="admin-user-action-section-v2">
            <div className="admin-user-action-title-v2"><ShieldAlert size={17}/><div><strong>Histórico de moderação</strong><span>Bans e ações registradas nos servidores.</span></div></div>
            {activeBans.map((ban) => <article className="admin-active-ban-v2" key={ban.id}><Ban size={14}/><div><strong>{ban.guild.name} · {ban.expiresAt ? "ban temporário" : "ban permanente"}</strong><small>{ban.reason || "Sem motivo"}</small></div></article>)}
            <div className="admin-moderation-list-v2">{moderationLogs.slice(0, 40).map((log) => <article key={log.id}><ScrollText size={13}/><div><strong>{actionLabel(log.action)}</strong><small>{log.guild.name} · {safeDate(log.createdAt)}</small></div></article>)}{moderationLogs.length === 0 && activeBans.length === 0 && <div className="admin-session-empty-v2">Nenhum registro de moderação.</div>}</div>
          </section>

          <section className="admin-user-danger-zone-v2">
            <div className="admin-user-action-title-v2"><ShieldAlert size={18}/><div><strong>Zona de perigo</strong><span>Exclusão permanente da conta.</span></div></div>
            <p>Se a conta ainda for proprietária de servidor ou tiver vínculos administrativos protegidos, o backend recusa a exclusão até esses vínculos serem resolvidos.</p>
            <label>Digite <b>@{selectedUser.username}</b> para confirmar<input value={deleteConfirmation} onChange={(event) => setDeleteConfirmation(event.target.value)} placeholder={`@${selectedUser.username}`} disabled={userActionBusy || selectedUser.id === user.id || Boolean(selectedUser.platformOwner)}/></label>
            <button type="button" className="admin-delete-user-v2" disabled={userActionBusy || selectedUser.id === user.id || Boolean(selectedUser.platformOwner) || deleteConfirmation.trim().toLocaleLowerCase("pt-BR") !== `@${selectedUser.username}`.toLocaleLowerCase("pt-BR")} onClick={() => void deleteUserAccount()}><Trash2 size={15}/> Excluir conta permanentemente</button>
          </section>
        </aside>
      </div>}
    </main>
  );
}
