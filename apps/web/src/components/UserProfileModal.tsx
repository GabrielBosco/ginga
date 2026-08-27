import { useCallback, useEffect, useMemo, useState } from "react";
import { Ban, CalendarDays, MessageCircle, Server, ShieldCheck, UserPlus } from "lucide-react";
import { api } from "../lib/api";
import type { GuildRole, User, UserProfilePayload } from "../types";
import { Avatar } from "./Avatar";
import { UserBadges } from "./UserBadges";
import { Modal } from "./Modal";

import { gingaConfirm } from "../lib/dialogs";
interface UserProfileModalProps {
  user: User;
  currentUser: User;
  guildId?: string;
  online: boolean;
  onClose: () => void;
  onMessage: (userId: string) => Promise<void>;
  onSocialRefresh: () => Promise<void>;
}

const roleLabel: Record<GuildRole, string> = {
  OWNER: "Proprietario",
  ADMIN: "Administrador",
  MODERATOR: "Moderador",
  MEMBER: "Membro"
};

function safeDate(value?: string | null) {
  if (!value) return "Data indisponivel";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Data indisponivel";
  try { return new Intl.DateTimeFormat("pt-BR").format(date); }
  catch { return "Data indisponivel"; }
}

export function UserProfileModal({ user, currentUser, guildId, online, onClose, onMessage, onSocialRefresh }: UserProfileModalProps) {
  const [data, setData] = useState<UserProfilePayload | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const isSelf = user.id === currentUser.id;

  const load = useCallback(async () => {
    const query = guildId ? `?guildId=${encodeURIComponent(guildId)}` : "";
    const result = await api<UserProfilePayload>(`/api/users/${encodeURIComponent(user.id)}/profile${query}`);
    setData(result);
    return result;
  }, [guildId, user.id]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    load()
      .catch((caught) => { if (active) setError(caught instanceof Error ? caught.message : "Falha ao carregar perfil"); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [load]);

  const profile = data?.profile ?? user;
  const sharedGuilds = useMemo(() => Array.isArray(data?.sharedGuilds) ? data.sharedGuilds : [], [data?.sharedGuilds]);
  const membership = data?.guildMembership ?? null;
  const block = data?.block ?? null;
  const blockedByViewer = Boolean(block?.blockedByViewer);
  const blockedViewer = Boolean(block?.blockedViewer);
  const interactionsBlocked = blockedByViewer || blockedViewer;
  const friendship = data?.friendship ?? null;

  async function addFriend() {
    if (!data) return;
    setBusy(true); setError("");
    try {
      if (friendship?.status === "PENDING" && friendship.direction === "INCOMING") {
        await api(`/api/friends/${friendship.id}/accept`, { method: "POST" });
      } else {
        await api("/api/friends/requests", { method: "POST", body: JSON.stringify({ username: profile.username }) });
      }
      await Promise.all([onSocialRefresh(), load()]);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Nao foi possivel atualizar a amizade");
    } finally { setBusy(false); }
  }

  async function toggleBlock() {
    if (!data || isSelf) return;
    if (!blockedByViewer && !(await gingaConfirm(`Mensagens, chamadas e novas solicitacoes de ${profile.displayName} serao interrompidas.`, { title: `Bloquear ${profile.displayName}?`, confirmLabel: "Bloquear", tone: "danger" }))) return;
    setBusy(true); setError("");
    try {
      await api(`/api/users/${encodeURIComponent(user.id)}/block`, { method: blockedByViewer ? "DELETE" : "POST" });
      await Promise.all([onSocialRefresh(), load()]);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Nao foi possivel atualizar o bloqueio");
    } finally { setBusy(false); }
  }

  async function openMessage() {
    setBusy(true); setError("");
    try {
      await onMessage(user.id);
      onClose();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Nao foi possivel abrir a conversa");
    } finally { setBusy(false); }
  }

  return (
    <Modal title="Perfil" onClose={onClose} width="md">
      <div className="full-profile full-profile-v2">
        <div className="full-profile-banner" style={{ background: profile.avatarColor || "#7867e8" }} />
        <div className="full-profile-top">
          <Avatar user={profile} size="xl" status={online ? "online" : "offline"} />
          <div className="full-profile-actions">
            {!isSelf && data && !interactionsBlocked && (friendship?.status === "ACCEPTED" || sharedGuilds.length > 0) && <button className="primary-button" disabled={busy} onClick={() => void openMessage()}><MessageCircle size={16} /> Mensagem</button>}
            {!isSelf && data && !interactionsBlocked && friendship?.status !== "ACCEPTED" && <button className="secondary-button" disabled={busy || friendship?.direction === "OUTGOING"} onClick={() => void addFriend()}><UserPlus size={16} /> {friendship?.direction === "OUTGOING" ? "Solicitacao enviada" : friendship?.direction === "INCOMING" ? "Aceitar amizade" : "Adicionar amigo"}</button>}
            {!isSelf && data && <button className="secondary-button danger-soft-button" disabled={busy} onClick={() => void toggleBlock()}><Ban size={16}/> {blockedByViewer ? "Desbloquear" : "Bloquear"}</button>}
          </div>
        </div>

        <div className="full-profile-identity">
          <h2>{profile.displayName || profile.username || "Usuario"} <UserBadges user={profile} /></h2>
          <span>@{profile.username || "usuario"}</span>
          <div className="contact-status"><i className={online ? "online" : ""} /> {online ? "Online agora" : "Offline"}</div>
        </div>

        {loading && <div className="profile-loading-v2"><span/><div><b/><i/></div></div>}
        {profile.statusMessage && <div className="full-profile-status">{profile.statusMessage}</div>}
        {blockedViewer && !blockedByViewer && <div className="inline-alert muted-alert">Este usuario bloqueou voce. Novas interacoes estao indisponiveis.</div>}
        {error && <div className="profile-load-warning-v2"><ShieldCheck size={17}/><div><strong>Perfil parcialmente carregado</strong><span>{error}. O restante do Ginga continua funcionando.</span></div><button type="button" onClick={() => { setLoading(true); setError(""); void load().catch((caught) => setError(caught instanceof Error ? caught.message : "Falha ao carregar perfil")).finally(() => setLoading(false)); }}>Tentar novamente</button></div>}

        <div className="full-profile-grid">
          <section><strong>SOBRE MIM</strong><p>{profile.bio || "Este usuario ainda nao escreveu uma apresentacao."}</p></section>
          <section><strong>CONTA</strong><div className="profile-detail-line"><CalendarDays size={16} /><span>Entrou no Ginga em {safeDate(data?.profile?.createdAt)}</span></div>{membership && <div className="profile-detail-line"><Server size={16} /><span>{roleLabel[membership.role] ?? "Membro"} neste espaco · entrou em {safeDate(membership.joinedAt)}</span></div>}</section>
          {sharedGuilds.length > 0 && <section className="full-profile-shared"><strong>ESPACOS EM COMUM</strong><div>{sharedGuilds.map((shared) => <span key={shared.id}><i style={{ background: shared.iconColor || "#7867e8" }}>{shared.name?.slice(0, 1).toUpperCase() || "G"}</i>{shared.name || "Espaco"}</span>)}</div></section>}
        </div>
      </div>
    </Modal>
  );
}
