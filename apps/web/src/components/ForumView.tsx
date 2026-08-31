import { useCallback, useEffect, useMemo, useState, type CSSProperties, type FormEvent } from "react";
import {
  Check,
  ChevronDown,
  Copy,
  Filter,
  Hash,
  Image as ImageIcon,
  ImagePlus,
  Lock,
  MessageCircle,
  MessageSquareText,
  MoreHorizontal,
  Pin,
  Plus,
  Search,
  Send,
  Tag,
  Trash2,
  X
} from "lucide-react";
import { api } from "../lib/api";
import { useDeveloperMode } from "../lib/developerMode";
import type { Channel, ForumAppearance, ForumPost, ForumTag, User } from "../types";
import { Avatar } from "./Avatar";
import { UserBadges } from "./UserBadges";

interface ForumViewProps {
  channel: Channel;
  currentUser: User;
  socket?: {
    on?: (event: string, listener: (payload: any) => void) => void;
    off?: (event: string, listener: (payload: any) => void) => void;
  };
  canManage?: boolean;
}

interface ForumDetail extends ForumPost {
  comments: Array<{ id: string; content: string; createdAt: string; author: User }>;
}

type ForumFilter = "ALL" | "OPEN" | "CLOSED" | "PINNED";
type ForumSort = "ACTIVITY" | "NEWEST" | "COMMENTS";

type ForumReadMap = Record<string, string>;

function readStorageKey(channelId: string) {
  return `ginga.forum.read.v1.${channelId}`;
}

function loadReadMap(channelId: string): ForumReadMap {
  try {
    const parsed = JSON.parse(localStorage.getItem(readStorageKey(channelId)) || "{}") as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(Object.entries(parsed as Record<string, unknown>).filter((entry): entry is [string, string] => typeof entry[1] === "string"));
  } catch {
    return {};
  }
}

function saveReadMap(channelId: string, value: ForumReadMap) {
  try { localStorage.setItem(readStorageKey(channelId), JSON.stringify(value)); } catch { /* Preferência local opcional. */ }
}

function activityDate(post: ForumPost) {
  return post.lastActivityAt || post.updatedAt || post.createdAt;
}

function relativeTime(value: string) {
  const date = new Date(value);
  const delta = Math.max(0, Date.now() - date.getTime());
  const min = Math.floor(delta / 60_000);
  if (min < 1) return "agora";
  if (min < 60) return `${min} min`;
  const hour = Math.floor(min / 60);
  if (hour < 24) return `${hour} h`;
  const days = Math.floor(hour / 24);
  if (days < 7) return `${days} d`;
  return new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "short" }).format(date);
}

function commentCount(post: ForumPost) {
  return post.commentCount ?? post._count?.comments ?? 0;
}

