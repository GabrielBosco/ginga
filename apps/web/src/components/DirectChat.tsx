import { useEffect, useMemo, useRef, useState, type ChangeEvent, type ClipboardEvent, type DragEvent, type FormEvent, type KeyboardEvent } from "react";
import { CheckCircle2, Download, File as FileIcon, FileArchive, FileAudio, FileText, Image as ImageIcon, LoaderCircle, Paperclip, Pencil, Phone, PhoneCall, PhoneMissed, PhoneOff, Reply, Send, Trash2, Users, Video, X } from "lucide-react";
import type { Socket } from "socket.io-client";
import { api, uploadFile } from "../lib/api";
import type { DirectCall } from "../lib/directCalls";
import type { Attachment, DirectConversation, DirectMessage, User } from "../types";
import { Avatar } from "./Avatar";
import { AudioPlayer } from "./AudioPlayer";
import { MediaViewer } from "./MediaViewer";
import { VoiceMessageRecorder } from "./VoiceMessageRecorder";

import { gingaConfirm } from "../lib/dialogs";
interface DirectChatProps {
  conversation: DirectConversation;
  currentUser: User;
  socket: Socket;
  online: boolean;
  onStartCall: () => void;
  call?: DirectCall | null;
  onJoinCall?: (call: DirectCall) => void;
  onCancelCall?: (call: DirectCall) => void;
  onConversationActivity?: () => void;
  onUserClick?: (user: User, rect: DOMRect) => void;
  onJoinServerInvite?: (code: string) => Promise<void>;
}

interface AckResponse {
  ok: boolean;
  error?: string;
  message?: DirectMessage;
}

const timeFormatter = new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit" });
const dateFormatter = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "long", year: "numeric" });
const serverInvitePattern = /^\[\[ginga:server-invite:([A-Za-z0-9_-]{5,16})\]\]$/i;

interface DirectInvitePreview {
  code: string;
  expiresAt: string | null;
  uses: number;
  maxUses: number | null;
  valid: boolean;
  guild: { id: string; name: string; iconColor: string; iconUrl?: string | null; memberCount: number };
}

function serverInviteCode(content: string) {
  return content.trim().match(serverInvitePattern)?.[1]?.toUpperCase() ?? "";
}

function directReplyPreview(message: DirectMessage) {
  return serverInviteCode(message.content) ? "Convite para servidor" : (message.content || "Anexo");
}

