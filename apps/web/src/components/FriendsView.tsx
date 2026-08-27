import { useEffect, useMemo, useState, type MouseEvent as ReactMouseEvent } from "react";
import { Ban, Check, Copy, Gamepad2, MessageCircle, Phone, Search, UserMinus, UserPlus, UserRound, Users, X } from "lucide-react";
import { api } from "../lib/api";
import { useDeveloperMode } from "../lib/developerMode";
import type { FriendEntry, FriendsPayload, User, UserSearchResult } from "../types";
import { Avatar } from "./Avatar";
import { ContextMenu } from "./ContextMenu";

type Tab = "online" | "all" | "pending" | "add" | "blocked";

type PublicGamingProfile = {
  user: { id: string; username: string; displayName: string; avatarColor: string };
  avatarUrl: string | null;
  customStatus: string | null;
  presence: "ONLINE" | "AWAY" | "BUSY" | "OFFLINE";
  activity: { type: "PLAYING"; name: string; details: string; startedAt: string | null } | null;
};

type BlockedEntry = { user: User; createdAt: string };

interface FriendsViewProps {
  data: FriendsPayload;
  onlineUserIds: Set<string>;
  onReload: () => Promise<void>;
  onStartConversation: (userId: string) => Promise<void>;
  onStartCall?: (userId: string) => Promise<void> | void;
  onUserClick?: (user: User, rect: DOMRect) => void;
}

const presenceLabel: Record<PublicGamingProfile["presence"], string> = {
  ONLINE: "Disponivel",
  AWAY: "Ausente",
  BUSY: "Ocupado",
  OFFLINE: "Offline"
};

function avatarPresence(profile: PublicGamingProfile | undefined, online: boolean): "online" | "away" | "busy" | "offline" {
  if (!profile) return online ? "online" : "offline";
  if (profile.presence === "AWAY") return "away";
  if (profile.presence === "BUSY") return "busy";
  return profile.presence === "ONLINE" ? "online" : "offline";
}