export function ForumView({ channel, currentUser, socket, canManage = false }: ForumViewProps) {
  const developerMode = useDeveloperMode();
  const [tags, setTags] = useState<ForumTag[]>([]);
  const [posts, setPosts] = useState<ForumPost[]>([]);
  const [selected, setSelected] = useState<ForumDetail | null>(null);
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [filter, setFilter] = useState<ForumFilter>("ALL");
  const [sort, setSort] = useState<ForumSort>("ACTIVITY");
  const [selectedTagId, setSelectedTagId] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [showTagManager, setShowTagManager] = useState(false);
  const [busyPostId, setBusyPostId] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [readMap, setReadMap] = useState<ForumReadMap>(() => loadReadMap(channel.id));
  const [appearance, setAppearance] = useState<ForumAppearance>({ iconUrl: null, bannerUrl: null });
  const [showAppearance, setShowAppearance] = useState(false);
  const [appearanceBusy, setAppearanceBusy] = useState<"icon" | "banner" | "">("");

  useEffect(() => {
    setReadMap(loadReadMap(channel.id));
    setSelected(null);
    setSelectedTagId("");
    setFilter("ALL");
    setQuery("");
    setDebouncedQuery("");
    setAppearance({ iconUrl: null, bannerUrl: null });
    setShowAppearance(false);
  }, [channel.id]);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedQuery(query.trim()), 260);
    return () => window.clearTimeout(timer);
  }, [query]);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({ includeClosed: "true" });
      if (debouncedQuery) params.set("q", debouncedQuery);
      if (selectedTagId) params.set("tagId", selectedTagId);
      const result = await api<{ tags: ForumTag[]; posts: ForumPost[]; appearance?: ForumAppearance }>(`/api/channels/${channel.id}/forum?${params.toString()}`);
      setTags(result.tags);
      setPosts(result.posts);
      if (result.appearance) setAppearance(result.appearance);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Falha ao carregar o fórum");
    } finally {
      setLoading(false);
    }
  }, [channel.id, debouncedQuery, selectedTagId]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    const onChanged = (payload: { channelId?: string; postId?: string }) => {
      if (!payload.channelId || payload.channelId === channel.id) void load();
    };
    const onComment = (payload: { postId?: string }) => {
      if (payload.postId && selected?.id === payload.postId) void openPost(payload.postId);
      void load();
    };
    const onAppearance = (payload: { channelId?: string; appearance?: ForumAppearance }) => {
      if (payload.channelId === channel.id && payload.appearance) setAppearance(payload.appearance);
    };
    socket?.on?.("forum:changed", onChanged);
    socket?.on?.("forum:comment:new", onComment);
    socket?.on?.("forum:appearance", onAppearance);
    return () => {
      socket?.off?.("forum:changed", onChanged);
      socket?.off?.("forum:comment:new", onComment);
      socket?.off?.("forum:appearance", onAppearance);
    };
  }, [channel.id, load, selected?.id, socket]);

  const visiblePosts = useMemo(() => {
    let next = posts.filter((post) => {
      if (filter === "OPEN") return post.status === "OPEN";
      if (filter === "CLOSED") return post.status === "CLOSED";
      if (filter === "PINNED") return post.pinned;
      return true;
    });
    next = [...next].sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
      if (sort === "NEWEST") return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      if (sort === "COMMENTS") return commentCount(b) - commentCount(a);
      return new Date(activityDate(b)).getTime() - new Date(activityDate(a)).getTime();
    });
    return next;
  }, [filter, posts, sort]);

  const unreadCount = useMemo(() => posts.filter((post) => {
    const readAt = readMap[post.id];
    return !readAt || new Date(readAt).getTime() < new Date(activityDate(post)).getTime();
  }).length, [posts, readMap]);

  const openCount = useMemo(() => posts.filter((post) => post.status === "OPEN").length, [posts]);
  const totalComments = useMemo(() => posts.reduce((total, post) => total + commentCount(post), 0), [posts]);

  function isUnread(post: ForumPost) {
    const readAt = readMap[post.id];
    return !readAt || new Date(readAt).getTime() < new Date(activityDate(post)).getTime();
  }

  function markRead(post: ForumPost) {
    setReadMap((current) => {
      const next = { ...current, [post.id]: new Date().toISOString() };
      saveReadMap(channel.id, next);
      return next;
    });
  }

  function markAllRead() {
    const now = new Date().toISOString();
    const next = { ...readMap };
    posts.forEach((post) => { next[post.id] = now; });
    saveReadMap(channel.id, next);
    setReadMap(next);
  }

  async function createPost(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setError("");
    try {
      const result = await api<{ post: ForumPost }>(`/api/channels/${channel.id}/forum/posts`, {
        method: "POST",
        body: JSON.stringify({
          title: String(form.get("title") || ""),
          content: String(form.get("content") || ""),
          tagIds: form.getAll("tagIds").map(String)
        })
      });
      setShowCreate(false);
      await load();
      await openPost(result.post.id);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Não foi possível criar o tópico");
    }
  }

  async function openPost(id: string) {
    try {
      const result = await api<{ post: ForumDetail }>(`/api/forum/posts/${id}`);
      setSelected(result.post);
      markRead(result.post);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Não foi possível abrir o tópico");
    }
  }

  async function reply(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected) return;
    const form = new FormData(event.currentTarget);
    const content = String(form.get("content") || "").trim();
    if (!content) return;
    setBusyPostId(selected.id);
    try {
      await api(`/api/forum/posts/${selected.id}/comments`, { method: "POST", body: JSON.stringify({ content }) });
      event.currentTarget.reset();
      await openPost(selected.id);
      await load();
    } finally {
      setBusyPostId("");
    }
  }

  async function patchPost(post: ForumPost, patch: { status?: "OPEN" | "CLOSED"; pinned?: boolean }) {
    setBusyPostId(post.id);
    setError("");
    try {
      await api(`/api/forum/posts/${post.id}`, { method: "PATCH", body: JSON.stringify(patch) });
      await load();
      if (selected?.id === post.id) await openPost(post.id);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Não foi possível atualizar o tópico");
    } finally {
      setBusyPostId("");
    }
  }

  async function createTag(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setError("");
    try {
      await api(`/api/channels/${channel.id}/forum/tags`, {
        method: "POST",
        body: JSON.stringify({ name: String(form.get("name") || ""), color: String(form.get("color") || "#7c6cff") })
      });
      event.currentTarget.reset();
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Não foi possível criar a tag");
    }
  }

  async function deleteTag(tagId: string) {
    setError("");
    try {
      await api(`/api/forum/tags/${tagId}`, { method: "DELETE" });
      if (selectedTagId === tagId) setSelectedTagId("");
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Não foi possível remover a tag");
    }
  }

  async function uploadAppearanceAsset(kind: "icon" | "banner", file: File | null) {
    if (!file) return;
    if (!["image/png", "image/jpeg", "image/webp", "image/gif"].includes(file.type)) {
      setError("Use PNG, JPG, WebP ou GIF.");
      return;
    }
    const max = kind === "icon" ? 4 * 1024 * 1024 : 10 * 1024 * 1024;
    if (file.size > max) {
      setError(kind === "icon" ? "A foto do fórum pode ter no máximo 4 MB." : "O banner do fórum pode ter no máximo 10 MB.");
      return;
    }
    setAppearanceBusy(kind);
    setError("");
    try {
      const result = await api<{ appearance: ForumAppearance }>(`/api/channels/${channel.id}/forum/${kind}`, {
        method: "POST",
        headers: { "Content-Type": file.type },
        body: file
      });
      setAppearance(result.appearance);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Não foi possível atualizar a imagem do fórum");
    } finally {
      setAppearanceBusy("");
    }
  }

  async function removeAppearanceAsset(kind: "icon" | "banner") {
    setAppearanceBusy(kind);
    setError("");
    try {
      await api<void>(`/api/channels/${channel.id}/forum/${kind}`, { method: "DELETE" });
      setAppearance((current) => ({ ...current, [kind === "icon" ? "iconUrl" : "bannerUrl"]: null }));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Não foi possível remover a imagem do fórum");
    } finally {
      setAppearanceBusy("");
    }
  }

  return (
    <section className="feature-view forum-view ginga-surface-forum forum-v2">
      <header className={`content-header forum-content-header ${appearance.bannerUrl ? "with-banner" : ""}`}>
        {appearance.bannerUrl && <img className="forum-channel-banner" src={appearance.bannerUrl} alt=""/>}
        <div className="forum-channel-brand">
          <span className="forum-channel-icon">{appearance.iconUrl ? <img src={appearance.iconUrl} alt=""/> : <MessageSquareText size={21}/>}</span>
          <div><div className="channel-title"><strong>{channel.name}</strong></div><span className="channel-topic">{channel.topic || "Discussões organizadas por tópicos e tags"}</span></div>
        </div>
        <div className="forum-header-actions">
          {unreadCount > 0 && <button type="button" className="forum-ghost-action" onClick={markAllRead}><Check size={15}/> Marcar como lido</button>}
          {canManage && <button type="button" className="forum-ghost-action" onClick={() => setShowAppearance(true)}><ImageIcon size={15}/> Aparência</button>}
          {canManage && <button type="button" className="forum-ghost-action" onClick={() => setShowTagManager(true)}><Tag size={15}/> Tags</button>}
          <button className="primary-button compact" onClick={() => setShowCreate(true)}><Plus size={16}/> Novo tópico</button>
        </div>
      </header>

      <section className="forum-overview-strip">
        <div><span className="forum-overview-icon"><MessageSquareText size={18}/></span><strong>{posts.length}</strong><small>tópicos</small></div>
        <div><span className="forum-overview-icon"><MessageCircle size={18}/></span><strong>{totalComments}</strong><small>respostas</small></div>
        <div><span className="forum-overview-icon"><Hash size={18}/></span><strong>{openCount}</strong><small>abertos</small></div>
        <div className={unreadCount > 0 ? "unread" : ""}><span className="forum-overview-icon"><MoreHorizontal size={18}/></span><strong>{unreadCount}</strong><small>novos</small></div>
      </section>

      <div className="forum-toolbar-v2">
        <div className="forum-toolbar-search"><Search size={17}/><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar por título ou conteúdo..."/></div>
        <div className="forum-filter-group">
          <Filter size={15}/>
          {(["ALL", "OPEN", "CLOSED", "PINNED"] as ForumFilter[]).map((value) => {
            const labels: Record<ForumFilter, string> = { ALL: "Todos", OPEN: "Abertos", CLOSED: "Fechados", PINNED: "Fixados" };
            return <button type="button" className={filter === value ? "active" : ""} onClick={() => setFilter(value)} key={value}>{labels[value]}</button>;
          })}
        </div>
        <label className="forum-select-wrap"><Tag size={14}/><select value={selectedTagId} onChange={(event) => setSelectedTagId(event.target.value)}><option value="">Todas as tags</option>{tags.map((tag) => <option key={tag.id} value={tag.id}>{tag.name}</option>)}</select><ChevronDown size={14}/></label>
        <label className="forum-select-wrap"><select value={sort} onChange={(event) => setSort(event.target.value as ForumSort)}><option value="ACTIVITY">Atividade recente</option><option value="NEWEST">Mais novos</option><option value="COMMENTS">Mais respostas</option></select><ChevronDown size={14}/></label>
      </div>

      {error && <div className="inline-alert danger forum-inline-error">{error}</div>}

      <div className="forum-list-v2">
        {loading && <div className="center-state">Carregando tópicos...</div>}
        {!loading && visiblePosts.map((post) => {
          const unread = isUnread(post);
          return (
            <article className={`forum-topic-row ${unread ? "unread" : "read"} ${post.status === "CLOSED" ? "closed" : ""}`} key={post.id}>
              <button type="button" className="forum-topic-main" onClick={() => void openPost(post.id)}>
                <span className="forum-topic-avatar"><Avatar user={post.author} size="md"/></span>
                <span className="forum-topic-copy">
                  <span className="forum-topic-title-line">
                    {post.pinned && <Pin size={14} className="forum-pin-icon"/>}
                    {post.status === "CLOSED" && <Lock size={14} className="forum-lock-icon"/>}
                    <strong>{post.title}</strong>
                    {unread && <em>NOVO</em>}
                  </span>
                  <span className="forum-topic-preview">{post.content}</span>
                  <span className="forum-topic-meta">
                    <b>{post.author.displayName} <UserBadges user={post.author} compact/></b>
                    <i>·</i><time title={new Date(activityDate(post)).toLocaleString("pt-BR")}>atividade {relativeTime(activityDate(post))}</time>
                    {post.tags?.map((tag) => <span className="forum-tag-pill" style={{ "--tag-color": tag.color } as CSSProperties} key={tag.id}>{tag.name}</span>)}
                  </span>
                </span>
                <span className="forum-topic-stats"><MessageCircle size={16}/><strong>{commentCount(post)}</strong><small>respostas</small></span>
              </button>
              {(canManage || post.author.id === currentUser.id) && (
                <div className="forum-topic-actions">
                  {canManage && <button type="button" title={post.pinned ? "Desafixar" : "Fixar"} onClick={() => void patchPost(post, { pinned: !post.pinned })} disabled={busyPostId === post.id}><Pin size={15}/></button>}
                  <button type="button" title={post.status === "OPEN" ? "Fechar tópico" : "Reabrir tópico"} onClick={() => void patchPost(post, { status: post.status === "OPEN" ? "CLOSED" : "OPEN" })} disabled={busyPostId === post.id}>{post.status === "OPEN" ? <Lock size={15}/> : <MessageCircle size={15}/>}</button>
                </div>
              )}
            </article>
          );
        })}
        {!loading && visiblePosts.length === 0 && (
          <div className="forum-empty-v2"><MessageSquareText size={28}/><strong>Nenhum tópico por aqui</strong><span>{query || selectedTagId || filter !== "ALL" ? "Tente remover os filtros ou buscar por outro termo." : "Crie o primeiro tópico e organize a conversa por assunto."}</span><button className="primary-button compact" onClick={() => setShowCreate(true)}><Plus size={15}/> Criar tópico</button></div>
        )}
      </div>

      {showCreate && (
        <div className="overlay-sheet">
          <form className="sheet-card stack-form forum-create-sheet" onSubmit={createPost}>
            <header><div><span className="sheet-eyebrow">NOVO TÓPICO</span><h3>Comece uma discussão</h3><p>Dê um título claro, explique o contexto e use tags para facilitar a busca.</p></div><button type="button" onClick={() => setShowCreate(false)}><X/></button></header>
            <label>Título<input name="title" required maxLength={120} placeholder="Ex.: Ideias para o próximo evento" autoFocus/></label>
            <label>Mensagem<textarea name="content" required maxLength={12000} rows={8} placeholder="Escreva o contexto, detalhes e o que você espera da conversa..."/></label>
            {tags.length > 0 && <fieldset className="tag-picker-v2"><legend>Tags</legend>{tags.map((tag) => <label key={tag.id}><input type="checkbox" name="tagIds" value={tag.id}/><span style={{ "--tag-color": tag.color } as CSSProperties}>{tag.name}</span></label>)}</fieldset>}
            <footer className="sheet-actions"><button type="button" className="secondary-button" onClick={() => setShowCreate(false)}>Cancelar</button><button className="primary-button"><Plus size={15}/> Publicar tópico</button></footer>
          </form>
        </div>
      )}

      {showAppearance && canManage && (
        <div className="overlay-sheet forum-appearance-overlay">
          <div className="sheet-card forum-appearance-sheet">
            <header><div><span className="sheet-eyebrow">IDENTIDADE DO FÓRUM</span><h3>Banner e foto</h3><p>PNG, JPG, WebP e GIF são preservados. GIF continua animado no banner e na foto.</p></div><button type="button" onClick={() => setShowAppearance(false)}><X/></button></header>
            <div className="forum-appearance-grid">
              <section>
                <div className="forum-appearance-preview icon">{appearance.iconUrl ? <img src={appearance.iconUrl} alt="Foto atual do fórum"/> : <MessageSquareText size={34}/>}</div>
                <div><strong>Foto do fórum</strong><span>Quadrada, até 4 MB.</span></div>
                <label className="secondary-button"><ImagePlus size={15}/> {appearanceBusy === "icon" ? "Enviando..." : "Escolher imagem"}<input type="file" accept="image/png,image/jpeg,image/webp,image/gif" disabled={Boolean(appearanceBusy)} onChange={(event) => { const file = event.target.files?.[0] ?? null; event.currentTarget.value = ""; void uploadAppearanceAsset("icon", file); }}/></label>
                {appearance.iconUrl && <button type="button" className="forum-remove-asset" disabled={Boolean(appearanceBusy)} onClick={() => void removeAppearanceAsset("icon")}><Trash2 size={14}/> Remover</button>}
              </section>
              <section>
                <div className="forum-appearance-preview banner">{appearance.bannerUrl ? <img src={appearance.bannerUrl} alt="Banner atual do fórum"/> : <ImageIcon size={34}/>}</div>
                <div><strong>Banner do fórum</strong><span>Até 10 MB. GIF animado suportado.</span></div>
                <label className="secondary-button"><ImagePlus size={15}/> {appearanceBusy === "banner" ? "Enviando..." : "Escolher banner"}<input type="file" accept="image/png,image/jpeg,image/webp,image/gif" disabled={Boolean(appearanceBusy)} onChange={(event) => { const file = event.target.files?.[0] ?? null; event.currentTarget.value = ""; void uploadAppearanceAsset("banner", file); }}/></label>
                {appearance.bannerUrl && <button type="button" className="forum-remove-asset" disabled={Boolean(appearanceBusy)} onClick={() => void removeAppearanceAsset("banner")}><Trash2 size={14}/> Remover</button>}
              </section>
            </div>
          </div>
        </div>
      )}

      {showTagManager && canManage && (
        <div className="overlay-sheet">
          <div className="sheet-card forum-tags-sheet">
            <header><div><span className="sheet-eyebrow">ORGANIZAÇÃO</span><h3>Tags do fórum</h3><p>Crie categorias visuais para deixar os tópicos mais fáceis de encontrar.</p></div><button type="button" onClick={() => setShowTagManager(false)}><X/></button></header>
            <form className="forum-tag-create" onSubmit={createTag}><input name="name" required maxLength={32} placeholder="Nome da tag"/><input name="color" type="color" defaultValue="#7c6cff" aria-label="Cor da tag"/><button className="primary-button compact"><Plus size={15}/> Criar</button></form>
            <div className="forum-tag-manager-list">
              {tags.map((tag) => <div key={tag.id}><span className="forum-tag-pill" style={{ "--tag-color": tag.color } as CSSProperties}>{tag.name}</span><button type="button" onClick={() => void deleteTag(tag.id)} aria-label={`Remover tag ${tag.name}`}><Trash2 size={15}/></button></div>)}
              {tags.length === 0 && <div className="forum-tags-empty">Nenhuma tag criada ainda.</div>}
            </div>
          </div>
        </div>
      )}

      {selected && (
        <div className="overlay-sheet forum-detail-overlay">
          <div className="sheet-card forum-detail-v2">
            <header className="forum-detail-header">
              <div>
                <div className="forum-detail-kickers">{selected.pinned && <span><Pin size={12}/> Fixado</span>}{selected.status === "CLOSED" && <span><Lock size={12}/> Fechado</span>}{selected.tags?.map((tag) => <span className="forum-tag-pill" style={{ "--tag-color": tag.color } as CSSProperties} key={tag.id}>{tag.name}</span>)}</div>
                <h3>{selected.title}</h3>
                <p>por <strong>{selected.author.displayName}</strong> · {new Date(selected.createdAt).toLocaleString("pt-BR")}</p>
              </div>
              <div className="forum-detail-head-actions">
                {developerMode && <button type="button" title="Copiar ID do tópico" onClick={() => void navigator.clipboard.writeText(selected.id)}><Copy size={16}/></button>}
                {canManage && <button type="button" title={selected.pinned ? "Desafixar" : "Fixar"} onClick={() => void patchPost(selected, { pinned: !selected.pinned })}><Pin size={16}/></button>}
                {(canManage || selected.author.id === currentUser.id) && <button type="button" title={selected.status === "OPEN" ? "Fechar" : "Reabrir"} onClick={() => void patchPost(selected, { status: selected.status === "OPEN" ? "CLOSED" : "OPEN" })}>{selected.status === "OPEN" ? <Lock size={16}/> : <MessageCircle size={16}/>}</button>}
                <button type="button" onClick={() => setSelected(null)}><X size={18}/></button>
              </div>
            </header>

            <div className="forum-detail-scroll">
              <article className="forum-root-post">
                <Avatar user={selected.author} size="md"/>
                <div><strong>{selected.author.displayName} <UserBadges user={selected.author} compact/></strong><p>{selected.content}</p></div>
              </article>
              <div className="forum-replies-heading"><MessageCircle size={15}/><strong>{selected.comments?.length ?? 0} resposta{selected.comments?.length === 1 ? "" : "s"}</strong><span/></div>
              <div className="forum-comments-v2">
                {selected.comments?.map((comment) => <article key={comment.id}><Avatar user={comment.author} size="sm"/><div><div><strong>{comment.author.displayName} <UserBadges user={comment.author} compact/></strong><time>{new Date(comment.createdAt).toLocaleString("pt-BR")}</time></div><p>{comment.content}</p></div></article>)}
                {selected.comments?.length === 0 && <div className="forum-no-replies">Ainda não há respostas. Seja o primeiro a continuar a conversa.</div>}
              </div>
            </div>

            {selected.status === "OPEN" ? (
              <form className="forum-reply-v2" onSubmit={reply}><Avatar user={currentUser} size="sm"/><input name="content" required maxLength={6000} placeholder={`Responder como ${currentUser.displayName}`}/><button type="submit" disabled={busyPostId === selected.id} aria-label="Enviar resposta"><Send size={17}/></button></form>
            ) : <div className="forum-closed-notice"><Lock size={15}/> Este tópico está fechado para novas respostas.</div>}
          </div>
        </div>
      )}
    </section>
  );
}