function DirectServerInviteCard({ code, onJoin }: { code: string; onJoin?: (code: string) => Promise<void> }) {
  const [invite, setInvite] = useState<DirectInvitePreview | null>(null);
  const [error, setError] = useState("");
  const [joining, setJoining] = useState(false);

  useEffect(() => {
    let active = true;
    setInvite(null);
    setError("");
    api<{ invite: DirectInvitePreview }>(`/api/invites/${encodeURIComponent(code)}`)
      .then((result) => { if (active) setInvite(result.invite); })
      .catch((caught) => { if (active) setError(caught instanceof Error ? caught.message : "Convite indisponivel"); });
    return () => { active = false; };
  }, [code]);

  async function join() {
    if (!invite?.valid || !onJoin || joining) return;
    setJoining(true);
    setError("");
    try { await onJoin(code); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Nao foi possivel entrar no servidor"); }
    finally { setJoining(false); }
  }

  return <div className={`direct-server-invite ${invite && !invite.valid ? "expired" : ""}`}>
    <div className="direct-server-invite-kicker"><CheckCircle2 size={13}/><span>CONVITE PARA UM SERVIDOR</span></div>
    {invite ? <>
      <div className="direct-server-invite-main">
        <div className={`direct-server-invite-icon ${invite.guild.iconUrl ? "with-image" : ""}`} style={{ background: invite.guild.iconColor }}>{invite.guild.iconUrl ? <img src={invite.guild.iconUrl} alt=""/> : invite.guild.name.slice(0, 1).toUpperCase()}</div>
        <div className="direct-server-invite-copy"><strong>{invite.guild.name}</strong><span><Users size={13}/>{invite.guild.memberCount} membro{invite.guild.memberCount === 1 ? "" : "s"}</span></div>
      </div>
      {error && <div className="direct-server-invite-error">{error}</div>}
      <button type="button" className="direct-server-invite-join" disabled={!invite.valid || joining || !onJoin} onClick={() => void join()}>{joining ? "Entrando..." : invite.valid ? "Entrar no servidor" : "Convite expirado"}</button>
    </> : error ? <div className="direct-server-invite-error">{error}</div> : <div className="direct-server-invite-loading"><LoaderCircle size={16} className="spin"/> Carregando servidor...</div>}
  </div>;
}

function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

function AttachmentIcon({ mimeType }: { mimeType: string }) {
  if (mimeType.startsWith("image/")) return <ImageIcon size={20} />;
  if (mimeType.startsWith("video/")) return <Video size={20} />;
  if (mimeType.startsWith("audio/")) return <FileAudio size={20} />;
  if (mimeType.includes("zip") || mimeType.includes("7z") || mimeType.includes("rar")) return <FileArchive size={20} />;
  if (mimeType.includes("pdf") || mimeType.startsWith("text/")) return <FileText size={20} />;
  return <FileIcon size={20} />;
}

function MessageAttachment({ attachment, onPreview }: { attachment: Attachment; onPreview: (attachment: Attachment) => void }) {
  if (attachment.mimeType.startsWith("image/")) return <button type="button" className="message-image-button" onClick={() => onPreview(attachment)} aria-label={`Abrir ${attachment.originalName}`}><img className="message-image" src={attachment.url} alt={attachment.originalName} loading="lazy" /></button>;
  if (attachment.mimeType.startsWith("video/")) return <div className="message-media-card message-video-card"><video className="message-video" src={attachment.url} controls preload="metadata"/><button type="button" className="message-media-expand" onClick={() => onPreview(attachment)}>Abrir player</button></div>;
  if (attachment.mimeType.startsWith("audio/")) { const voice = attachment.originalName.startsWith("ginga-voice-"); return <div className={`message-media-card message-audio-card ${voice ? "voice-note" : ""}`}><div className="message-audio-copy"><FileAudio size={18}/><span><strong>{voice ? "Mensagem de voz" : attachment.originalName}</strong><small>{formatBytes(attachment.size)}</small></span></div><AudioPlayer src={attachment.url} title={voice ? "Mensagem de voz" : attachment.originalName} compact={voice} /><button type="button" className="message-media-expand" onClick={() => onPreview(attachment)}>Abrir player</button></div>; }
  if (attachment.mimeType === "application/pdf") return <button type="button" className="file-card file-card-preview" onClick={() => onPreview(attachment)}><span className="file-icon"><FileText size={20}/></span><span className="file-info"><strong>{attachment.originalName}</strong><small>PDF · {formatBytes(attachment.size)} · Visualizar no Ginga</small></span><FileText size={18}/></button>;
  return <a className="file-card" href={attachment.url} target="_blank" rel="noreferrer"><span className="file-icon"><AttachmentIcon mimeType={attachment.mimeType} /></span><span className="file-info"><strong>{attachment.originalName}</strong><small>{formatBytes(attachment.size)}</small></span><Download size={18} /></a>;
}

function formatCallDuration(ms: number | null) {
  if (!ms || ms < 1000) return "menos de 1 s";
  const total = Math.floor(ms / 1000);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  if (hours) return `${hours}h ${minutes}min`;
  if (minutes) return `${minutes}min ${seconds}s`;
  return `${seconds}s`;
}

function DirectCallEventCard({ call, currentUser, onJoin }: { call: DirectCall; currentUser: User; onJoin?: (call: DirectCall) => void }) {
  const outgoing = call.callerId === currentUser.id;
  const clock = call.startedAt ? timeFormatter.format(new Date(call.startedAt)) : "";
  let title = outgoing ? `Voce ligou as ${clock}` : `${call.peer?.displayName ?? "Alguem"} ligou as ${clock}`;
  let detail = "Chamando...";
  let tone = "ringing";
  let Icon = Phone;
  if (call.state === "ACTIVE") { title = "Chamada em andamento"; detail = call.participants.filter((item) => item.status === "JOINED").length > 1 ? `${call.participants.filter((item) => item.status === "JOINED").length} pessoas conectadas` : "Aguardando participantes"; tone = "active"; Icon = PhoneCall; }
  else if (call.state === "MISSED") { detail = outgoing ? "Nao foi atendida" : "Chamada nao atendida"; tone = "missed"; Icon = PhoneMissed; }
  else if (call.state === "DECLINED") { detail = outgoing ? "Chamada recusada" : "Voce recusou a chamada"; tone = "missed"; Icon = PhoneOff; }
  else if (call.state === "CANCELLED") { detail = "Chamada cancelada"; tone = "ended"; Icon = PhoneOff; }
  else if (call.state === "ENDED") { title = "Chamada finalizada"; detail = `Durou ${formatCallDuration(call.durationMs)}`; tone = "ended"; Icon = PhoneOff; }
  const joinable = call.state === "ACTIVE" && Boolean(onJoin) && call.canJoin;
  return <article className={`direct-call-message-card ${tone}`}>
    <span className="direct-call-message-icon"><Icon size={18}/></span>
    <div><strong>{title}</strong><span>{detail}</span></div>
    {joinable && <button type="button" onClick={() => onJoin?.(call)}>Entrar na chamada</button>}
  </article>;
}

export function DirectChat({ conversation, currentUser, socket, online, onStartCall, call, onJoinCall, onCancelCall, onConversationActivity, onUserClick, onJoinServerInvite }: DirectChatProps) {
  const [messages, setMessages] = useState<DirectMessage[]>([]);
  const [mediaViewer, setMediaViewer] = useState<Attachment | null>(null);
  const [content, setContent] = useState("");
  const [pendingAttachments, setPendingAttachments] = useState<Attachment[]>([]);
  const [replyTo, setReplyTo] = useState<DirectMessage | null>(null);
  const [editingId, setEditingId] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [error, setError] = useState("");
  const [callHistory, setCallHistory] = useState<DirectCall[]>([]);
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setMessages([]);
    setError("");
    setReplyTo(null);
    setEditingId("");
    setContent("");
    api<{ messages: DirectMessage[] }>(`/api/direct/conversations/${conversation.id}/messages`)
      .then((result) => { if (active) setMessages(result.messages); })
      .catch((caught) => { if (active) setError(caught instanceof Error ? caught.message : "Falha ao carregar a conversa"); })
      .finally(() => { if (active) setLoading(false); });

    const onMessage = (message: DirectMessage) => {
      if (message.conversationId !== conversation.id) return;
      setMessages((current) => current.some((item) => item.id === message.id) ? current : [...current, message]);
      onConversationActivity?.();
    };
    const onUpdated = (message: DirectMessage) => {
      if (message.conversationId !== conversation.id) return;
      setMessages((current) => current.map((item) => item.id === message.id ? message : item));
      onConversationActivity?.();
    };
    const onDeleted = (payload: { id: string; conversationId: string }) => {
      if (payload.conversationId !== conversation.id) return;
      setMessages((current) => current.filter((item) => item.id !== payload.id));
      setReplyTo((current) => current?.id === payload.id ? null : current);
      setEditingId((current) => { if (current === payload.id) { setContent(""); return ""; } return current; });
      onConversationActivity?.();
    };
    socket.on("direct:message:new", onMessage);
    socket.on("direct:message:updated", onUpdated);
    socket.on("direct:message:deleted", onDeleted);
    return () => {
      active = false;
      socket.off("direct:message:new", onMessage);
      socket.off("direct:message:updated", onUpdated);
      socket.off("direct:message:deleted", onDeleted);
    };
  }, [conversation.id, onConversationActivity, socket]);

  useEffect(() => {
    let active = true;
    const loadCalls = () => api<{ calls: DirectCall[] }>(`/api/direct-calls/with/${encodeURIComponent(conversation.otherUser.id)}?limit=30`)
      .then((result) => { if (active) setCallHistory(result.calls); })
      .catch(() => undefined);
    const onCalls = () => { void loadCalls(); };
    void loadCalls();
    window.addEventListener("ginga:direct-calls:update", onCalls);
    return () => { active = false; window.removeEventListener("ginga:direct-calls:update", onCalls); };
  }, [conversation.otherUser.id]);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: loading ? "auto" : "smooth" }); }, [callHistory.length, messages.length, loading]);
  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = "auto";
    textarea.style.height = `${Math.min(textarea.scrollHeight, 180)}px`;
  }, [content]);

  const timelineItems = useMemo(() => {
    const messageItems = messages.map((message) => ({
      kind: "message" as const,
      key: `message:${message.id}`,
      at: message.createdAt,
      message
    }));
    const callItems = callHistory.map((call) => ({
      kind: "call" as const,
      key: `call:${call.id}`,
      at: call.startedAt ?? call.answeredAt ?? call.endedAt ?? new Date(0).toISOString(),
      call
    }));
    return [...messageItems, ...callItems].sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
  }, [callHistory, messages]);

  const dayMarkers = useMemo(() => {
    const markers = new Set<string>();
    let previous = "";
    timelineItems.forEach((item) => {
      const day = new Date(item.at).toDateString();
      if (day !== previous) markers.add(item.key);
      previous = day;
    });
    return markers;
  }, [timelineItems]);

  async function uploadFiles(files: File[]) {
    const selected = files.slice(0, Math.max(0, 10 - pendingAttachments.length));
    if (!selected.length) return;
    setUploading(true);
    setError("");
    try {
      const uploaded: Attachment[] = [];
      for (const file of selected) uploaded.push(await uploadFile(file));
      setPendingAttachments((current) => [...current, ...uploaded].slice(0, 10));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Falha no envio do arquivo");
    } finally { setUploading(false); }
  }

  async function chooseFiles(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    await uploadFiles(files);
  }

  function onDrop(event: DragEvent<HTMLElement>) {
    event.preventDefault();
    setDragActive(false);
    void uploadFiles(Array.from(event.dataTransfer.files ?? []));
  }

  function onPaste(event: ClipboardEvent<HTMLTextAreaElement>) {
    const files = Array.from(event.clipboardData.files ?? []);
    if (!files.length) return;
    event.preventDefault();
    void uploadFiles(files);
  }

  async function sendVoiceMessage(file: File) {
    if (!socket.connected) throw new Error("Conexao em tempo real indisponivel. Aguarde a reconexao.");
    const attachment = await uploadFile(file);
    await new Promise<void>((resolve, reject) => {
      socket.emit("direct:message:send", {
        conversationId: conversation.id,
        content: "",
        attachmentIds: [attachment.id],
        replyToId: replyTo?.id ?? null
      }, (response: AckResponse) => {
        if (!response?.ok) { reject(new Error(response?.error ?? "Nao foi possivel enviar a mensagem de voz")); return; }
        if (response.message) setMessages((current) => current.some((item) => item.id === response.message!.id) ? current : [...current, response.message!]);
        setReplyTo(null);
        onConversationActivity?.();
        resolve();
      });
    }).catch(async (error) => {
      await api<void>(`/api/uploads/${attachment.id}`, { method: "DELETE" }).catch(() => undefined);
      throw error;
    });
  }

  async function submit(event?: FormEvent) {
    event?.preventDefault();
    const trimmed = content.trim();
    if (sending) return;

    if (editingId) {
      if (!trimmed) return;
      setSending(true); setError("");
      try {
        const response = await api<{ message: DirectMessage }>(`/api/direct/messages/${editingId}`, { method: "PATCH", body: JSON.stringify({ content: trimmed }) });
        setMessages((current) => current.map((item) => item.id === editingId ? response.message : item));
        setEditingId(""); setContent("");
      } catch (caught) { setError(caught instanceof Error ? caught.message : "Nao foi possivel editar a mensagem"); }
      finally { setSending(false); textareaRef.current?.focus(); }
      return;
    }

    if (!trimmed && pendingAttachments.length === 0) return;
    if (!socket.connected) { setError("Conexao em tempo real indisponivel. Aguarde a reconexao."); return; }

    setSending(true); setError("");
    socket.emit("direct:message:send", {
      conversationId: conversation.id,
      content: trimmed,
      attachmentIds: pendingAttachments.map((attachment) => attachment.id),
      replyToId: replyTo?.id ?? null
    }, (response: AckResponse) => {
      setSending(false);
      if (!response?.ok) { setError(response?.error ?? "Nao foi possivel enviar a mensagem"); return; }
      if (response.message) setMessages((current) => current.some((item) => item.id === response.message!.id) ? current : [...current, response.message!]);
      setContent(""); setPendingAttachments([]); setReplyTo(null);
      onConversationActivity?.();
      textareaRef.current?.focus();
    });
  }

  function beginReply(message: DirectMessage) {
    setEditingId("");
    setReplyTo(message);
    textareaRef.current?.focus();
  }

  function beginEdit(message: DirectMessage) {
    setReplyTo(null);
    setEditingId(message.id);
    setContent(message.content);
    textareaRef.current?.focus();
  }

  async function deleteMessage(message: DirectMessage) {
    if (!(await gingaConfirm("A mensagem sera removida para voce e para a outra pessoa.", { title: "Excluir mensagem?", confirmLabel: "Excluir", tone: "danger" }))) return;
    setError("");
    try {
      await api(`/api/direct/messages/${message.id}`, { method: "DELETE" });
      setMessages((current) => current.filter((item) => item.id !== message.id));
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Nao foi possivel excluir a mensagem"); }
  }

  function cancelComposerMode() {
    if (editingId) setContent("");
    setEditingId("");
    setReplyTo(null);
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Escape" && (replyTo || editingId)) { event.preventDefault(); cancelComposerMode(); return; }
    if (event.key === "ArrowUp" && !content.trim() && !replyTo && !editingId) {
      const lastOwn = [...messages].reverse().find((message) => message.authorId === currentUser.id && message.content.trim() && !serverInviteCode(message.content));
      if (lastOwn) { event.preventDefault(); beginEdit(lastOwn); }
      return;
    }
    if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void submit(); }
  }

  async function removePendingAttachment(attachment: Attachment) {
    setPendingAttachments((items) => items.filter((item) => item.id !== attachment.id));
    try { await api<void>(`/api/uploads/${attachment.id}`, { method: "DELETE" }); } catch { /* limpeza automatica cobre falhas */ }
  }

  const other = conversation.otherUser;

  return (
    <section className={`chat-view direct-chat-view ${dragActive ? "drag-active" : ""}`} onDragEnter={(event) => { event.preventDefault(); setDragActive(true); }} onDragOver={(event) => event.preventDefault()} onDragLeave={(event) => { if (event.currentTarget === event.target) setDragActive(false); }} onDrop={onDrop}>
      <header className="content-header direct-header">
        <button className="direct-contact-title profile-trigger" type="button" onClick={(event) => onUserClick?.(other, event.currentTarget.getBoundingClientRect())}>
          <Avatar user={other} size="sm" status={online ? "online" : "offline"} />
          <div><strong>{other.displayName}</strong><span>@{other.username} · {online ? "online" : "offline"}</span></div>
        </button>
        {call?.state === "RINGING" ? (
          <button className="header-action call-ringing" onClick={() => call.direction === "INCOMING" ? onJoinCall?.(call) : onCancelCall?.(call)} aria-label={call.direction === "INCOMING" ? "Atender chamada" : "Cancelar chamada"}><PhoneCall size={18}/> {call.direction === "OUTGOING" ? "Chamando..." : "Atender"}</button>
        ) : call?.state === "ACTIVE" ? (
          <button className="header-action call-active" onClick={() => onJoinCall?.(call)} aria-label="Entrar na chamada"><PhoneCall size={18}/> Entrar na chamada</button>
        ) : <button className="header-action" onClick={onStartCall} aria-label={`Iniciar chamada com ${other.displayName}`}><Phone size={18} /> Chamada</button>}
      </header>

      {call && (call.state === "RINGING" || call.state === "ACTIVE") && <section className={`direct-call-live-strip ${call.state.toLowerCase()}`}>
        <div className="direct-call-live-identity"><Avatar user={other} size="md" status={online ? "online" : "offline"}/><span><strong>{call.state === "RINGING" ? (call.direction === "OUTGOING" ? `Chamando ${other.displayName}...` : `${other.displayName} esta ligando`) : "Chamada em andamento"}</strong><small>{call.state === "RINGING" ? (call.direction === "OUTGOING" ? "Aguardando a pessoa atender" : "Atenda para entrar na sala privada") : `${call.participants.filter((item) => item.status === "JOINED").length} participante${call.participants.filter((item) => item.status === "JOINED").length === 1 ? "" : "s"} conectado${call.participants.filter((item) => item.status === "JOINED").length === 1 ? "" : "s"}`}</small></span></div>
        <div className="direct-call-live-actions">
          {call.state === "RINGING" && call.direction === "INCOMING" && <button type="button" className="call-accept" onClick={() => onJoinCall?.(call)}><PhoneCall size={16}/> Atender</button>}
          {call.state === "RINGING" && <button type="button" className="call-decline text" onClick={() => onCancelCall?.(call)}><PhoneOff size={16}/> {call.direction === "OUTGOING" ? "Cancelar" : "Recusar"}</button>}
          {call.state === "ACTIVE" && <button type="button" className="call-accept" onClick={() => onJoinCall?.(call)}><PhoneCall size={16}/> Entrar na chamada</button>}
        </div>
      </section>}

      {dragActive && <div className="chat-drop-overlay"><Paperclip size={30}/><strong>Solte para enviar</strong><span>Ate 10 arquivos por mensagem</span></div>}

      <div className="message-scroll">
        {loading && <div className="center-state"><LoaderCircle className="spin" /> Carregando conversa...</div>}
        {!loading && messages.length === 0 && <div className="direct-empty"><Avatar user={other} size="xl" /><h2>{other.displayName}</h2><p>Este e o inicio da conversa com @{other.username}. Mensagens, arquivos e chamadas privadas ficam aqui.</p></div>}

        {timelineItems.map((item, index) => {
          if (item.kind === "call") {
            return <div key={item.key}>
              {dayMarkers.has(item.key) && <div className="day-divider"><span>{dateFormatter.format(new Date(item.at))}</span></div>}
              <DirectCallEventCard call={item.call} currentUser={currentUser} onJoin={item.call.state === "ACTIVE" ? onJoinCall : undefined}/>
            </div>;
          }
          const message = item.message;
          const previousItem = timelineItems[index - 1];
          const previous = previousItem?.kind === "message" ? previousItem.message : null;
          const compact = Boolean(previous && previous.authorId === message.authorId && new Date(message.createdAt).getTime() - new Date(previous.createdAt).getTime() < 5 * 60 * 1000 && !dayMarkers.has(item.key));
          const replied = message.replyToId ? messages.find((candidate) => candidate.id === message.replyToId) : null;
          const inviteCode = serverInviteCode(message.content);
          return <div key={item.key}>
            {dayMarkers.has(item.key) && <div className="day-divider"><span>{dateFormatter.format(new Date(message.createdAt))}</span></div>}
            <article className={`message-row direct-message-row ${compact ? "message-compact" : ""} ${message.authorId === currentUser.id ? "message-own" : ""}`}>
              {!compact && <button className="message-user-button avatar-button" type="button" onClick={(event) => onUserClick?.(message.author, event.currentTarget.getBoundingClientRect())}><Avatar user={message.author} size="md" /></button>}
              {compact && <time className="compact-time">{timeFormatter.format(new Date(message.createdAt))}</time>}
              <div className="message-body">
                {!compact && <div className="message-meta"><button className="message-author-button" type="button" onClick={(event) => onUserClick?.(message.author, event.currentTarget.getBoundingClientRect())}><strong>{message.author.displayName}</strong><span>@{message.author.username}</span></button><time>{timeFormatter.format(new Date(message.createdAt))}{message.editedAt ? " · editada" : ""}</time></div>}
                {replied && <button className="direct-reply-reference" type="button" onClick={() => document.querySelector(`[data-direct-message-id="${replied.id}"]`)?.scrollIntoView({ behavior: "smooth", block: "center" })}><Reply size={13}/><strong>{replied.author.displayName}</strong><span>{directReplyPreview(replied)}</span></button>}
                <div data-direct-message-id={message.id}>{inviteCode ? <DirectServerInviteCard code={inviteCode} onJoin={onJoinServerInvite}/> : message.content ? <p className="message-text">{message.content}</p> : null}</div>
                {message.attachments.length > 0 && <div className="message-attachments">{message.attachments.map((attachment) => <MessageAttachment key={attachment.id} attachment={attachment} onPreview={setMediaViewer} />)}</div>}
              </div>
              <div className="direct-message-actions">
                <button type="button" onClick={() => beginReply(message)} aria-label="Responder"><Reply size={15}/></button>
                {message.authorId === currentUser.id && message.content && !inviteCode && <button type="button" onClick={() => beginEdit(message)} aria-label="Editar"><Pencil size={15}/></button>}
                {message.authorId === currentUser.id && <button type="button" className="danger" onClick={() => void deleteMessage(message)} aria-label="Excluir"><Trash2 size={15}/></button>}
              </div>
            </article>
          </div>;
        })}
        <div ref={bottomRef} />
      </div>

      <form className="composer-wrap" onSubmit={(event) => void submit(event)}>
        {error && <div className="composer-error">{error}</div>}
        {(replyTo || editingId) && <div className="direct-composer-context"><div>{editingId ? <><Pencil size={14}/><span>Editando mensagem</span></> : <><Reply size={14}/><span>Respondendo a <strong>{replyTo?.author.displayName}</strong></span></>}</div><button type="button" onClick={cancelComposerMode} aria-label="Cancelar"><X size={15}/></button></div>}
        {pendingAttachments.length > 0 && <div className="pending-files">{pendingAttachments.map((attachment) => <div className="pending-file" key={attachment.id}><AttachmentIcon mimeType={attachment.mimeType} /><span>{attachment.originalName}</span><button type="button" onClick={() => void removePendingAttachment(attachment)}>×</button></div>)}</div>}
        <div className="composer">
          <label className={`composer-attach ${uploading || editingId ? "disabled" : ""}`} aria-label="Adicionar arquivo">{uploading ? <LoaderCircle className="spin" size={20} /> : <Paperclip size={20} />}<input type="file" multiple disabled={uploading || Boolean(editingId) || pendingAttachments.length >= 10} onChange={chooseFiles} /></label>
          <textarea ref={textareaRef} value={content} onChange={(event) => setContent(event.target.value)} onKeyDown={onKeyDown} onPaste={onPaste} placeholder={editingId ? "Edite sua mensagem" : `Mensagem para ${other.displayName}`} rows={1} maxLength={4000} />
          {!editingId && <VoiceMessageRecorder disabled={sending || uploading} onSendFile={sendVoiceMessage} />}
          <button className="send-button" type="submit" disabled={sending || (!content.trim() && pendingAttachments.length === 0)} aria-label={editingId ? "Salvar edicao" : "Enviar"}>{sending ? <LoaderCircle className="spin" size={19} /> : <Send size={19} />}</button>
        </div>
      </form>
      {mediaViewer && <MediaViewer attachment={mediaViewer} onClose={() => setMediaViewer(null)} />}
    </section>
  );
}