export function FriendsView({ data, onlineUserIds, onReload, onStartConversation, onStartCall, onUserClick }: FriendsViewProps) {
  const [tab, setTab] = useState<Tab>("online");
  const [query, setQuery] = useState("");
  const [friendFilter, setFriendFilter] = useState("");
  const [results, setResults] = useState<UserSearchResult[]>([]);
  const [profiles, setProfiles] = useState<Record<string, PublicGamingProfile>>({});
  const [blocked, setBlocked] = useState<BlockedEntry[]>([]);
  const [searching, setSearching] = useState(false);
  const [busyId, setBusyId] = useState("");
  const [error, setError] = useState("");
  const [friendMenu, setFriendMenu] = useState<{ entry: FriendEntry; x: number; y: number; anchor: DOMRect } | null>(null);
  const developerMode = useDeveloperMode();

  useEffect(() => {
    const usernames = data.friends.map((entry) => entry.user.username).filter(Boolean);
    if (!usernames.length) { setProfiles({}); return; }
    let active = true;
    api<{ profiles: PublicGamingProfile[] }>(`/api/gaming-profile/batch?usernames=${encodeURIComponent(usernames.join(","))}`)
      .then((response) => {
        if (!active) return;
        setProfiles(Object.fromEntries(response.profiles.map((profile) => [profile.user.id, profile])));
      })
      .catch(() => undefined);
    return () => { active = false; };
  }, [data.friends]);

  useEffect(() => {
    if (tab !== "blocked") return;
    let active = true;
    api<{ blocked: BlockedEntry[] }>("/api/users/blocked")
      .then((response) => { if (active) setBlocked(response.blocked); })
      .catch((caught) => { if (active) setError(caught instanceof Error ? caught.message : "Nao foi possivel carregar os bloqueados"); });
    return () => { active = false; };
  }, [tab]);

  useEffect(() => {
    if (query.trim().length < 1) {
      setResults([]);
      return;
    }
    const timer = window.setTimeout(() => {
      setSearching(true);
      api<{ users: UserSearchResult[] }>(`/api/users/search?q=${encodeURIComponent(query.trim())}`)
        .then((response) => setResults(response.users))
        .catch((caught) => setError(caught instanceof Error ? caught.message : "Falha na busca"))
        .finally(() => setSearching(false));
    }, 250);
    return () => window.clearTimeout(timer);
  }, [query]);

  async function sendRequest(username: string) {
    setBusyId(username);
    setError("");
    try {
      await api("/api/friends/requests", { method: "POST", body: JSON.stringify({ username }) });
      await onReload();
      if (query.trim()) {
        const response = await api<{ users: UserSearchResult[] }>(`/api/users/search?q=${encodeURIComponent(query.trim())}`);
        setResults(response.users);
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Nao foi possivel enviar a solicitacao");
    } finally {
      setBusyId("");
    }
  }

  async function accept(entry: FriendEntry) {
    setBusyId(entry.id);
    try {
      await api(`/api/friends/${entry.id}/accept`, { method: "POST" });
      await onReload();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Nao foi possivel aceitar");
    } finally {
      setBusyId("");
    }
  }

  async function remove(entry: FriendEntry) {
    setBusyId(entry.id);
    try {
      await api(`/api/friends/${entry.id}`, { method: "DELETE" });
      await onReload();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Nao foi possivel remover");
    } finally {
      setBusyId("");
    }
  }

  async function unblock(userId: string) {
    setBusyId(userId);
    try {
      await api(`/api/users/${encodeURIComponent(userId)}/block`, { method: "DELETE" });
      setBlocked((current) => current.filter((entry) => entry.user.id !== userId));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Nao foi possivel desbloquear");
    } finally {
      setBusyId("");
    }
  }

  async function openConversation(userId: string) {
    setError("");
    try { await onStartConversation(userId); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Nao foi possivel abrir a conversa"); }
  }

  function openFriendContextMenu(event: ReactMouseEvent<HTMLElement>, entry: FriendEntry) {
    event.preventDefault();
    event.stopPropagation();
    const rect = event.currentTarget.getBoundingClientRect();
    setFriendMenu({ entry, x: event.clientX + 6, y: event.clientY + 6, anchor: rect });
  }

  async function callFriend(userId: string) {
    if (!onStartCall) return;
    setError("");
    try { await onStartCall(userId); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Nao foi possivel iniciar a chamada"); }
  }

  function isOnline(entry: FriendEntry) {
    const profile = profiles[entry.user.id];
    if (profile) return profile.presence !== "OFFLINE";
    return onlineUserIds.has(entry.user.id);
  }

  function renderFriend(entry: FriendEntry, actions: "friend" | "incoming" | "outgoing") {
    const profile = profiles[entry.user.id];
    const online = isOnline(entry);
    const status = profile ? presenceLabel[profile.presence] : online ? "Disponivel" : "Offline";
    return (
      <article className="person-card ginga-friend-row" key={entry.id} onContextMenu={(event) => actions === "friend" && openFriendContextMenu(event, entry)}>
        <button className="person-identity-button" type="button" onClick={(event) => onUserClick?.(entry.user, event.currentTarget.getBoundingClientRect())}>
          <Avatar user={entry.user} size="md" status={avatarPresence(profile, online)} />
          <div className="person-main">
            <strong>{entry.user.displayName}</strong>
            <span>{profile?.activity ? `Jogando ${profile.activity.name}` : profile?.customStatus || status}</span>
          </div>
        </button>
        <div className="person-actions">
          {actions === "friend" && <button className="round-action primary-soft" onClick={() => void openConversation(entry.user.id)} aria-label={`Conversar com ${entry.user.displayName}`}><MessageCircle size={18} /></button>}
          {actions === "incoming" && <button className="round-action success" disabled={busyId === entry.id} onClick={() => void accept(entry)} aria-label="Aceitar solicitacao"><Check size={18} /></button>}
          {actions === "incoming" && <button className="round-action danger-soft" disabled={busyId === entry.id} onClick={() => void remove(entry)} aria-label="Recusar solicitacao"><X size={18} /></button>}
          {actions === "outgoing" && <span className="pending-label">Aguardando</span>}
          {actions !== "incoming" && <button className="round-action danger-soft" disabled={busyId === entry.id} onClick={() => void remove(entry)} aria-label={actions === "friend" ? "Remover amizade" : "Cancelar solicitacao"}><UserMinus size={17} /></button>}
        </div>
      </article>
    );
  }

  const filteredFriends = useMemo(() => {
    const normalized = friendFilter.trim().toLocaleLowerCase();
    const base = tab === "online" ? data.friends.filter(isOnline) : data.friends;
    if (!normalized) return base;
    return base.filter((entry) => `${entry.user.displayName} ${entry.user.username}`.toLocaleLowerCase().includes(normalized));
  }, [data.friends, friendFilter, profiles, onlineUserIds, tab]);

  const activeNow = useMemo(() => data.friends
    .map((entry) => ({ entry, profile: profiles[entry.user.id] }))
    .filter((item) => item.profile?.activity && item.profile.presence !== "OFFLINE")
    .slice(0, 8), [data.friends, profiles]);


  return (
    <section className="people-view ginga-friends-view">
      <header className="people-header discord-like-friends-header">
        <div className="friends-title"><Users size={20}/><strong>Pessoas</strong></div>
        <div className="people-tabs">
          <button className={tab === "online" ? "active" : ""} onClick={() => setTab("online")}>Disponivel</button>
          <button className={tab === "all" ? "active" : ""} onClick={() => setTab("all")}>Todos</button>
          <button className={tab === "pending" ? "active" : ""} onClick={() => setTab("pending")}>Pendentes {data.incoming.length + data.outgoing.length > 0 && <b>{data.incoming.length + data.outgoing.length}</b>}</button>
          <button className={tab === "blocked" ? "active" : ""} onClick={() => setTab("blocked")}>Bloqueados</button>
        </div>
        <div className="people-global-search">
          <Search size={15}/>
          <input value={query} onChange={(event) => { const value = event.target.value; setQuery(value); if (value.trim()) setTab("add"); else if (tab === "add") setTab("online"); }} placeholder="Buscar pessoa ou @usuario" aria-label="Buscar pessoa no Ginga" />
          {query && <button type="button" className="people-search-clear" onClick={() => { setQuery(""); if (tab === "add") setTab("online"); }} aria-label="Limpar busca"><X size={14}/></button>}
        </div>
      </header>

      <div className={`friends-layout ${tab === "add" || tab === "blocked" ? "single" : ""}`}>
        <div className="friends-main-column">
          {error && <div className="inline-error">{error}</div>}

          {(tab === "online" || tab === "all") && (
            <>
              <div className="friends-search-box"><Search size={18}/><input value={friendFilter} onChange={(event) => setFriendFilter(event.target.value)} placeholder="Buscar" /></div>
              <div className="people-section flat-friends-list">
                <div className="section-heading"><strong>{tab === "online" ? "ONLINE" : "TODOS OS AMIGOS"}</strong><span>{filteredFriends.length}</span></div>
                {filteredFriends.length === 0 ? <div className="friends-empty-state"><Users size={36}/><h3>{tab === "online" ? "Ninguem online agora" : "Nenhum amigo encontrado"}</h3><p>{tab === "online" ? "Quando seus amigos entrarem no Ginga, eles aparecem aqui." : "Adicione pessoas para conversar, jogar e entrar em chamadas."}</p></div> : filteredFriends.map((entry) => renderFriend(entry, "friend"))}
              </div>
            </>
          )}

          {tab === "pending" && (
            <div className="pending-grid friends-pending-grid">
              <div className="people-section flat-friends-list"><div className="section-heading"><strong>RECEBIDAS</strong><span>{data.incoming.length}</span></div>{data.incoming.length === 0 ? <div className="friends-empty-state compact"><p>Nenhuma solicitacao recebida.</p></div> : data.incoming.map((entry) => renderFriend(entry, "incoming"))}</div>
              <div className="people-section flat-friends-list"><div className="section-heading"><strong>ENVIADAS</strong><span>{data.outgoing.length}</span></div>{data.outgoing.length === 0 ? <div className="friends-empty-state compact"><p>Nenhuma solicitacao enviada.</p></div> : data.outgoing.map((entry) => renderFriend(entry, "outgoing"))}</div>
            </div>
          )}

          {tab === "add" && (
            <div className="people-section add-friend-section discord-add-friend">
              <div className="add-friend-copy"><h2>Encontrar pessoas</h2><p>Pesquise por nome ou @usuario. Voce pode abrir o perfil, iniciar uma conversa quando permitido ou enviar uma solicitacao de amizade.</p></div>
              {searching && <div className="search-state">Buscando...</div>}
              {!searching && query.trim() && results.length === 0 && <div className="search-state">Nenhum usuario encontrado.</div>}
              <div className="search-results">{results.map((result) => {
                const relation = result.friendship;
                return <article className="person-card ginga-friend-row" key={result.id}>
                  <button className="person-identity-button" type="button" onClick={(event) => onUserClick?.(result, event.currentTarget.getBoundingClientRect())}><Avatar user={result} size="md" status={onlineUserIds.has(result.id) ? "online" : "offline"}/><div className="person-main"><strong>{result.displayName}</strong><span>@{result.username}</span></div></button>
                  {!relation && <button className="secondary-button compact-button" disabled={busyId === result.username} onClick={() => void sendRequest(result.username)}><UserPlus size={16}/> Enviar solicitacao</button>}
                  {relation?.status === "ACCEPTED" && <span className="relationship-chip"><Check size={14}/> Amigo</span>}
                  {relation?.status === "PENDING" && relation.direction === "OUTGOING" && <span className="relationship-chip muted">Solicitacao enviada</span>}
                  {relation?.status === "PENDING" && relation.direction === "INCOMING" && <span className="relationship-chip">Solicitacao recebida</span>}
                </article>;
              })}</div>
            </div>
          )}

          {tab === "blocked" && (
            <div className="people-section flat-friends-list blocked-list">
              <div className="section-heading"><strong>USUARIOS BLOQUEADOS</strong><span>{blocked.length}</span></div>
              {blocked.length === 0 ? <div className="friends-empty-state"><Ban size={34}/><h3>Ninguem bloqueado</h3><p>Usuarios bloqueados nao podem enviar novas mensagens, chamadas ou solicitacoes de amizade para voce.</p></div> : blocked.map((entry) => <article className="person-card ginga-friend-row" key={entry.user.id}><button className="person-identity-button" type="button" onClick={(event) => onUserClick?.(entry.user, event.currentTarget.getBoundingClientRect())}><Avatar user={entry.user} size="md" status="offline"/><div className="person-main"><strong>{entry.user.displayName}</strong><span>@{entry.user.username}</span></div></button><button className="secondary-button compact-button" disabled={busyId === entry.user.id} onClick={() => void unblock(entry.user.id)}>Desbloquear</button></article>)}
            </div>
          )}
        </div>

        {tab !== "add" && tab !== "blocked" && <aside className="active-now-panel">
          <h2>Ativo agora</h2>
          {activeNow.length === 0 ? <div className="active-now-empty"><Gamepad2 size={28}/><strong>Por enquanto, tudo quieto.</strong><p>Quando seus amigos estiverem jogando ou em atividade, isso aparece aqui.</p></div> : activeNow.map(({ entry, profile }) => <button key={entry.user.id} className="active-now-card" onClick={(event) => onUserClick?.(entry.user, event.currentTarget.getBoundingClientRect())}><div className="active-now-user"><Avatar user={entry.user} size="sm" status="online"/><div><strong>{entry.user.displayName}</strong><span>{profile?.customStatus || "Ativo no Ginga"}</span></div></div>{profile?.activity && <div className="active-now-activity"><Gamepad2 size={18}/><div><strong>{profile.activity.name}</strong><span>{profile.activity.details}</span></div></div>}</button>)}
        </aside>}
      </div>

      {friendMenu && (
        <ContextMenu x={friendMenu.x} y={friendMenu.y} onClose={() => setFriendMenu(null)}>
          <div className="user-context-menu-head">
            <Avatar user={friendMenu.entry.user} size="sm" status={isOnline(friendMenu.entry) ? "online" : "offline"} />
            <div><strong>{friendMenu.entry.user.displayName}</strong><span>@{friendMenu.entry.user.username}</span></div>
          </div>
          <button type="button" onClick={() => { onUserClick?.(friendMenu.entry.user, friendMenu.anchor); setFriendMenu(null); }}><UserRound size={15}/> Ver perfil</button>
          <button type="button" onClick={() => { const id = friendMenu.entry.user.id; setFriendMenu(null); void openConversation(id); }}><MessageCircle size={15}/> Mensagem</button>
          {onStartCall && <button type="button" onClick={() => { const id = friendMenu.entry.user.id; setFriendMenu(null); void callFriend(id); }}><Phone size={15}/> Iniciar chamada</button>}
          <div className="context-menu-separator" />
          <button type="button" onClick={() => { void navigator.clipboard.writeText(`@${friendMenu.entry.user.username}`); setFriendMenu(null); }}><Copy size={15}/> Copiar nome de usuario</button>
          {developerMode && <button type="button" onClick={() => { void navigator.clipboard.writeText(friendMenu.entry.user.id); setFriendMenu(null); }}><Copy size={15}/> Copiar ID do usuario</button>}
          <div className="context-menu-separator" />
          <button type="button" className="danger" disabled={busyId === friendMenu.entry.id} onClick={() => { const entry = friendMenu.entry; setFriendMenu(null); void remove(entry); }}><UserMinus size={15}/> Remover amizade</button>
        </ContextMenu>
      )}
    </section>
  );
}
