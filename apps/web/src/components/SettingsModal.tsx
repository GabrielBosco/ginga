import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Check, KeyRound, Network, Save, Settings2, ShieldCheck, SlidersHorizontal, UserCog, Users } from "lucide-react";
import { api, setToken } from "../lib/api";
import type { Guild, GuildMember, GuildRole, ManagedChannel, NetworkInfo, User } from "../types";
import { Avatar } from "./Avatar";
import { Modal } from "./Modal";

type SettingsTab = "profile" | "security" | "space" | "members" | "permissions" | "network";

interface SettingsModalProps {
  user: User;
  guild?: Guild;
  members: GuildMember[];
  onClose: () => void;
  onSessionUpdate: (token: string, user: User) => void;
  onGuildsRefresh: () => Promise<void>;
  onMembersRefresh: () => Promise<void>;
}

const roleLabel: Record<GuildRole, string> = {
  OWNER: "Proprietario",
  ADMIN: "Administrador",
  MODERATOR: "Moderador",
  MEMBER: "Membro"
};

export function SettingsModal({ user, guild, members, onClose, onSessionUpdate, onGuildsRefresh, onMembersRefresh }: SettingsModalProps) {
  const [tab, setTab] = useState<SettingsTab>("profile");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [managedChannels, setManagedChannels] = useState<ManagedChannel[]>([]);
  const [networkInfo, setNetworkInfo] = useState<NetworkInfo | null>(null);
  const canManage = guild?.role === "OWNER" || guild?.role === "ADMIN";

  const availableTabs = useMemo(() => {
    const base: Array<{ id: SettingsTab; label: string; icon: typeof UserCog }> = [
      { id: "profile", label: "Perfil", icon: UserCog },
      { id: "security", label: "Seguranca", icon: KeyRound },
      { id: "network", label: "Rede", icon: Network }
    ];
    if (guild && canManage) {
      base.splice(2, 0,
        { id: "space", label: "Espaco", icon: Settings2 },
        { id: "members", label: "Membros", icon: Users },
        { id: "permissions", label: "Permissoes", icon: SlidersHorizontal }
      );
    }
    return base;
  }, [canManage, guild]);

  useEffect(() => {
    setError("");
    setNotice("");
    if (tab === "permissions" && guild && canManage) {
      api<{ channels: ManagedChannel[] }>(`/api/guilds/${guild.id}/channel-permissions`)
        .then((result) => setManagedChannels(result.channels))
        .catch((caught) => setError(caught instanceof Error ? caught.message : "Falha ao carregar permissoes"));
    }
    if (tab === "network") {
      api<NetworkInfo>("/api/system/network")
        .then(setNetworkInfo)
        .catch((caught) => setError(caught instanceof Error ? caught.message : "Falha ao ler configuracao de rede"));
    }
  }, [canManage, guild, tab]);

  async function saveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true); setError(""); setNotice("");
    try {
      const result = await api<{ token: string; user: User }>("/api/auth/me", {
        method: "PATCH",
        body: JSON.stringify({
          displayName: String(form.get("displayName") ?? ""),
          username: String(form.get("username") ?? "")
        })
      });
      setToken(result.token);
      onSessionUpdate(result.token, result.user);
      setNotice("Perfil atualizado");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Nao foi possivel salvar o perfil");
    } finally { setBusy(false); }
  }

  async function changePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const currentPassword = String(form.get("currentPassword") ?? "");
    const newPassword = String(form.get("newPassword") ?? "");
    const confirmPassword = String(form.get("confirmPassword") ?? "");
    if (newPassword !== confirmPassword) { setError("A confirmacao da nova senha nao confere"); return; }
    setBusy(true); setError(""); setNotice("");
    try {
      const result = await api<{ token: string; user: User }>("/api/auth/password", { method: "POST", body: JSON.stringify({ currentPassword, newPassword }) });
      setToken(result.token);
      onSessionUpdate(result.token, result.user);
      event.currentTarget.reset();
      setNotice("Senha alterada e sessoes antigas revogadas");
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Nao foi possivel alterar a senha"); }
    finally { setBusy(false); }
  }

  async function saveSpace(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!guild) return;
    const form = new FormData(event.currentTarget);
    setBusy(true); setError(""); setNotice("");
    try {
      await api(`/api/guilds/${guild.id}`, {
        method: "PATCH",
        body: JSON.stringify({ name: String(form.get("name") ?? ""), iconColor: String(form.get("iconColor") ?? "") })
      });
      await onGuildsRefresh();
      setNotice("Espaco atualizado");
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Nao foi possivel atualizar o espaco"); }
    finally { setBusy(false); }
  }

  async function setMemberRole(member: GuildMember, role: "ADMIN" | "MODERATOR" | "MEMBER") {
    if (!guild) return;
    setBusy(true); setError(""); setNotice("");
    try {
      await api(`/api/guilds/${guild.id}/members/${member.user.id}`, { method: "PATCH", body: JSON.stringify({ role }) });
      await Promise.all([onMembersRefresh(), onGuildsRefresh()]);
      setNotice(`Funcao de ${member.user.displayName} atualizada`);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Nao foi possivel alterar a funcao"); }
    finally { setBusy(false); }
  }

  function permissionFor(channel: ManagedChannel, role: "MODERATOR" | "MEMBER") {
    return channel.permissions.find((item) => item.role === role) ?? {
      channelId: channel.id,
      role,
      canView: true,
      canSendMessages: true,
      canConnect: true
    };
  }

  async function togglePermission(channel: ManagedChannel, role: "MODERATOR" | "MEMBER", key: "canView" | "canSendMessages" | "canConnect") {
    const current = permissionFor(channel, role);
    const next = { ...current, [key]: !current[key] };
    if (key === "canView" && !next.canView) {
      next.canSendMessages = false;
      next.canConnect = false;
    }
    if ((key === "canSendMessages" || key === "canConnect") && next[key]) next.canView = true;

    setManagedChannels((channels) => channels.map((item) => item.id === channel.id
      ? { ...item, permissions: [...item.permissions.filter((permission) => permission.role !== role), next] }
      : item));
    try {
      await api(`/api/channels/${channel.id}/permissions/${role}`, {
        method: "PUT",
        body: JSON.stringify({ canView: next.canView, canSendMessages: next.canSendMessages, canConnect: next.canConnect })
      });
      await onGuildsRefresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Nao foi possivel salvar a permissao");
      const result = await api<{ channels: ManagedChannel[] }>(`/api/guilds/${guild!.id}/channel-permissions`).catch(() => null);
      if (result) setManagedChannels(result.channels);
    }
  }

  return (
    <Modal title="Central de configuracoes" onClose={onClose} width="lg">
      <div className="settings-layout">
        <nav className="settings-nav">
          {availableTabs.map(({ id, label, icon: Icon }) => <button key={id} className={tab === id ? "active" : ""} onClick={() => setTab(id)}><Icon size={17} /> {label}</button>)}
        </nav>
        <div className="settings-content">
          {error && <div className="inline-error">{error}</div>}
          {notice && <div className="inline-success"><Check size={16} /> {notice}</div>}

          {tab === "profile" && (
            <form className="settings-section stack-form" onSubmit={saveProfile}>
              <div className="settings-heading"><Avatar user={user} size="lg" /><div><h3>Seu perfil</h3><p>Identidade exibida nas conversas e chamadas.</p></div></div>
              <label>Nome exibido<input name="displayName" defaultValue={user.displayName} minLength={2} maxLength={32} required /></label>
              <label>Nome de usuario<input name="username" defaultValue={user.username} minLength={3} maxLength={24} required /></label>
              <button className="primary-button settings-save" disabled={busy}><Save size={16} /> Salvar perfil</button>
            </form>
          )}

          {tab === "security" && (
            <form className="settings-section stack-form" onSubmit={changePassword}>
              <div className="settings-heading"><span className="settings-big-icon"><ShieldCheck /></span><div><h3>Seguranca da conta</h3><p>Altere sua senha sem expor a senha atual no navegador.</p></div></div>
              <label>Senha atual<input name="currentPassword" type="password" required /></label>
              <label>Nova senha<input name="newPassword" type="password" minLength={10} required /></label>
              <label>Confirmar nova senha<input name="confirmPassword" type="password" minLength={10} required /></label>
              <button className="primary-button settings-save" disabled={busy}><KeyRound size={16} /> Alterar senha</button>
            </form>
          )}

          {tab === "space" && guild && (
            <form className="settings-section stack-form" onSubmit={saveSpace}>
              <div className="settings-heading"><span className="space-color-preview" style={{ background: guild.iconColor }} /><div><h3>{guild.name}</h3><p>Nome e identidade visual deste espaco.</p></div></div>
              <label>Nome do espaco<input name="name" defaultValue={guild.name} minLength={2} maxLength={64} required /></label>
              <label>Cor do espaco<input name="iconColor" type="color" defaultValue={guild.iconColor} /></label>
              <button className="primary-button settings-save" disabled={busy}><Save size={16} /> Salvar espaco</button>
            </form>
          )}

          {tab === "members" && guild && (
            <section className="settings-section">
              <div className="settings-heading"><span className="settings-big-icon"><Users /></span><div><h3>Equipe e funcoes</h3><p>Administradores gerenciam o espaco; moderadores seguem as permissoes dos canais.</p></div></div>
              <div className="settings-member-list">
                {members.map((member) => (
                  <div className="settings-member" key={member.user.id}>
                    <Avatar user={member.user} size="sm" />
                    <div><strong>{member.user.displayName}</strong><span>@{member.user.username}</span></div>
                    {member.role === "OWNER" || member.user.id === user.id ? <span className="role-chip">{roleLabel[member.role]}</span> : (
                      <select value={member.role} disabled={busy || (guild.role === "ADMIN" && member.role === "ADMIN")} onChange={(event) => void setMemberRole(member, event.target.value as "ADMIN" | "MODERATOR" | "MEMBER")}>
                        {(guild.role === "OWNER" || member.role === "ADMIN") && <option value="ADMIN">Administrador</option>}
                        <option value="MODERATOR">Moderador</option>
                        <option value="MEMBER">Membro</option>
                      </select>
                    )}
                  </div>
                ))}
              </div>
            </section>
          )}

          {tab === "permissions" && guild && (
            <section className="settings-section permission-settings">
              <div className="settings-heading"><span className="settings-big-icon"><SlidersHorizontal /></span><div><h3>Permissoes por canal</h3><p>Proprietarios e administradores sempre tem acesso total. Configure moderadores e membros.</p></div></div>
              <div className="permission-table-wrap">
                {managedChannels.map((channel) => (
                  <div className="permission-channel" key={channel.id}>
                    <div className="permission-channel-title"><strong>{channel.name}</strong><span>{channel.type === "VOICE" ? "voz/video" : "texto"}</span></div>
                    {(["MODERATOR", "MEMBER"] as const).map((role) => {
                      const permission = permissionFor(channel, role);
                      return (
                        <div className="permission-row" key={role}>
                          <span>{role === "MODERATOR" ? "Moderadores" : "Membros"}</span>
                          <label><input type="checkbox" checked={permission.canView} onChange={() => void togglePermission(channel, role, "canView")} /> Ver</label>
                          {channel.type === "TEXT" ? <label><input type="checkbox" checked={permission.canSendMessages} onChange={() => void togglePermission(channel, role, "canSendMessages")} /> Enviar</label> : <label><input type="checkbox" checked={permission.canConnect} onChange={() => void togglePermission(channel, role, "canConnect")} /> Entrar</label>}
                        </div>
                      );
                    })}
                  </div>
                ))}
              </div>
            </section>
          )}

          {tab === "network" && (
            <section className="settings-section">
              <div className="settings-heading"><span className="settings-big-icon"><Network /></span><div><h3>Rede e midia</h3><p>Informacoes seguras da configuracao ativa. Segredos nunca sao exibidos aqui.</p></div></div>
              {!networkInfo ? <p className="muted-copy">Carregando...</p> : (
                <div className="network-cards">
                  <div><span>Origens permitidas</span><strong>{networkInfo.appOrigins.join(", ")}</strong></div>
                  <div><span>Servidor de chamadas</span><strong>{networkInfo.livekitUrl}</strong></div>
                  <div><span>Acesso de rede</span><strong>{networkInfo.secureTransport
                    ? "Transporte protegido (HTTPS/WSS)"
                    : (networkInfo.insecureAppOrigins?.length ?? 0) > 0
                      ? "HTTP externo - use HTTPS para camera/microfone"
                      : networkInfo.livekitSecure === false
                        ? "Midia sem TLS - use WSS"
                        : "Modo local"
                  }</strong></div>
                </div>
              )}
              <p className="settings-note">Para alterar IP, dominio ou portas no host Windows, use o script de configuracao LAN incluido no pacote e reinicie os containers.</p>
            </section>
          )}
        </div>
      </div>
    </Modal>
  );
}
