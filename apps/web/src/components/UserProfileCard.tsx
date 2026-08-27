import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { Ban, Check, ExternalLink, MessageCircle, Settings, ShieldCheck, UserPlus, X } from "lucide-react";
import { api } from "../lib/api";
import type { GuildRole, User, UserProfilePayload } from "../types";
import { Avatar } from "./Avatar";
import { UserBadges } from "./UserBadges";

import { gingaConfirm } from "../lib/dialogs";
export interface ProfileAnchor {
  top: number;
  left: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
}

interface UserProfileCardProps {
  user: User;
  currentUser: User;
  guildId?: string;
  online: boolean;
  anchor: ProfileAnchor;
  role?: GuildRole;
  joinedAt?: string;
  onClose: () => void;
  onMessage: (userId: string) => Promise<void>;
  onOpenProfile: (user: User) => void;
  onEditProfile: () => void;
  onSocialRefresh: () => Promise<void>;
}

const roleLabel: Record<GuildRole, string> = {
  OWNER: "Proprietario",
  ADMIN: "Administrador",
  MODERATOR: "Moderador",
  MEMBER: "Membro"
};

function safeProfileDate(value?: string | null) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  try { return new Intl.DateTimeFormat("pt-BR").format(date); } catch { return ""; }
}

export function UserProfileCard({ user, currentUser, guildId, online, anchor, role, joinedAt, onClose, onMessage, onOpenProfile, onEditProfile, onSocialRefresh }: UserProfileCardProps) {
  const [data, setData] = useState<UserProfilePayload | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const cardRef = useRef<HTMLDivElement>(null);
  const isSelf = user.id === currentUser.id;

  const effectiveUser = data?.profile ?? user;
  const effectiveRole = data?.guildMembership?.role ?? role;
  const effectiveJoinedAt = data?.guildMembership?.joinedAt ?? joinedAt;
  const sharedGuilds = Array.isArray(data?.sharedGuilds) ? data.sharedGuilds : [];
  const effectiveJoinedLabel = safeProfileDate(effectiveJoinedAt);
  const isSystemIdentity = effectiveUser.accountType === "SYSTEM";
  const isHumanIdentity = effectiveUser.accountType === undefined || effectiveUser.accountType === "HUMAN";

  useEffect(() => {
    let active = true;
    setData(null);
    setError("");
    const query = guildId ? `?guildId=${encodeURIComponent(guildId)}` : "";
    api<UserProfilePayload>(`/api/users/${user.id}/profile${query}`)
      .then((result) => { if (active) setData(result); })
      .catch((caught) => { if (active) setError(caught instanceof Error ? caught.message : "Falha ao carregar perfil"); });
    return () => { active = false; };
  }, [guildId, user.id]);

  useEffect(() => {
    const closeOnPointer = (event: PointerEvent) => {
      if (!cardRef.current?.contains(event.target as Node)) onClose();
    };
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("pointerdown", closeOnPointer);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.removeEventListener("pointerdown", closeOnPointer);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [onClose]);

  const cardStyle = useMemo(() => {
    const width = Math.min(350, window.innerWidth - 24);
    const gap = 12;
    const roomRight = window.innerWidth - anchor.right;
    const roomLeft = anchor.left;
    const preferredLeft = roomRight >= width + gap
      ? anchor.right + gap
      : roomLeft >= width + gap
        ? anchor.left - width - gap
        : anchor.left;
    const left = Math.min(Math.max(12, preferredLeft), Math.max(12, window.innerWidth - width - 12));
    const estimatedHeight = 470;
    const top = Math.min(
      Math.max(12, anchor.top - 8),
      Math.max(12, window.innerHeight - estimatedHeight - 12)
    );
    return { left, top, width } as CSSProperties;
  }, [anchor]);

  async function requestFriend() {
    setBusy(true); setError("");
    try {
      await api("/api/friends/requests", { method: "POST", body: JSON.stringify({ username: effectiveUser.username }) });
      await Promise.all([onSocialRefresh(), reload()]);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Nao foi possivel enviar a solicitacao");
    } finally { setBusy(false); }
  }

  async function acceptFriend() {
    if (!data?.friendship) return;
    setBusy(true); setError("");
    try {
      await api(`/api/friends/${data.friendship.id}/accept`, { method: "POST" });
      await Promise.all([onSocialRefresh(), reload()]);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Nao foi possivel aceitar a solicitacao");
    } finally { setBusy(false); }
  }

  async function reload() {
    const query = guildId ? `?guildId=${encodeURIComponent(guildId)}` : "";
    const result = await api<UserProfilePayload>(`/api/users/${user.id}/profile${query}`);
    setData(result);
  }

  async function toggleBlock() {
    if (isSelf || !data) return;
    const currentlyBlocked = Boolean(data.block?.blockedByViewer);
    if (!currentlyBlocked && !(await gingaConfirm(`A pessoa nao podera enviar novas mensagens, chamadas ou solicitacoes de amizade para voce.`, { title: `Bloquear ${effectiveUser.displayName}?`, confirmLabel: "Bloquear", tone: "danger" }))) return;
    setBusy(true); setError("");
    try {
      await api(`/api/users/${encodeURIComponent(user.id)}/block`, { method: currentlyBlocked ? "DELETE" : "POST" });
      await Promise.all([onSocialRefresh(), reload()]);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Nao foi possivel atualizar o bloqueio");
    } finally { setBusy(false); }
  }

  async function messageUser() {
    setBusy(true); setError("");
    try {
      await onMessage(user.id);
      onClose();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Nao foi possivel abrir a conversa");
    } finally { setBusy(false); }
  }

  const friendship = data?.friendship;

  const card = (
    <div className="user-popover" ref={cardRef} style={cardStyle}>
      <button className="user-popover-close" onClick={onClose}><X size={16} /></button>
      <div className="user-popover-banner" style={{ background: effectiveUser.avatarColor }} />
      <div className="user-popover-avatar"><Avatar user={effectiveUser} size="xl" status={online ? "online" : "offline"} /></div>
      <div className="user-popover-content">
        <div className="user-popover-name"><h3>{effectiveUser.displayName} <UserBadges user={effectiveUser} compact /></h3><span>@{effectiveUser.username}</span></div>
        {isSystemIdentity ? (
          <div className="user-popover-system-identity">
            <span className="system-identity-icon"><ShieldCheck size={18}/></span>
            <div><strong>IDENTIDADE DO SISTEMA</strong><p>Conta interna do Ginga usada para avisos automaticos, como entrada e saida de membros. Ela nao representa uma pessoa e nao pode receber amizade, mensagem, timeout, expulsao ou banimento.</p></div>
          </div>
        ) : (
          <>
            <div className="user-popover-presence"><i className={online ? "online" : ""} /><span>{online ? "Online agora" : "Offline"}</span></div>
            {effectiveUser.statusMessage && <div className="user-popover-status">{effectiveUser.statusMessage}</div>}
            <div className="user-popover-about"><strong>SOBRE MIM</strong><p>{effectiveUser.bio || "Este usuario ainda nao adicionou uma descricao."}</p></div>
            {(effectiveRole || effectiveJoinedAt) && <div className="user-popover-server"><strong>NESTE ESPACO</strong>{effectiveRole && <span>{roleLabel[effectiveRole]}</span>}{effectiveJoinedLabel && <span>Membro desde {effectiveJoinedLabel}</span>}</div>}
            {data && sharedGuilds.length > 0 && <div className="user-popover-shared"><strong>{sharedGuilds.length}</strong><span>espaco{sharedGuilds.length === 1 ? "" : "s"} em comum</span></div>}
          </>
        )}
        {error && !isSystemIdentity && <div className="profile-card-error">{error}</div>}
        {isHumanIdentity && <div className="user-popover-actions">
          {isSelf ? (
            <button className="primary-button" onClick={() => { onClose(); onEditProfile(); }}><Settings size={16} /> Editar perfil</button>
          ) : (
            <button className="primary-button" disabled={busy || !data || Boolean(data.block) || (friendship?.status !== "ACCEPTED" && sharedGuilds.length === 0)} onClick={() => void messageUser()}><MessageCircle size={16} /> Mensagem</button>
          )}
          <button className="secondary-button" onClick={() => { onClose(); onOpenProfile(effectiveUser); }}><ExternalLink size={16} /> Ver perfil</button>
        </div>}
        {!isSelf && isHumanIdentity && (
          <div className="user-popover-friendship">
            {data?.block?.blockedViewer && !data.block.blockedByViewer ? <span className="profile-blocked-note">Este usuario bloqueou voce.</span> : null}
            {!data?.block?.blockedViewer && (friendship?.status === "ACCEPTED" ? (
              <span><Check size={14} /> Voces sao amigos</span>
            ) : friendship?.status === "PENDING" && friendship.direction === "INCOMING" ? (
              <button type="button" disabled={busy} onClick={() => void acceptFriend()}><Check size={14} /> Aceitar solicitacao de amizade</button>
            ) : friendship?.status === "PENDING" ? (
              <span><Check size={14} /> Solicitacao de amizade enviada</span>
            ) : (
              <button type="button" disabled={busy || !data} onClick={() => void requestFriend()}><UserPlus size={14} /> Adicionar amigo</button>
            ))}
            <button type="button" className="danger-link" disabled={busy || !data} onClick={() => void toggleBlock()}><Ban size={14}/> {data?.block?.blockedByViewer ? "Desbloquear usuario" : "Bloquear usuario"}</button>
          </div>
        )}
      </div>
    </div>
  );

  return createPortal(card, document.body);
}
