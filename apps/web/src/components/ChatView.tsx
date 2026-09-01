import { useEffect, useMemo, useRef, useState, type ChangeEvent, type ClipboardEvent as ReactClipboardEvent, type DragEvent as ReactDragEvent, type FormEvent, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import { Archive, ArrowDown, Bookmark, Bot, Crown, CalendarClock, Check, ChevronUp, Clock3, Copy, Download, File as FileIcon, FileArchive, FileAudio, FileText, Forward, Image as ImageIcon, ListTodo, Link, LoaderCircle, Megaphone, MessageSquare, Paperclip, Pencil, Pin, Plus, Reply, Search, Send, Smile, Trash2, Video, X } from "lucide-react";
import type { Socket } from "socket.io-client";
import { api, uploadFile } from "../lib/api";
import { useDeveloperMode } from "../lib/developerMode";
import { loadNotificationPreferences } from "../lib/preferences";
import { guildAllowsMessageActivity, isChannelMuted, loadGuildPreferences } from "../lib/serverPreferences";
import { playUiSound } from "../lib/sounds";
import type { Attachment, Channel, ChatMessage, GuildMember, GuildPermissions, MessageReaction, User } from "../types";
import { Avatar } from "./Avatar";
import { AudioPlayer } from "./AudioPlayer";
import { UserBadges } from "./UserBadges";
import { ContextMenu } from "./ContextMenu";
import { MediaViewer } from "./MediaViewer";
import { VoiceMessageRecorder } from "./VoiceMessageRecorder";
import { MessageContent } from "./MessageContent";
import { MessageFormattingToolbar, handleMessageFormatShortcut } from "./MessageFormattingToolbar";

import { gingaConfirm, gingaPrompt } from "../lib/dialogs";
interface ChatViewProps {
  channel: Channel;
  currentUser: User;
  socket: Socket;
  permissions: GuildPermissions;
  guildOwnerId?: string;
  members?: GuildMember[];
  forwardChannels?: Channel[];
  onUserClick?: (user: User, rect: DOMRect) => void;
  onUserContextMenu?: (user: User, x: number, y: number) => void;
}

interface ChannelCommand {
  id: string;
  name: string;
  description: string;
  applicationId: string;
  bot?: { id: string; displayName: string; avatarColor: string } | null;
}

interface AckResponse {
  ok: boolean;
  error?: string;
  message?: ChatMessage;
}

const quickMessageTemplates = [
  { id: "announcement", label: "Anuncio", body: "Anuncio\n\nEscreva aqui o comunicado." },
  { id: "maintenance", label: "Manutencao", body: "Manutencao programada\n\nInicio: \nPrevisao de termino: \nImpacto:" },
  { id: "changelog", label: "Atualizacao", body: "Atualizacao\n\nNovidades:\n- \n\nCorrecoes:\n- " },
  { id: "welcome", label: "Boas-vindas", body: "Bem-vindo!\n\nLeia os canais importantes e fique a vontade para participar." }
];

const timeFormatter = new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit" });
const longDateFormatter = new Intl.DateTimeFormat("pt-BR", { weekday: "long", day: "2-digit", month: "long", year: "numeric" });
const shortDateFormatter = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "long", year: "numeric" });
const weekdayFormatter = new Intl.DateTimeFormat("pt-BR", { weekday: "long" });
const fullTimeFormatter = new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });

function capitalizeDateLabel(value: string) {
  return value ? value.charAt(0).toLocaleUpperCase("pt-BR") + value.slice(1) : value;
}

function localDayStamp(date: Date) {
  return Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
}

function formatDayDivider(value: string) {
  const date = new Date(value);
  const today = new Date();
  const diffDays = Math.round((localDayStamp(today) - localDayStamp(date)) / 86_400_000);
  const fullDate = capitalizeDateLabel(longDateFormatter.format(date));
  const calendarDate = shortDateFormatter.format(date);
  if (diffDays === 0) return { relative: "Hoje", fullDate };
  if (diffDays === 1) return { relative: "Ontem", fullDate };
  if (diffDays > 1 && diffDays < 7) return { relative: capitalizeDateLabel(weekdayFormatter.format(date)), fullDate: calendarDate };
  return { relative: calendarDate, fullDate };
}

function formatFullTimestamp(value: string) {
  const date = new Date(value);
  return `${capitalizeDateLabel(longDateFormatter.format(date))} às ${fullTimeFormatter.format(date)}`;
}

const everyoneMentionPattern = /(?:^|[^a-zA-Z0-9_.-])@(todos|everyone|here)(?=$|[^a-zA-Z0-9_.-])/i;
const customEmojiTokenPattern = /\[\[ginga-emoji\|([^|\]]{1,32})\|([^|\]]+)\]\]/g;
const CUSTOM_EMOJI_KEY = "ginga.customEmojis.v1";
const nativeEmojis = [
  "😀","😃","😄","😁","😂","🤣","😊","😍","🥰","😘","😎","🤓","🫡","🤔","😴","😭",
  "😡","🤯","🥳","😈","👻","💀","🤖","👍","👎","👏","🙌","🤝","🙏","💪","👀","❤️",
  "🧡","💛","💚","💙","💜","🖤","🤍","🔥","✨","⭐","✅","❌","⚠️","💡","🎉","🎮",
  "🎧","🎤","📌","📎","📢","💬","🚀","🛠️","☕","🍕","🐱","🐶","🗿","🤡"
];

interface CustomEmoji {
  id: string;
  name: string;
  dataUrl: string;
}

function sanitizeEmojiName(value: string) {
  return value.toLowerCase().replace(/\.[a-z0-9]+$/i, "").replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 24) || "emoji";
}

function loadCustomEmojis(): CustomEmoji[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(CUSTOM_EMOJI_KEY) || "[]") as CustomEmoji[];
    return Array.isArray(parsed) ? parsed.filter((item) => item && typeof item.name === "string" && typeof item.dataUrl === "string").slice(0, 10) : [];
  } catch { return []; }
}

function saveCustomEmojis(items: CustomEmoji[]) {
  try { localStorage.setItem(CUSTOM_EMOJI_KEY, JSON.stringify(items.slice(0, 10))); } catch { /* armazenamento local opcional */ }
}

function customEmojiToken(name: string, url: string) {
  return `[[ginga-emoji|${encodeURIComponent(name)}|${encodeURIComponent(url)}]]`;
}

function contentHasEmojiUrl(content: string, url: string) {
  customEmojiTokenPattern.lastIndex = 0;
  for (const match of content.matchAll(customEmojiTokenPattern)) {
    try { if (decodeURIComponent(match[2]) === url) return true; } catch { /* token antigo/invalido */ }
  }
  return false;
}

function removeEmojiTokenByUrl(content: string, url: string) {
  customEmojiTokenPattern.lastIndex = 0;
  return content.replace(customEmojiTokenPattern, (full, _name, encodedUrl) => {
    try { return decodeURIComponent(encodedUrl) === url ? "" : full; } catch { return full; }
  }).replace(/ {2,}/g, " ").trimStart();
}

async function resizeEmojiImage(file: File): Promise<string> {
  if (!file.type.startsWith("image/")) throw new Error("Escolha uma imagem para criar o emoji.");
  if (file.type === "image/gif" && file.size > 512 * 1024) throw new Error("GIF de emoji pode ter no maximo 512 KB.");
  if (file.type !== "image/gif" && file.size > 8 * 1024 * 1024) throw new Error("O emoji pode ter no maximo 8 MB antes da conversao.");
  const objectUrl = URL.createObjectURL(file);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = new Image();
      element.onload = () => resolve(element);
      element.onerror = () => reject(new Error("Nao foi possivel ler essa imagem."));
      element.src = objectUrl;
    });
    if (file.type === "image/gif") {
      return await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => typeof reader.result === "string" ? resolve(reader.result) : reject(new Error("Nao foi possivel ler o GIF."));
        reader.onerror = () => reject(new Error("Nao foi possivel ler o GIF."));
        reader.readAsDataURL(file);
      });
    }
    const size = 128;
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Seu navegador nao conseguiu converter a imagem.");
    const sourceSize = Math.min(image.naturalWidth, image.naturalHeight);
    const sx = Math.max(0, (image.naturalWidth - sourceSize) / 2);
    const sy = Math.max(0, (image.naturalHeight - sourceSize) / 2);
    ctx.clearRect(0, 0, size, size);
    ctx.drawImage(image, sx, sy, sourceSize, sourceSize, 0, 0, size, size);
    return canvas.toDataURL("image/webp", 0.86);
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

async function customEmojiFile(emoji: CustomEmoji): Promise<File> {
  const response = await fetch(emoji.dataUrl);
  const blob = await response.blob();
  const mime = blob.type === "image/gif" ? "image/gif" : "image/webp";
  const extension = mime === "image/gif" ? "gif" : "webp";
  return new File([blob], `ginga-emoji-${sanitizeEmojiName(emoji.name)}.${extension}`, { type: mime });
}

function messageMentionsUser(content: string, username: string) {
  if (everyoneMentionPattern.test(content)) return true;
  const target = username.toLowerCase();
  for (const match of content.matchAll(/(?:^|[^a-zA-Z0-9_.-])@([a-zA-Z0-9_.-]{3,24})(?=$|[^a-zA-Z0-9_.-])/g)) {
    if (String(match[1] || "").toLowerCase() === target) return true;
  }
  return false;
}

function invalidGuildMentions(content: string, members: GuildMember[]) {
  const existing = new Set(members.map((member) => member.user.username.toLowerCase()));
  const missing = new Set<string>();
  for (const match of content.matchAll(/(?:^|[^a-zA-Z0-9_.-])@([a-zA-Z0-9_.-]{3,24})(?=$|[^a-zA-Z0-9_.-])/g)) {
    const name = String(match[1] || "").toLowerCase();
    if (["todos", "everyone", "here"].includes(name)) continue;
    if (!existing.has(name)) missing.add(name);
  }
  return Array.from(missing);
}

function renderMessageText(
  content: string,
  username: string,
  members: GuildMember[],
  onUserClick?: (user: User, rect: DOMRect) => void
) {
  const current = username.toLowerCase();
  const tokenPattern = /\[\[ginga-emoji\|([^|\]]{1,32})\|([^|\]]+)\]\]|@(?:todos|everyone|here|[a-zA-Z0-9_.-]{3,24})/gi;
  const parts: ReactNode[] = [];
  let cursor = 0;
  let index = 0;

  for (const match of content.matchAll(tokenPattern)) {
    const position = match.index ?? 0;
    if (position > cursor) parts.push(content.slice(cursor, position));
    const token = match[0];
    if (token.startsWith("[[ginga-emoji|")) {
      try {
        const name = decodeURIComponent(match[1] || "emoji");
        const url = decodeURIComponent(match[2] || "");
        parts.push(<img className="custom-message-emoji" src={url} alt={`:${name}:`} key={`emoji:${index}:${position}`} loading="lazy" />);
      } catch {
        parts.push(token);
      }
    } else {
      const previous = position > 0 ? content[position - 1] : "";
      if (previous && /[a-zA-Z0-9_.-]/.test(previous)) {
        parts.push(token);
        cursor = position + token.length;
        index += 1;
        continue;
      }
      const name = token.slice(1).toLowerCase();
      const everyone = ["todos", "everyone", "here"].includes(name);
      const target = everyone ? null : members.find((member) => member.user.username.toLowerCase() === name)?.user ?? null;
      const className = `message-mention ${everyone ? "everyone" : ""} ${name === current || everyone ? "mine" : ""}`;
      if (target && onUserClick) {
        parts.push(<button type="button" className={`${className} clickable`} key={`mention:${index}:${position}`} title={`Abrir perfil de ${target.displayName}`} onClick={(event) => { event.stopPropagation(); onUserClick(target, event.currentTarget.getBoundingClientRect()); }}>{token}</button>);
      } else if (target || everyone) {
        parts.push(<span className={className} key={`mention:${index}:${position}`}>{everyone ? "@todos" : token}</span>);
      } else {
        parts.push(token);
      }
    }
    cursor = position + token.length;
    index += 1;
  }
  if (cursor < content.length) parts.push(content.slice(cursor));
  return parts;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
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
  if (attachment.mimeType.startsWith("image/")) {
    return <button type="button" className="message-image-button" onClick={() => onPreview(attachment)} aria-label={`Abrir ${attachment.originalName}`}><img className="message-image" src={attachment.url} alt={attachment.originalName} loading="lazy" /></button>;
  }
  if (attachment.mimeType.startsWith("video/")) {
    return <div className="message-media-card message-video-card"><video className="message-video" src={attachment.url} controls preload="metadata" /><button type="button" className="message-media-expand" onClick={() => onPreview(attachment)}>Abrir player</button></div>;
  }
  if (attachment.mimeType.startsWith("audio/")) {
    const voice = attachment.originalName.startsWith("ginga-voice-");
    return <div className={`message-media-card message-audio-card ${voice ? "voice-note" : ""}`}><div className="message-audio-copy"><FileAudio size={18}/><span><strong>{voice ? "Mensagem de voz" : attachment.originalName}</strong><small>{formatBytes(attachment.size)}</small></span></div><AudioPlayer src={attachment.url} title={voice ? "Mensagem de voz" : attachment.originalName} compact={voice} /><button type="button" className="message-media-expand" onClick={() => onPreview(attachment)}>Abrir player</button></div>;
  }
  if (attachment.mimeType === "application/pdf") {
    return <button type="button" className="file-card file-card-preview" onClick={() => onPreview(attachment)}><span className="file-icon"><FileText size={20}/></span><span className="file-info"><strong>{attachment.originalName}</strong><small>PDF · {formatBytes(attachment.size)} · Visualizar no Ginga</small></span><FileText size={18}/></button>;
  }

  return (
    <a className="file-card" href={attachment.url} target="_blank" rel="noreferrer">
      <span className="file-icon"><AttachmentIcon mimeType={attachment.mimeType} /></span>
      <span className="file-info"><strong>{attachment.originalName}</strong><small>{formatBytes(attachment.size)}</small></span><Download size={18} />
    </a>
  );
}

export function ChatView({ channel, currentUser, socket, permissions, guildOwnerId, members = [], forwardChannels = [], onUserClick, onUserContextMenu }: ChatViewProps) {
  const memberVisuals = useMemo(() => {
    const map = new Map<string, { color?: string; roleName?: string; roleIcon?: string; owner: boolean }>();
    for (const member of members) {
      const topRole = [...(member.customRoles ?? [])].sort((a, b) => b.position - a.position)[0];
      map.set(member.user.id, { color: topRole?.color, roleName: topRole?.name, roleIcon: topRole?.icon, owner: member.user.id === guildOwnerId });
    }
    return map;
  }, [guildOwnerId, members]);

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [content, setContent] = useState("");
  const [composerFocused, setComposerFocused] = useState(false);
  const [pendingAttachments, setPendingAttachments] = useState<Attachment[]>([]);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [slowModeRemaining, setSlowModeRemaining] = useState(0);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const [replyTo, setReplyTo] = useState<ChatMessage | null>(null);
  const [messageMenu, setMessageMenu] = useState<{ message: ChatMessage; x: number; y: number } | null>(null);
  const [reactionPicker, setReactionPicker] = useState<{ message: ChatMessage; x: number; y: number } | null>(null);
  const [reactionHover, setReactionHover] = useState<{ emoji: string; names: string[]; x: number; y: number } | null>(null);
  const [forwardTarget, setForwardTarget] = useState<ChatMessage | null>(null);
  const [forwardBusy, setForwardBusy] = useState(false);
  const [threadRoot, setThreadRoot] = useState<ChatMessage | null>(null);
  const [threadReplies, setThreadReplies] = useState<ChatMessage[]>([]);
  const [threadLoading, setThreadLoading] = useState(false);
  const [threadDraft, setThreadDraft] = useState("");
  const [threadSending, setThreadSending] = useState(false);
  const [threadError, setThreadError] = useState("");

  useEffect(() => {
    if (!reactionPicker) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest(".message-reaction-popover") || target?.closest("[aria-label='Adicionar reacao']")) return;
      setReactionPicker(null);
    };
    const onKeyDown = (event: Event) => {
      const keyboardEvent = event as globalThis.KeyboardEvent;
      if (keyboardEvent.key === "Escape") setReactionPicker(null);
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("keydown", onKeyDown, true);
    };
  }, [reactionPicker]);
  const developerMode = useDeveloperMode();
  const [mediaViewer, setMediaViewer] = useState<Attachment | null>(null);
  const [applicationCommands, setApplicationCommands] = useState<ChannelCommand[]>([]);
  const [commandIndex, setCommandIndex] = useState(0);
  const [mentionIndex, setMentionIndex] = useState(0);
  const [templateOpen, setTemplateOpen] = useState(false);
  const [pinsOpen, setPinsOpen] = useState(false);
  const [pinnedMessages, setPinnedMessages] = useState<ChatMessage[]>([]);
  const [pinsLoading, setPinsLoading] = useState(false);
  const [pinsNotice, setPinsNotice] = useState("");
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState("");
  const [editSaving, setEditSaving] = useState(false);
  const [savedMessageIds, setSavedMessageIds] = useState<Set<string>>(() => new Set());
  const [feedback, setFeedback] = useState("");
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [customEmojis, setCustomEmojis] = useState<CustomEmoji[]>(loadCustomEmojis);
  const [customEmojiName, setCustomEmojiName] = useState("");
  const [customEmojiBusy, setCustomEmojiBusy] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [newMessageCount, setNewMessageCount] = useState(0);
  const [showScrollToBottom, setShowScrollToBottom] = useState(false);
  const [highlightedMessageId, setHighlightedMessageId] = useState<string | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [remoteSearchResults, setRemoteSearchResults] = useState<ChatMessage[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState("");
  const [activeUploads, setActiveUploads] = useState<Array<{ id: string; name: string; progress: number }>>([]);
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const messageScrollRef = useRef<HTMLDivElement>(null);
  const nearBottomRef = useRef(true);
  const initialScrollPendingRef = useRef(true);
  const dragDepthRef = useRef(0);
  const skipDraftSaveRef = useRef(false);
  const arrivalHighlightTimerRef = useRef<number | null>(null);
  const searchRequestRef = useRef(0);

  function draftStorageKey() {
    return `ginga.chat.draft:${channel.id}`;
  }

  function isNearBottom() {
    const element = messageScrollRef.current;
    if (!element) return true;
    return element.scrollHeight - element.scrollTop - element.clientHeight < 140;
  }

  function scrollToLatest(behavior: ScrollBehavior = "smooth") {
    const element = messageScrollRef.current;
    nearBottomRef.current = true;
    setNewMessageCount(0);
    setShowScrollToBottom(false);
    if (element) {
      element.scrollTo({ top: element.scrollHeight, behavior });
      return;
    }
    bottomRef.current?.scrollIntoView({ behavior, block: "end" });
  }

  useEffect(() => {
    skipDraftSaveRef.current = true;
    try { setContent(localStorage.getItem(draftStorageKey()) || ""); } catch { setContent(""); }
    setReplyTo(null);
    setNewMessageCount(0);
    setShowScrollToBottom(false);
    initialScrollPendingRef.current = true;
    setSearchOpen(false);
    setSearchQuery("");
    setRemoteSearchResults([]);
    setSearchLoading(false);
    setSearchError("");
    setThreadRoot(null); setThreadReplies([]); setThreadDraft(""); setThreadError("");
    nearBottomRef.current = true;
  }, [channel.id]);

  useEffect(() => {
    if (skipDraftSaveRef.current) {
      skipDraftSaveRef.current = false;
      return;
    }
    try {
      if (content.trim()) localStorage.setItem(draftStorageKey(), content);
      else localStorage.removeItem(draftStorageKey());
    } catch {
      // Rascunho local e opcional; o chat continua funcionando sem storage.
    }
  }, [channel.id, content]);

  useEffect(() => {
    if (loading) return;

    if (initialScrollPendingRef.current) {
      initialScrollPendingRef.current = false;
      let secondFrame = 0;
      const firstFrame = window.requestAnimationFrame(() => {
        scrollToLatest("auto");
        secondFrame = window.requestAnimationFrame(() => scrollToLatest("auto"));
      });
      return () => {
        window.cancelAnimationFrame(firstFrame);
        if (secondFrame) window.cancelAnimationFrame(secondFrame);
      };
    }

    if (nearBottomRef.current) requestAnimationFrame(() => scrollToLatest(messages.length ? "smooth" : "auto"));
  }, [channel.id, messages.length, loading]);

  useEffect(() => {
    const element = messageScrollRef.current;
    if (!element) return;
    const keepBottomStable = () => {
      if (nearBottomRef.current) requestAnimationFrame(() => scrollToLatest("auto"));
    };
    element.addEventListener("load", keepBottomStable, true);
    element.addEventListener("loadedmetadata", keepBottomStable, true);
    return () => {
      element.removeEventListener("load", keepBottomStable, true);
      element.removeEventListener("loadedmetadata", keepBottomStable, true);
    };
  }, [channel.id]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setMessages([]);
    setError("");

    api<{ messages: ChatMessage[] }>(`/api/channels/${channel.id}/messages`)
      .then((result) => {
        if (active) {
          setMessages(result.messages);
          setPinnedMessages(result.messages.filter((message) => message.isPinned));
        }
      })
      .catch((caught) => {
        if (active) setError(caught instanceof Error ? caught.message : "Falha ao carregar mensagens");
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    api<{ commands: ChannelCommand[] }>(`/api/channels/${channel.id}/application-commands`)
      .then((result) => { if (active) setApplicationCommands(result.commands); })
      .catch(() => { if (active) setApplicationCommands([]); });

    const joinChannel = () => {
      socket.emit("channel:join", { channelId: channel.id }, (response: AckResponse) => {
        if (!response?.ok && active) setError(response?.error ?? "Nao foi possivel entrar no canal");
      });
    };

    if (socket.connected) joinChannel();
    socket.on("connect", joinChannel);

    const onMessage = (message: ChatMessage) => {
      if (message.channelId !== channel.id) return;
      setMessages((current) => current.some((item) => item.id === message.id) ? current : [...current, message]);
      setThreadReplies((current) => threadRoot?.id && message.replyToId === threadRoot.id && !current.some((item) => item.id === message.id) ? [...current, message] : current);
      if (message.isPinned) setPinnedMessages((current) => current.some((item) => item.id === message.id) ? current : [message, ...current]);
      if (message.authorId !== currentUser.id) {
        setHighlightedMessageId(message.id);
        if (arrivalHighlightTimerRef.current !== null) window.clearTimeout(arrivalHighlightTimerRef.current);
        arrivalHighlightTimerRef.current = window.setTimeout(() => {
          setHighlightedMessageId((current) => current === message.id ? null : current);
          arrivalHighlightTimerRef.current = null;
        }, 2200);
        window.dispatchEvent(new CustomEvent("ginga:message-arrived", {
          detail: { channelId: channel.id, messageId: message.id, authorId: message.authorId }
        }));
        if (!nearBottomRef.current) setNewMessageCount((count) => count + 1);
      }
      if (message.authorId !== currentUser.id) {
        const preferences = loadNotificationPreferences();
        const mention = messageMentionsUser(message.content, currentUser.username);
        const guildPreferences = loadGuildPreferences(channel.guildId);
        const channelMuted = isChannelMuted(guildPreferences, channel.id);
        const appForeground = document.visibilityState === "visible" && document.hasFocus();
        if (preferences.playSound && appForeground && !channelMuted && guildAllowsMessageActivity(guildPreferences, mention, channel.id)) {
          void playUiSound(mention ? "notification" : "message");
        }
      }
    };
    const onUpdated = (message: ChatMessage) => {
      if (message.channelId !== channel.id) return;
      setMessages((current) => current.map((item) => item.id === message.id ? message : item));
      setThreadReplies((current) => current.map((item) => item.id === message.id ? message : item));
      setThreadRoot((current) => current?.id === message.id ? message : current);
      setPinnedMessages((current) => {
        if (!message.isPinned) return current.filter((item) => item.id !== message.id);
        if (current.some((item) => item.id === message.id)) return current.map((item) => item.id === message.id ? message : item);
        return [message, ...current];
      });
    };
    const onDeleted = ({ id, channelId }: { id: string; channelId: string }) => {
      if (channelId !== channel.id) return;
      setMessages((current) => current.filter((item) => item.id !== id));
      setThreadReplies((current) => current.filter((item) => item.id !== id));
      setThreadRoot((current) => current?.id === id ? null : current);
      setPinnedMessages((current) => current.filter((item) => item.id !== id));
    };
    const onBulkCleared = ({ channelId, messageIds = [] }: { channelId: string; messageIds?: string[] }) => {
      if (channelId !== channel.id) return;
      const ids = new Set(messageIds);
      setMessages((current) => ids.size ? current.filter((item) => !ids.has(item.id)) : []);
      setThreadReplies((current) => ids.size ? current.filter((item) => !ids.has(item.id)) : []);
      setThreadRoot((current) => current && ids.has(current.id) ? null : current);
      setPinnedMessages((current) => ids.size ? current.filter((item) => !ids.has(item.id)) : []);
    };
    const onReactions = ({ messageId, reactions }: { messageId: string; reactions: MessageReaction[] }) => {
      setMessages((current) => current.map((item) => item.id === messageId ? { ...item, reactions } : item));
      setThreadReplies((current) => current.map((item) => item.id === messageId ? { ...item, reactions } : item));
      setThreadRoot((current) => current?.id === messageId ? { ...current, reactions } : current);
      setPinnedMessages((current) => current.map((item) => item.id === messageId ? { ...item, reactions } : item));
    };
    socket.on("message:new", onMessage);
    socket.on("message:updated", onUpdated);
    socket.on("message:deleted", onDeleted);
    socket.on("channel:messages:cleared", onBulkCleared);
    socket.on("message:reactions", onReactions);

    return () => {
      active = false;
      socket.off("connect", joinChannel);
      socket.off("message:new", onMessage);
      socket.off("message:updated", onUpdated);
      socket.off("message:deleted", onDeleted);
      socket.off("channel:messages:cleared", onBulkCleared);
      socket.off("message:reactions", onReactions);
      if (arrivalHighlightTimerRef.current !== null) {
        window.clearTimeout(arrivalHighlightTimerRef.current);
        arrivalHighlightTimerRef.current = null;
      }
    };
  }, [channel.id, socket]);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = "auto";
    textarea.style.height = `${Math.min(textarea.scrollHeight, 180)}px`;
  }, [content]);

  useEffect(() => {
    if (slowModeRemaining <= 0) return;
    const timer = window.setInterval(() => setSlowModeRemaining((value) => Math.max(0, value - 1)), 1000);
    return () => window.clearInterval(timer);
  }, [slowModeRemaining > 0]);

  useEffect(() => {
    if (!channel.slowModeSeconds || permissions.canManageMessages) { setSlowModeRemaining(0); return; }
    const lastOwn = [...messages].reverse().find((message) => message.authorId === currentUser.id);
    if (!lastOwn) { setSlowModeRemaining(0); return; }
    const elapsed = Math.floor((Date.now() - new Date(lastOwn.createdAt).getTime()) / 1000);
    setSlowModeRemaining(Math.max(0, channel.slowModeSeconds - elapsed));
  }, [channel.id, channel.slowModeSeconds, currentUser.id, loading, permissions.canManageMessages]);

  const dayMarkers = useMemo(() => {
    const markers = new Map<string, boolean>();
    let previous = "";
    messages.forEach((message) => {
      const day = new Date(message.createdAt).toDateString();
      if (day !== previous) markers.set(message.id, true);
      previous = day;
    });
    return markers;
  }, [messages]);

  const localSearchResults = useMemo(() => {
    const query = searchQuery.trim().toLocaleLowerCase();
    if (query.length < 2) return [];
    return messages.filter((message) => {
      const author = `${message.author.displayName} ${message.author.username}`.toLocaleLowerCase();
      const contentText = (message.content || "").toLocaleLowerCase();
      const attachmentText = message.attachments.map((attachment) => attachment.originalName).join(" ").toLocaleLowerCase();
      return author.includes(query) || contentText.includes(query) || attachmentText.includes(query);
    }).slice(-50).reverse();
  }, [messages, searchQuery]);

  const searchResults = useMemo(() => {
    const seen = new Set<string>();
    return [...remoteSearchResults, ...localSearchResults].filter((message) => {
      if (seen.has(message.id)) return false;
      seen.add(message.id);
      return true;
    }).slice(0, 50);
  }, [localSearchResults, remoteSearchResults]);

  useEffect(() => {
    const query = searchQuery.trim();
    const requestId = ++searchRequestRef.current;
    if (!searchOpen || query.length < 2) {
      setRemoteSearchResults([]);
      setSearchLoading(false);
      setSearchError("");
      return;
    }

    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setSearchLoading(true);
      setSearchError("");
      api<{ messages: ChatMessage[] }>(`/api/guilds/${encodeURIComponent(channel.guildId)}/search?q=${encodeURIComponent(query)}&channelId=${encodeURIComponent(channel.id)}&limit=50`, { signal: controller.signal })
        .then((result) => { if (searchRequestRef.current === requestId) setRemoteSearchResults(result.messages); })
        .catch((caught) => {
          if (caught instanceof DOMException && caught.name === "AbortError") return;
          if (searchRequestRef.current !== requestId) return;
          setRemoteSearchResults([]);
          setSearchError(caught instanceof Error ? caught.message : "Falha ao buscar no historico do canal");
        })
        .finally(() => { if (!controller.signal.aborted && searchRequestRef.current === requestId) setSearchLoading(false); });
    }, 260);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [channel.guildId, channel.id, searchOpen, searchQuery]);

  const commandSuggestions = useMemo(() => {
    if (!content.startsWith("/") || content.includes(" ")) return [];
    const query = content.slice(1).toLowerCase();
    const builtin: ChannelCommand[] = permissions.canManageMessages ? [
      { id: "ginga-clear", name: "clear", description: "Limpar mensagens do canal: /clear 50 ou /clear all", applicationId: "__ginga__", bot: null }
    ] : [];
    return [...builtin, ...applicationCommands]
      .filter((command) => !query || command.name.toLowerCase().startsWith(query))
      .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"))
      .slice(0, 8);
  }, [applicationCommands, content, permissions.canManageMessages]);

  const mentionSuggestions = useMemo(() => {
    const match = content.match(/(?:^|[^a-zA-Z0-9_.-])@([a-zA-Z0-9_.-]*)$/);
    if (!match) return [];
    const query = String(match[1] || "").toLowerCase();
    const suggestions: Array<{ key: string; username: string; label: string; everyone?: boolean; color?: string }> = [];
    if (permissions.canMentionEveryone && (!query || "todos".startsWith(query))) {
      suggestions.push({ key: "@todos", username: "todos", label: "Todos neste espaco", everyone: true });
    }
    const seen = new Set<string>();
    for (const member of members) {
      const username = member.user.username.toLowerCase();
      if (seen.has(username) || (query && !username.startsWith(query) && !member.user.displayName.toLowerCase().includes(query))) continue;
      seen.add(username);
      suggestions.push({ key: member.user.id, username: member.user.username, label: member.user.displayName, color: member.user.avatarColor });
      if (suggestions.length >= 8) break;
    }
    return suggestions;
  }, [content, members, permissions.canMentionEveryone]);

  useEffect(() => { setCommandIndex(0); setMentionIndex(0); }, [content, channel.id]);
  useEffect(() => { setTemplateOpen(false); setEmojiOpen(false); setEditingMessageId(null); }, [channel.id]);
  useEffect(() => {
    if (!feedback) return;
    const timer = window.setTimeout(() => setFeedback(""), 2600);
    return () => window.clearTimeout(timer);
  }, [feedback]);

  useEffect(() => {
    const onSearchShortcut = (event: Event) => {
      const keyboardEvent = event as globalThis.KeyboardEvent;
      if (!(keyboardEvent.ctrlKey || keyboardEvent.metaKey) || keyboardEvent.shiftKey || keyboardEvent.key.toLowerCase() !== "f") return;
      const target = keyboardEvent.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, [contenteditable='true']") && !searchOpen) return;
      keyboardEvent.preventDefault();
      setSearchOpen(true);
      requestAnimationFrame(() => document.querySelector<HTMLInputElement>(".chat-search-panel input")?.focus());
    };
    window.addEventListener("keydown", onSearchShortcut);
    return () => window.removeEventListener("keydown", onSearchShortcut);
  }, [searchOpen]);

  useEffect(() => {
    const openMessage = (detail?: { channelId?: string; messageId?: string }) => {
      if (!detail?.messageId || detail.channelId !== channel.id) return;
      initialScrollPendingRef.current = false;
      try { sessionStorage.removeItem("ginga.pendingMessageJump"); } catch {}
      void jumpToMessage(detail.messageId);
    };
    const onJumpMessage = (event: Event) => openMessage((event as CustomEvent<{ channelId?: string; messageId?: string }>).detail);
    window.addEventListener("ginga:jump-message", onJumpMessage as EventListener);
    try {
      const raw = sessionStorage.getItem("ginga.pendingMessageJump");
      if (raw) {
        const pending = JSON.parse(raw) as { channelId?: string; messageId?: string; at?: number };
        if (typeof pending.at === "number" && Date.now() - pending.at > 10_000) sessionStorage.removeItem("ginga.pendingMessageJump");
        else if (pending.channelId === channel.id && pending.messageId) window.setTimeout(() => openMessage(pending), 80);
      }
    } catch { /* armazenamento de sessao e apenas um fallback de navegacao */ }
    return () => window.removeEventListener("ginga:jump-message", onJumpMessage as EventListener);
  }, [channel.id]);

  function selectCommand(command: ChannelCommand) {
    setContent(`/${command.name} `);
    setCommandIndex(0);
    requestAnimationFrame(() => textareaRef.current?.focus());
  }

  function selectMention(username: string) {
    setContent((current) => current.replace(/(^|[^a-zA-Z0-9_.-])@[a-zA-Z0-9_.-]*$/, `$1@${username} `));
    setMentionIndex(0);
    requestAnimationFrame(() => textareaRef.current?.focus());
  }

  function insertMessageTemplate(body: string) {
    setContent((current) => current.trim() ? `${current.trimEnd()}\n\n${body}` : body);
    setTemplateOpen(false);
    requestAnimationFrame(() => textareaRef.current?.focus());
  }

  async function uploadFiles(files: File[]) {
    const available = Math.max(0, 10 - pendingAttachments.length - activeUploads.length);
    const selected = files.slice(0, available);
    if (selected.length === 0) {
      if (files.length > 0) setError("Limite de 10 anexos por mensagem atingido.");
      return;
    }

    setUploading(true);
    setError("");
    const jobs = selected.map(async (file, index) => {
      const id = `${Date.now()}-${index}-${file.name}-${file.size}`;
      setActiveUploads((current) => [...current, { id, name: file.name, progress: 0 }]);
      try {
        const attachment = await uploadFile(file, (progress) => {
          setActiveUploads((current) => current.map((item) => item.id === id ? { ...item, progress } : item));
        });
        return { ok: true as const, attachment };
      } catch (caught) {
        return { ok: false as const, error: caught instanceof Error ? caught.message : `Falha ao enviar ${file.name}` };
      } finally {
        window.setTimeout(() => setActiveUploads((current) => current.filter((item) => item.id !== id)), 350);
      }
    });

    const results = await Promise.all(jobs);
    const uploaded = results.filter((result): result is { ok: true; attachment: Attachment } => result.ok).map((result) => result.attachment);
    const failed = results.filter((result): result is { ok: false; error: string } => !result.ok);
    if (uploaded.length > 0) setPendingAttachments((current) => [...current, ...uploaded].slice(0, 10));
    if (failed.length > 0) setError(failed.length === 1 ? failed[0].error : `${failed.length} arquivos falharam no upload.`);
    if (files.length > selected.length) setFeedback("Alguns arquivos nao entraram porque o limite e 10 anexos.");
    setUploading(false);
  }

  async function chooseFiles(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []) as File[];
    event.target.value = "";
    await uploadFiles(files);
  }

  function onPaste(event: ReactClipboardEvent<HTMLTextAreaElement>) {
    const files = Array.from(event.clipboardData.files ?? []) as File[];
    if (files.length === 0) return;
    event.preventDefault();
    void uploadFiles(files);
  }

  function onDragEnter(event: ReactDragEvent<HTMLElement>) {
    if (!Array.from(event.dataTransfer.types).includes("Files")) return;
    event.preventDefault();
    dragDepthRef.current += 1;
    setDragActive(true);
  }

  function onDragOver(event: ReactDragEvent<HTMLElement>) {
    if (!Array.from(event.dataTransfer.types).includes("Files")) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  }

  function onDragLeave(event: ReactDragEvent<HTMLElement>) {
    event.preventDefault();
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) setDragActive(false);
  }

  function onDrop(event: ReactDragEvent<HTMLElement>) {
    event.preventDefault();
    dragDepthRef.current = 0;
    setDragActive(false);
    const files = Array.from(event.dataTransfer.files ?? []) as File[];
    if (files.length > 0) void uploadFiles(files);
  }

  function insertNativeEmoji(emoji: string) {
    setContent((current) => `${current}${emoji}`);
    setEmojiOpen(false);
    requestAnimationFrame(() => textareaRef.current?.focus());
  }

  async function chooseCustomEmoji(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (customEmojis.length >= 10) { setError("Voce pode guardar ate 10 emojis personalizados."); return; }
    setCustomEmojiBusy(true);
    setError("");
    try {
      const dataUrl = await resizeEmojiImage(file);
      const baseName = sanitizeEmojiName(customEmojiName.trim() || file.name);
      const uniqueName = customEmojis.some((item) => item.name === baseName) ? `${baseName}-${customEmojis.length + 1}`.slice(0, 24) : baseName;
      const next = [...customEmojis, { id: crypto.randomUUID?.() || `${Date.now()}-${Math.random()}`, name: uniqueName, dataUrl }].slice(0, 10);
      setCustomEmojis(next);
      saveCustomEmojis(next);
      setCustomEmojiName("");
      setFeedback(`Emoji :${uniqueName}: adicionado.`);
      void playUiSound("success");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Nao foi possivel criar o emoji");
    } finally {
      setCustomEmojiBusy(false);
    }
  }

  function removeCustomEmoji(emoji: CustomEmoji) {
    const next = customEmojis.filter((item) => item.id !== emoji.id);
    setCustomEmojis(next);
    saveCustomEmojis(next);
  }

  async function insertCustomEmoji(emoji: CustomEmoji) {
    if (uploading || customEmojiBusy) return;
    if (pendingAttachments.length >= 10) { setError("Limite de 10 anexos por mensagem atingido."); return; }
    setCustomEmojiBusy(true);
    setError("");
    try {
      const attachment = await uploadFile(await customEmojiFile(emoji));
      setPendingAttachments((current) => [...current, attachment].slice(0, 10));
      setContent((current) => `${current}${current && !/\s$/.test(current) ? " " : ""}${customEmojiToken(emoji.name, attachment.url)} `);
      setEmojiOpen(false);
      requestAnimationFrame(() => textareaRef.current?.focus());
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Nao foi possivel enviar o emoji");
    } finally {
      setCustomEmojiBusy(false);
    }
  }

  async function clearChannelMessages(input: string | number = 50) {
    if (!permissions.canManageMessages) { setError("Voce nao tem permissao para limpar mensagens deste canal."); return; }
    const normalized = typeof input === "number" ? input : input.trim().toLowerCase();
    const count: number | "all" = normalized === "all" || normalized === "tudo" || normalized === "todos"
      ? "all"
      : Math.min(500, Math.max(1, Number(normalized || 50) || 50));
    const label = count === "all" ? "TODAS as mensagens" : `as ultimas ${count} mensagens`;
    const accepted = await gingaConfirm(`Deseja remover ${label} de #${channel.name}? Esta acao nao pode ser desfeita.`, { title: "Limpar mensagens", confirmLabel: "Limpar", cancelLabel: "Cancelar", tone: "danger" });
    if (!accepted) return;
    try {
      const result = await api<{ deleted: number; messageIds: string[] }>(`/api/channels/${channel.id}/messages/clear`, { method: "POST", body: JSON.stringify({ count }) });
      const removed = new Set(result.messageIds);
      setMessages((current) => current.filter((item) => !removed.has(item.id)));
      setPinnedMessages((current) => current.filter((item) => !removed.has(item.id)));
      if (threadRoot && removed.has(threadRoot.id)) { setThreadRoot(null); setThreadReplies([]); }
      setFeedback(`${result.deleted} mensagem${result.deleted === 1 ? "" : "s"} removida${result.deleted === 1 ? "" : "s"}.`);
      setContent("");
      void playUiSound("success");
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Nao foi possivel limpar as mensagens"); }
  }

  async function sendVoiceMessage(file: File) {
    if (!socket.connected) throw new Error("Chat desconectado. Aguarde a reconexao.");
    const attachment = await uploadFile(file);
    await new Promise<void>((resolve, reject) => {
      socket.emit("message:send", {
        channelId: channel.id,
        content: "",
        attachmentIds: [attachment.id],
        replyToId: replyTo?.id ?? null
      }, (response: AckResponse) => {
        if (!response?.ok) { reject(new Error(response?.error ?? "Nao foi possivel enviar a mensagem de voz")); return; }
        if (response.message) {
          nearBottomRef.current = true;
          setMessages((current) => current.some((item) => item.id === response.message!.id) ? current : [...current, response.message!]);
          requestAnimationFrame(() => scrollToLatest("smooth"));
        }
        if (channel.slowModeSeconds && !permissions.canManageMessages) setSlowModeRemaining(channel.slowModeSeconds);
        setReplyTo(null);
        resolve();
      });
    }).catch(async (error) => {
      await api<void>(`/api/uploads/${attachment.id}`, { method: "DELETE" }).catch(() => undefined);
      throw error;
    });
  }

  function submit(event?: FormEvent) {
    event?.preventDefault();
    const trimmed = content.trim();
    if ((!trimmed && pendingAttachments.length === 0) || sending) return;
    if (!socket.connected) {
      setError("Chat desconectado. Aguarde a reconexao.");
      return;
    }
    if (slowModeRemaining > 0 && !permissions.canManageMessages) {
      setError(`Modo lento ativo. Aguarde ${slowModeRemaining}s.`);
      return;
    }
    const clearMatch = trimmed.match(/^\/clear(?:\s+(all|tudo|todos|\d+))?\s*$/i);
    if (clearMatch && permissions.canManageMessages) {
      void clearChannelMessages(clearMatch[1] || 50);
      return;
    }
    const invalidMentions = invalidGuildMentions(trimmed, members);
    if (invalidMentions.length) {
      setError(`${invalidMentions.map((name) => `@${name}`).join(", ")} nao existe${invalidMentions.length === 1 ? "" : "m"} neste servidor.`);
      return;
    }

    setSending(true);
    setError("");
    socket.emit("message:send", {
      channelId: channel.id,
      content: trimmed,
      attachmentIds: pendingAttachments.map((attachment) => attachment.id),
      replyToId: replyTo?.id ?? null
    }, (response: AckResponse) => {
      setSending(false);
      if (!response?.ok) {
        setError(response?.error ?? "Nao foi possivel enviar a mensagem");
        return;
      }
      if (response.message) {
        nearBottomRef.current = true;
        setMessages((current) => current.some((item) => item.id === response.message!.id) ? current : [...current, response.message!]);
        requestAnimationFrame(() => scrollToLatest("smooth"));
      }
      setContent("");
      if (channel.slowModeSeconds && !permissions.canManageMessages) setSlowModeRemaining(channel.slowModeSeconds);
      try { localStorage.removeItem(draftStorageKey()); } catch {}
      setPendingAttachments([]);
      setReplyTo(null);
      textareaRef.current?.focus();
    });
  }

  function onKeyDown(event: ReactKeyboardEvent<HTMLTextAreaElement>) {
    if (handleMessageFormatShortcut(event, { textareaRef, value: content, onChange: setContent })) return;
    if (commandSuggestions.length > 0) {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setCommandIndex((index) => (index + 1) % commandSuggestions.length);
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        setCommandIndex((index) => (index - 1 + commandSuggestions.length) % commandSuggestions.length);
        return;
      }
      if ((event.key === "Enter" && !event.shiftKey) || event.key === "Tab") {
        event.preventDefault();
        selectCommand(commandSuggestions[Math.min(commandIndex, commandSuggestions.length - 1)]);
        return;
      }
    }
    if (mentionSuggestions.length > 0) {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setMentionIndex((index) => (index + 1) % mentionSuggestions.length);
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        setMentionIndex((index) => (index - 1 + mentionSuggestions.length) % mentionSuggestions.length);
        return;
      }
      if ((event.key === "Enter" && !event.shiftKey) || event.key === "Tab") {
        event.preventDefault();
        selectMention(mentionSuggestions[Math.min(mentionIndex, mentionSuggestions.length - 1)].username);
        return;
      }
    }
    if (event.key === "Escape") {
      if (replyTo || emojiOpen || templateOpen || pinsOpen) {
        event.preventDefault();
        setReplyTo(null);
        setEmojiOpen(false);
        setTemplateOpen(false);
        setPinsOpen(false);
        return;
      }
    }
    if (event.key === "ArrowUp" && !content.trim() && !replyTo) {
      const lastOwnMessage = [...messages].reverse().find((message) => message.authorId === currentUser.id && Boolean(message.content?.trim()));
      if (lastOwnMessage) {
        event.preventDefault();
        beginEditMessage(lastOwnMessage);
        return;
      }
    }
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      submit();
    }
  }

  async function removePendingAttachment(attachment: Attachment) {
    setPendingAttachments((items) => items.filter((item) => item.id !== attachment.id));
    if (attachment.originalName.startsWith("ginga-emoji-")) setContent((current) => removeEmojiTokenByUrl(current, attachment.url));
    try {
      await api<void>(`/api/uploads/${attachment.id}`, { method: "DELETE" });
    } catch {
      // O anexo pode ter sido limpo no servidor; não bloqueia a composição da mensagem.
    }
  }

  async function react(message: ChatMessage, emoji: string) {
    const mine = message.reactions?.some((item) => item.emoji === emoji && item.userId === currentUser.id);
    const result = await api<{ reactions: MessageReaction[] }>(`/api/messages/${message.id}/reactions`, { method: mine ? "DELETE" : "POST", body: JSON.stringify({ emoji }) });
    setMessages((current) => current.map((item) => item.id === message.id ? { ...item, reactions: result.reactions } : item));
  }
  function openReactionPicker(message: ChatMessage, x: number, y: number) {
    const width = 322;
    const height = 300;
    setReactionPicker({
      message,
      x: Math.max(8, Math.min(window.innerWidth - width - 8, x)),
      y: Math.max(8, Math.min(window.innerHeight - height - 8, y))
    });
    setMessageMenu(null);
  }

  async function forwardMessage(message: ChatMessage, targetChannelId: string) {
    if (forwardBusy) return;
    setForwardBusy(true);
    setError("");
    try {
      await api<{ message: ChatMessage }>(`/api/messages/${message.id}/forward`, {
        method: "POST",
        body: JSON.stringify({ targetChannelId })
      });
      const target = forwardChannels.find((item) => item.id === targetChannelId);
      setFeedback(`Mensagem encaminhada${target ? ` para #${target.name}` : ""}.`);
      setForwardTarget(null);
      setMessageMenu(null);
      void playUiSound("success");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Nao foi possivel encaminhar a mensagem");
    } finally {
      setForwardBusy(false);
    }
  }
  function beginEditMessage(message: ChatMessage) {
    setEditingMessageId(message.id);
    setEditDraft(message.content);
    setMessageMenu(null);
  }

  function cancelEditMessage() {
    setEditingMessageId(null);
    setEditDraft("");
  }

  async function saveEditMessage(message: ChatMessage) {
    const next = editDraft.trim();
    if (!next || next === message.content || editSaving) {
      if (next === message.content) cancelEditMessage();
      return;
    }
    setEditSaving(true);
    setError("");
    try {
      const result = await api<{ message: ChatMessage }>(`/api/messages/${message.id}`, { method: "PATCH", body: JSON.stringify({ content: next }) });
      setMessages((current) => current.map((item) => item.id === message.id ? result.message : item));
      setPinnedMessages((current) => current.map((item) => item.id === message.id ? result.message : item));
      cancelEditMessage();
      setFeedback("Mensagem editada.");
      void playUiSound("success");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Nao foi possivel editar a mensagem");
    } finally {
      setEditSaving(false);
    }
  }
  async function deleteMessage(message: ChatMessage) { if(!(await gingaConfirm("A mensagem sera removida do canal.", { title: "Excluir mensagem?", confirmLabel: "Excluir", tone: "danger" }))) return; await api(`/api/messages/${message.id}`,{method:"DELETE"}); setMessages((current)=>current.filter((item)=>item.id!==message.id)); }
  async function pinMessage(message: ChatMessage) {
    const method=message.isPinned?"DELETE":"PUT";
    const result=await api<{message:ChatMessage}>(`/api/messages/${message.id}/pin`,{method});
    setMessages((current)=>current.map((item)=>item.id===message.id?result.message:item));
    setPinnedMessages((current) => message.isPinned ? current.filter((item) => item.id !== message.id) : current.some((item) => item.id === message.id) ? current : [result.message, ...current]);
    setFeedback(message.isPinned ? "Mensagem desafixada." : "Mensagem fixada.");
    void playUiSound("success");
  }
  async function loadPinnedMessages() {
    setPinsLoading(true);
    setPinsNotice("");

    // A lista principal ja traz isPinned. Isso deixa o painel util mesmo em
    // instalacoes antigas que ainda nao possuem uma rota dedicada de fixados.
    const loadedPins = messages.filter((message) => message.isPinned);
    if (loadedPins.length) setPinnedMessages(loadedPins);

    const endpoints = [
      `/api/channels/${channel.id}/pins`,
      `/api/channels/${channel.id}/messages/pins`,
      `/api/channels/${channel.id}/messages/pinned`,
      `/api/channels/${channel.id}/pinned-messages`,
      `/api/messages/channels/${channel.id}/pins`
    ];

    let lastError: unknown = null;
    for (const endpoint of endpoints) {
      try {
        const result = await api<{ messages: ChatMessage[] }>(endpoint);
        setPinnedMessages(result.messages);
        setPinsLoading(false);
        return;
      } catch (caught) {
        lastError = caught;
      }
    }

    // Nao joga erro de rota no compositor. Em bases 1.5.0 antigas, usa os
    // fixados que vieram junto do GET normal de mensagens e continua ouvindo
    // message:updated para manter todos os clientes sincronizados.
    setPinnedMessages(loadedPins);
    if (!loadedPins.length && lastError) setPinsNotice("Nenhum fixado foi carregado. Atualize a API junto com a Web se o canal possuir mensagens antigas fixadas.");
    setPinsLoading(false);
  }
  async function togglePins() {
    const next=!pinsOpen;
    setPinsOpen(next);
    if(next) await loadPinnedMessages();
  }
  async function jumpToMessage(messageId: string) {
    setError("");
    setPinsOpen(false);

    let element = document.getElementById(`message-${messageId}`);
    if (!element) {
      try {
        const result = await api<{ message: ChatMessage }>(`/api/messages/${encodeURIComponent(messageId)}`);
        if (result.message.channelId !== channel.id) {
          setError("Essa mensagem pertence a outro canal.");
          return;
        }
        setMessages((current) => {
          if (current.some((item) => item.id === result.message.id)) return current;
          return [...current, result.message].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
        });
        await new Promise<void>((resolve) => window.requestAnimationFrame(() => window.requestAnimationFrame(() => resolve())));
        element = document.getElementById(`message-${messageId}`);
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : "Essa mensagem nao esta mais disponivel.");
        return;
      }
    }

    if (!element) {
      setError("Nao foi possivel localizar essa mensagem no canal.");
      return;
    }
    element.scrollIntoView({ behavior: "smooth", block: "center" });
    element.classList.add("message-jump-highlight");
    window.setTimeout(() => element?.classList.remove("message-jump-highlight"), 1500);
  }
  async function bookmarkMessage(message: ChatMessage) {
    setError("");
    try {
      await api(`/api/messages/${message.id}/bookmark`, { method: "PUT", body: JSON.stringify({ note: "" }) });
      setSavedMessageIds((current) => new Set(current).add(message.id));
      setMessageMenu(null);
      setFeedback("Mensagem salva nos seus itens.");
      void playUiSound("success");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Nao foi possivel salvar a mensagem");
    }
  }
  async function archiveMessage(message: ChatMessage) {
    try {
      await api(`/api/messages/${message.id}/archive`, { method: "PUT" });
      setMessageMenu(null);
      setFeedback("Mensagem arquivada.");
      void playUiSound("success");
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Nao foi possivel arquivar a mensagem"); }
  }
  async function createTaskFromMessage(message: ChatMessage) {
    const suggested = message.content.trim().slice(0, 120) || "Revisar mensagem";
    const title = await gingaPrompt("Escolha um nome curto para a tarefa.", suggested, { title: "Criar tarefa", confirmLabel: "Criar" });
    if (title === null || !title.trim()) return;
    await api(`/api/messages/${message.id}/task`, { method: "POST", body: JSON.stringify({ title: title.trim() }) });
    setMessageMenu(null);
    setFeedback("Tarefa criada.");
    void playUiSound("success");
  }
  async function openThread(message: ChatMessage) {
    setMessageMenu(null); setThreadLoading(true); setThreadError(""); setThreadDraft("");
    try { const result=await api<{root:ChatMessage;replies:ChatMessage[]}>(`/api/messages/${encodeURIComponent(message.id)}/thread`); setThreadRoot(result.root);setThreadReplies(result.replies); }
    catch(caught){setThreadRoot(null);setThreadReplies([]);setThreadError(caught instanceof Error?caught.message:"Nao foi possivel abrir a thread");}
    finally{setThreadLoading(false);}
  }
  function closeThread(){setThreadRoot(null);setThreadReplies([]);setThreadDraft("");setThreadError("");}
  function sendThreadReply(event:FormEvent<HTMLFormElement>){event.preventDefault();if(!threadRoot||threadSending||!threadDraft.trim())return;if(!socket.connected){setThreadError("Chat desconectado. Aguarde a reconexao.");return;}if(slowModeRemaining>0&&!permissions.canManageMessages){setThreadError(`Modo lento ativo. Aguarde ${slowModeRemaining}s.`);return;}const content=threadDraft.trim();const invalid=invalidGuildMentions(content,members);if(invalid.length){setThreadError(`${invalid.map((name)=>`@${name}`).join(", ")} nao existe${invalid.length===1?"":"m"} neste servidor.`);return;}setThreadSending(true);socket.emit("message:send",{channelId:channel.id,content,attachmentIds:[],replyToId:threadRoot.id},(response:AckResponse)=>{setThreadSending(false);if(!response?.ok){setThreadError(response?.error??"Nao foi possivel responder na thread");return;}if(response.message){setThreadReplies(cur=>cur.some(i=>i.id===response.message!.id)?cur:[...cur,response.message!]);setMessages(cur=>cur.some(i=>i.id===response.message!.id)?cur:[...cur,response.message!]);}if(channel.slowModeSeconds&&!permissions.canManageMessages)setSlowModeRemaining(channel.slowModeSeconds);setThreadDraft("");});}

  async function copyMessage(message: ChatMessage) { if (message.content) await navigator.clipboard.writeText(message.content); setMessageMenu(null); setFeedback("Mensagem copiada."); }
  async function copyMessageId(message: ChatMessage) { await navigator.clipboard.writeText(message.id); setMessageMenu(null); setFeedback("ID da mensagem copiado."); }
  async function copyMessageLink(message: ChatMessage) {
    const url = new URL(window.location.href);
    url.hash = `message-${message.id}`;
    await navigator.clipboard.writeText(url.toString());
    setMessageMenu(null);
    setFeedback("Link da mensagem copiado.");
  }
  function openMessageMenu(message: ChatMessage, x: number, y: number) { setMessageMenu({ message, x: Math.max(8, x), y: Math.max(8, y) }); }
  async function scheduleCurrent() { if(!permissions.canScheduleMessages || !content.trim()) return; const when=await gingaPrompt("Informe data, horario e fuso. Ex.: 2026-08-20T09:00:00-03:00", "", { title: "Agendar mensagem", confirmLabel: "Agendar", placeholder: "2026-08-20T09:00:00-03:00" }); if(!when)return; const date=new Date(when); if(Number.isNaN(date.getTime())){setError("Data invalida");return;} await api(`/api/channels/${channel.id}/scheduled-messages`,{method:"POST",body:JSON.stringify({content:content.trim(),scheduledFor:date.toISOString()})}); setContent(""); setFeedback("Mensagem agendada com sucesso."); void playUiSound("success"); }

  return (
    <section className={`chat-view ${channel.type === "ANNOUNCEMENT" ? "announcement-chat-view" : ""} ${dragActive ? "chat-drag-active" : ""}`} onDragEnter={onDragEnter} onDragOver={onDragOver} onDragLeave={onDragLeave} onDrop={onDrop}>
      <header className="content-header">
        <div className="channel-title">{channel.type === "ANNOUNCEMENT" ? <Megaphone size={19}/> : <MessageSquare size={19} />}<strong>{channel.name}</strong></div>
        <span className="channel-topic">{channel.topic || (channel.type === "ANNOUNCEMENT" ? "Comunicados e atualizacoes do espaco" : "Converse com todos neste canal")}</span>
        <div className="channel-header-actions">
          <button type="button" className={`compact-icon-button ${searchOpen ? "active" : ""}`} onClick={() => { setSearchOpen((value) => !value); setPinsOpen(false); }} aria-label="Buscar nesta conversa"><Search size={17}/><span>Buscar</span></button>
          <button type="button" className={`compact-icon-button ${pinsOpen ? "active" : ""}`} onClick={()=>void togglePins()} aria-label="Mensagens fixadas"><Pin size={17}/><span>Fixados</span></button>
        </div>
      </header>
      {channel.type === "ANNOUNCEMENT" && <div className="announcement-channel-banner announcement-channel-banner-v2"><span className="announcement-banner-icon"><Megaphone size={20}/></span><div><strong>Central de anúncios</strong><span>Comunicados importantes ganham mais destaque e ficam fáceis de consultar depois.</span></div><div className="announcement-banner-stats"><b>{messages.length}</b><span>publicaç{messages.length === 1 ? "ão" : "ões"}</span></div></div>}
      {searchOpen && <aside className="chat-search-panel">
        <header><div><Search size={16}/><strong>Buscar em #{channel.name}</strong></div><button type="button" onClick={() => { setSearchOpen(false); setSearchQuery(""); }} aria-label="Fechar busca"><X size={16}/></button></header>
        <div className="chat-search-input"><Search size={15}/><input value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} placeholder="Mensagem, pessoa ou arquivo" maxLength={120}/><kbd>Ctrl F</kbd></div>
        <div className="chat-search-results">
          {!searchQuery.trim() && <div className="chat-search-empty">Busque no historico completo deste canal por mensagem, pessoa ou nome de arquivo.</div>}
          {searchQuery.trim().length === 1 && <div className="chat-search-empty">Digite pelo menos 2 caracteres para buscar no historico.</div>}
          {searchLoading && <div className="chat-search-empty"><LoaderCircle className="spin" size={15}/> Buscando no historico...</div>}
          {!searchLoading && searchError && <div className="chat-search-empty">{searchError}</div>}
          {!searchLoading && searchQuery.trim().length >= 2 && !searchError && searchResults.length === 0 && <div className="chat-search-empty">Nenhuma mensagem encontrada.</div>}
          {searchResults.map((message) => <button type="button" key={message.id} onClick={() => { void jumpToMessage(message.id); setSearchOpen(false); }}><Avatar user={message.author} size="sm"/><span><strong className="role-colored-name" style={memberVisuals.get(message.authorId)?.color ? { color: memberVisuals.get(message.authorId)!.color } : undefined}>{message.author.displayName}{memberVisuals.get(message.authorId)?.owner && <Crown size={12} className="guild-owner-crown" />}</strong><small>{formatFullTimestamp(message.createdAt)}</small><em>{message.content?.slice(0, 140) || message.attachments[0]?.originalName || "Mensagem com anexo"}</em></span></button>)}
        </div>
      </aside>}
      {pinsOpen && <aside className="pinned-panel">
        <header><div><Pin size={17}/><strong>Mensagens fixadas</strong></div><button type="button" onClick={()=>setPinsOpen(false)} aria-label="Fechar mensagens fixadas"><X size={17}/></button></header>
        <div className="pinned-panel-list">
          {pinsLoading && <div className="center-state"><LoaderCircle className="spin"/> Carregando...</div>}
          {!pinsLoading && pinsNotice && <div className="pinned-panel-notice">{pinsNotice}</div>}
          {!pinsLoading && pinnedMessages.length===0 && <div className="saved-empty">Nenhuma mensagem fixada neste canal.</div>}
          {!pinsLoading && pinnedMessages.map((message)=><article key={message.id} className="pinned-message-card" onClick={()=>void jumpToMessage(message.id)}><Avatar user={message.author} size="sm"/><div><div className="pinned-message-meta"><strong className="role-colored-name" style={memberVisuals.get(message.authorId)?.color ? { color: memberVisuals.get(message.authorId)!.color } : undefined}>{message.author.displayName}{memberVisuals.get(message.authorId)?.owner && <Crown size={12} className="guild-owner-crown" />}</strong><small>{formatFullTimestamp(message.createdAt)}</small></div><div className="pinned-message-content">{message.content ? <MessageContent content={message.content} username={currentUser.username} members={members} onUserClick={onUserClick} /> : "Mensagem com anexo"}</div>{message.attachments.length > 0 && <span className="pinned-attachment-count"><Paperclip size={12}/>{message.attachments.length} anexo{message.attachments.length === 1 ? "" : "s"}</span>}</div>{permissions.canPinMessages&&<button type="button" aria-label="Desafixar mensagem" onClick={(event)=>{event.stopPropagation();void pinMessage(message);}}><X size={15}/></button>}</article>)}
        </div>
      </aside>}
      {feedback && <div className="ginga-toast"><Check size={15}/>{feedback}</div>}

      <div className="message-scroll" ref={messageScrollRef} onScroll={() => {
        const near = isNearBottom();
        nearBottomRef.current = near;
        setShowScrollToBottom(!near);
        if (near) setNewMessageCount(0);
      }}>
        {loading && <div className="center-state"><LoaderCircle className="spin" /> Carregando conversa...</div>}
        {!loading && messages.length === 0 && (
          <div className={`empty-channel ${channel.type === "ANNOUNCEMENT" ? "announcement-empty-channel" : ""}`}>
            <div className="empty-channel-icon">{channel.type === "ANNOUNCEMENT" ? <Megaphone size={30}/> : <MessageSquare size={28} />}</div>
            <h2>{channel.type === "ANNOUNCEMENT" ? `Nenhum anúncio em ${channel.name}` : `Bem-vindo a ${channel.name}`}</h2>
            <p>{channel.type === "ANNOUNCEMENT" ? "Publique o primeiro comunicado importante deste espaço." : "Este é o começo do canal. Envie a primeira mensagem."}</p>
          </div>
        )}

        {messages.map((message, index) => {
          const previous = messages[index - 1];
          const compact = Boolean(
            channel.type !== "ANNOUNCEMENT" &&
            previous &&
            previous.authorId === message.authorId &&
            new Date(message.createdAt).getTime() - new Date(previous.createdAt).getTime() < 5 * 60 * 1000 &&
            !dayMarkers.get(message.id)
          );
          const visibleAttachments = message.attachments.filter((attachment) => !(attachment.originalName.startsWith("ginga-emoji-") && contentHasEmojiUrl(message.content, attachment.url)));

          return (
            <div key={message.id}>
              {dayMarkers.get(message.id) && (() => {
                const label = formatDayDivider(message.createdAt);
                return <div className="day-divider" title={label.fullDate}><span><strong>{label.relative}</strong><small>{label.fullDate}</small></span></div>;
              })()}
              <article id={`message-${message.id}`} className={`message-row ${compact ? "message-compact" : ""} ${channel.type === "ANNOUNCEMENT" ? "announcement-message-row" : ""} ${message.authorId === currentUser.id ? "message-own" : ""} ${message.authorId !== currentUser.id && messageMentionsUser(message.content, currentUser.username) ? "message-mentioned" : ""} ${message.id === highlightedMessageId ? "message-arrived" : ""}`} onContextMenu={(event) => { event.preventDefault(); openMessageMenu(message, event.clientX, event.clientY); }}>
                {!compact && <button className="message-user-button avatar-button" type="button" aria-label={`Abrir perfil de ${message.author.displayName}`} onClick={(event) => onUserClick?.(message.author, event.currentTarget.getBoundingClientRect())} onContextMenu={(event) => { event.preventDefault(); event.stopPropagation(); setMessageMenu(null); onUserContextMenu?.(message.author, event.clientX, event.clientY); }}><Avatar user={message.author} size="md" /></button>}
                {compact && <time className="compact-time" dateTime={message.createdAt} title={formatFullTimestamp(message.createdAt)}>{timeFormatter.format(new Date(message.createdAt))}</time>}
                <div className="message-body">
                  {!compact && (
                    <div className="message-meta">
                      <button className="message-author-button" type="button" onClick={(event) => onUserClick?.(message.author, event.currentTarget.getBoundingClientRect())} onContextMenu={(event) => { event.preventDefault(); event.stopPropagation(); setMessageMenu(null); onUserContextMenu?.(message.author, event.clientX, event.clientY); }}><strong className="role-colored-name" style={memberVisuals.get(message.authorId)?.color ? { color: memberVisuals.get(message.authorId)!.color } : undefined}>{message.author.displayName}{memberVisuals.get(message.authorId)?.owner && <Crown size={13} className="guild-owner-crown" aria-label="Criador do servidor" />} <UserBadges user={message.author} compact /></strong><span>@{message.author.username}</span></button>
                      <time dateTime={message.createdAt} title={formatFullTimestamp(message.createdAt)}>{timeFormatter.format(new Date(message.createdAt))}</time>
                    </div>
                  )}
                  {message.replyTo && <button className="message-reply-ref" type="button" onClick={() => void jumpToMessage(message.replyTo!.id)} aria-label="Ir para mensagem respondida"><Reply size={13}/><strong className="role-colored-name" style={memberVisuals.get(message.replyTo.authorId)?.color ? { color: memberVisuals.get(message.replyTo.authorId)!.color } : undefined}>{message.replyTo.author.displayName}{memberVisuals.get(message.replyTo.authorId)?.owner && <Crown size={11} className="guild-owner-crown" />}</strong><span>{message.replyTo.content?.slice(0,90) || "Mensagem"}</span></button>}
                  <div className="message-state-badges">
                    {channel.type === "ANNOUNCEMENT" && <span className="message-announcement-badge"><Megaphone size={12}/> ANÚNCIO</span>}
                    {message.isPinned && <span className="message-pinned"><Pin size={12}/> Fixada</span>}
                    {savedMessageIds.has(message.id) && <span className="message-saved"><Bookmark size={12}/> Salva</span>}
                  </div>
                  {editingMessageId === message.id ? (
                    <div className="inline-message-editor">
                      <textarea value={editDraft} onChange={(event)=>setEditDraft(event.target.value)} maxLength={4000} autoFocus onKeyDown={(event)=>{if(event.key === "Escape") cancelEditMessage(); if(event.key === "Enter" && (event.ctrlKey || event.metaKey)){event.preventDefault();void saveEditMessage(message);}}} />
                      <div><span>Esc cancela • Ctrl+Enter salva</span><button type="button" className="secondary-button" onClick={cancelEditMessage}>Cancelar</button><button type="button" className="primary-compact-button" onClick={()=>void saveEditMessage(message)} disabled={editSaving || !editDraft.trim()}>{editSaving ? <LoaderCircle className="spin" size={14}/> : <Check size={14}/>} Salvar</button></div>
                    </div>
                  ) : message.content ? <div className="message-text"><MessageContent content={message.content} username={currentUser.username} members={members} onUserClick={onUserClick} /></div> : null}
                  {visibleAttachments.length > 0 && (
                    <div className="message-attachments">
                      {visibleAttachments.map((attachment) => <MessageAttachment key={attachment.id} attachment={attachment} onPreview={setMediaViewer} />)}
                    </div>
                  )}
                  {message.reactions && message.reactions.length > 0 && <div className="reaction-row">{Array.from(new Set(message.reactions.map((item)=>item.emoji))).map((emoji)=>{
                    const list=message.reactions!.filter((item)=>item.emoji===emoji);
                    const names=list.map((item)=>item.user?.displayName || members.find((member)=>member.user.id===item.userId)?.user.displayName || (item.userId===currentUser.id?currentUser.displayName:"Usuario"));
                    const mine=list.some((item)=>item.userId===currentUser.id);
                    const ariaNames=names.length<=4?names.join(", "):`${names.slice(0,4).join(", ")} e mais ${names.length-4}`;
                    return <button
                      type="button"
                      className={`reaction-chip ${mine?"mine":""}`}
                      key={emoji}
                      aria-label={`${emoji}: ${ariaNames}`}
                      onMouseEnter={(event)=>{const rect=event.currentTarget.getBoundingClientRect();setReactionHover({emoji,names,x:Math.min(window.innerWidth-18,Math.max(18,rect.left+rect.width/2)),y:Math.max(18,rect.top-8)});}}
                      onMouseLeave={()=>setReactionHover(null)}
                      onFocus={(event)=>{const rect=event.currentTarget.getBoundingClientRect();setReactionHover({emoji,names,x:Math.min(window.innerWidth-18,Math.max(18,rect.left+rect.width/2)),y:Math.max(18,rect.top-8)});}}
                      onBlur={()=>setReactionHover(null)}
                      onClick={()=>void react(message,emoji)}
                    ><span className="reaction-chip-emoji">{emoji}</span><span className="reaction-chip-count">{list.length}</span></button>;
                  })}</div>}
                  <div className="message-actions message-quick-actions">
                    <button className="message-action-button" aria-label="Adicionar reacao" title="Adicionar reacao" onClick={(event)=>{const rect=event.currentTarget.getBoundingClientRect();openReactionPicker(message, rect.right - 310, rect.bottom + 6);}}><Smile size={16}/></button>
                    <button className="message-action-button" aria-label="Responder" title="Responder" onClick={()=>{setReplyTo(message);requestAnimationFrame(()=>textareaRef.current?.focus());}}><Reply size={16}/></button><button className="message-action-button" aria-label="Abrir thread" title="Abrir thread" onClick={()=>void openThread(message)}><MessageSquare size={16}/></button>
                    <button className="message-action-button" aria-label="Encaminhar" title="Encaminhar" onClick={()=>setForwardTarget(message)}><Forward size={16}/></button>
                    <button className="message-menu-trigger" aria-label="Mais acoes" title="Mais acoes" onClick={(event)=>{const rect=event.currentTarget.getBoundingClientRect();openMessageMenu(message, rect.right - 232, rect.bottom + 6);}}><ChevronUp size={16}/></button>
                  </div>
                </div>
              </article>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>
      {showScrollToBottom && <button type="button" className={`new-messages-jump ${newMessageCount > 0 ? "has-new" : ""}`} onClick={() => scrollToLatest()} aria-label={newMessageCount > 0 ? `${newMessageCount} mensagens novas. Ir para o final.` : "Ir para o final da conversa"}><ArrowDown size={17}/><span>{newMessageCount > 0 ? `${newMessageCount} mensagem${newMessageCount === 1 ? " nova" : "s novas"}` : "Ir para o final"}</span>{newMessageCount > 0 && <strong>Ver agora</strong>}</button>}
      {dragActive && <div className="chat-drop-overlay"><Paperclip size={28}/><strong>Solte para enviar</strong><span>Ate 10 arquivos por mensagem</span></div>}

      {messageMenu && <ContextMenu x={messageMenu.x} y={messageMenu.y} onClose={() => setMessageMenu(null)}>
        <div className="message-menu-reactions">{["👍","❤️","✅","😂"].map((emoji)=><button key={emoji} aria-label={`Reagir ${emoji}`} onClick={()=>{void react(messageMenu.message,emoji);setMessageMenu(null);}}>{emoji}</button>)}</div>
        <button onClick={()=>{const current=messageMenu.message;openReactionPicker(current,messageMenu.x,messageMenu.y);}}><Smile size={15}/> Mais reacoes</button>
        <button onClick={()=>{setReplyTo(messageMenu.message);setMessageMenu(null);requestAnimationFrame(()=>textareaRef.current?.focus());}}><Reply size={15}/> Responder</button><button onClick={()=>void openThread(messageMenu.message)}><MessageSquare size={15}/> Abrir thread</button>
        <button onClick={()=>{setForwardTarget(messageMenu.message);setMessageMenu(null);}}><Forward size={15}/> Encaminhar</button>
        {messageMenu.message.content && <button onClick={()=>void copyMessage(messageMenu.message)}><Copy size={15}/> Copiar texto</button>}
        <button onClick={()=>void copyMessageLink(messageMenu.message)}><Link size={15}/> Copiar link da mensagem</button>
        {developerMode && <button onClick={()=>void copyMessageId(messageMenu.message)}><Copy size={15}/> Copiar ID da mensagem</button>}
        <button onClick={()=>void bookmarkMessage(messageMenu.message)}><Bookmark size={15}/> Salvar</button>
        <button onClick={()=>void archiveMessage(messageMenu.message)}><Archive size={15}/> Arquivar</button>
        <button onClick={()=>void createTaskFromMessage(messageMenu.message)}><ListTodo size={15}/> Criar tarefa</button>
        {permissions.canPinMessages && <button onClick={()=>{void pinMessage(messageMenu.message);setMessageMenu(null);}}><Pin size={15}/> {messageMenu.message.isPinned ? "Desafixar" : "Fixar"}</button>}
        {messageMenu.message.authorId === currentUser.id && <button onClick={()=>beginEditMessage(messageMenu.message)}><Pencil size={15}/> Editar</button>}
        {(messageMenu.message.authorId === currentUser.id || permissions.canManageMessages) && <><div className="context-menu-separator"/><button className="danger" onClick={()=>{void deleteMessage(messageMenu.message);setMessageMenu(null);}}><Trash2 size={15}/> Excluir</button></>}
      </ContextMenu>}

      {reactionHover && <div className="reaction-hover-card" style={{ left: reactionHover.x, top: reactionHover.y }} role="tooltip">
        <div className="reaction-hover-emoji">{reactionHover.emoji}</div>
        <div className="reaction-hover-copy">
          <strong>{reactionHover.names.length===1?reactionHover.names[0]:reactionHover.names.slice(0,4).join(", ")}</strong>
          <small>{reactionHover.names.length===1?"reagiu a esta mensagem":reactionHover.names.length<=4?"reagiram a esta mensagem":`e mais ${reactionHover.names.length-4} reagiram`}</small>
        </div>
      </div>}

      {reactionPicker && <div className="message-reaction-popover" style={{ left: reactionPicker.x, top: reactionPicker.y }} role="dialog" aria-label="Escolher reacao">
        <header><div><Smile size={16}/><strong>Reagir à mensagem</strong></div><button type="button" onClick={()=>setReactionPicker(null)} aria-label="Fechar"><X size={15}/></button></header>
        <div className="message-reaction-grid">{nativeEmojis.map((emoji)=><button type="button" key={emoji} onClick={()=>{void react(reactionPicker.message,emoji);setReactionPicker(null);}} aria-label={`Reagir com ${emoji}`}>{emoji}</button>)}</div>
      </div>}

      {forwardTarget && <div className="message-forward-backdrop" role="presentation" onMouseDown={(event)=>{if(event.target===event.currentTarget&&!forwardBusy)setForwardTarget(null);}}>
        <section className="message-forward-dialog" role="dialog" aria-modal="true" aria-label="Encaminhar mensagem">
          <header><div><Forward size={18}/><span><strong>Encaminhar mensagem</strong><small>Escolha um canal deste servidor</small></span></div><button type="button" onClick={()=>setForwardTarget(null)} disabled={forwardBusy} aria-label="Fechar"><X size={17}/></button></header>
          <div className="message-forward-preview"><strong>{forwardTarget.author.displayName}</strong><p>{forwardTarget.content || (forwardTarget.attachments.length ? `Mensagem com ${forwardTarget.attachments.length} anexo${forwardTarget.attachments.length===1?"":"s"}` : "Mensagem")}</p>{forwardTarget.attachments.length>0&&<small>Os anexos permanecem na mensagem original.</small>}</div>
          <div className="message-forward-channels">
            {forwardChannels.filter((item)=>["TEXT","ANNOUNCEMENT"].includes(item.type)).map((target)=><button type="button" key={target.id} onClick={()=>void forwardMessage(forwardTarget,target.id)} disabled={forwardBusy}><MessageSquare size={15}/><span><strong>#{target.name}</strong><small>{target.id===channel.id?"Canal atual":"Canal de texto"}</small></span>{forwardBusy?<LoaderCircle className="spin" size={14}/>:<Forward size={14}/>}</button>)}
            {forwardChannels.filter((item)=>["TEXT","ANNOUNCEMENT"].includes(item.type)).length===0&&<div className="message-forward-empty">Nenhum canal disponível para encaminhar.</div>}
          </div>
        </section>
      </div>}

      {(threadRoot || threadLoading || threadError) && <aside className="message-thread-drawer"><header><div><MessageSquare size={18}/><span><strong>Thread</strong><small>{threadReplies.length} respostas</small></span></div><button type="button" onClick={closeThread}><X size={17}/></button></header>{threadLoading?<div className="message-thread-empty"><LoaderCircle className="spin" size={18}/> Carregando...</div>:threadRoot?<><div className="message-thread-root"><Avatar user={threadRoot.author} size="sm"/><div><strong>{threadRoot.author.displayName}</strong><div className="message-text compact-markdown"><MessageContent content={threadRoot.content} username={currentUser.username} members={members} onUserClick={onUserClick}/></div></div></div><div className="message-thread-list">{threadReplies.length?threadReplies.map(reply=><article key={reply.id}><Avatar user={reply.author} size="sm"/><div><strong>{reply.author.displayName}</strong><div className="message-text compact-markdown"><MessageContent content={reply.content} username={currentUser.username} members={members} onUserClick={onUserClick}/></div></div></article>):<div className="message-thread-empty">Ainda nao tem respostas.</div>}</div><form className="message-thread-composer" onSubmit={sendThreadReply}><textarea value={threadDraft} onChange={e=>setThreadDraft(e.target.value)} maxLength={4000} rows={2} placeholder="Responder na thread"/><button type="submit" disabled={threadSending||!threadDraft.trim()}><Send size={16}/></button></form></>:<div className="message-thread-empty">{threadError}</div>}</aside>}
      <form className="composer-wrap" onSubmit={submit}>
        {error && <div className="composer-error">{error}</div>}
        {activeUploads.length > 0 && <div className="active-uploads">
          {activeUploads.map((item) => <div className="active-upload" key={item.id}><FileIcon size={15}/><span><strong>{item.name}</strong><i><b style={{ width: `${item.progress}%` }}/></i></span><em>{item.progress}%</em></div>)}
        </div>}
        {pendingAttachments.length > 0 && (
          <div className="pending-files">
            {pendingAttachments.map((attachment) => (
              <div className="pending-file" key={attachment.id}>
                <AttachmentIcon mimeType={attachment.mimeType} />
                <span>{attachment.originalName}</span>
                <button type="button" onClick={() => void removePendingAttachment(attachment)}>×</button>
              </div>
            ))}
          </div>
        )}
        {replyTo && <div className="reply-composer"><Reply size={14}/><span>Respondendo a <strong>{replyTo.author.displayName}</strong>: {replyTo.content.slice(0,90)}</span><button type="button" onClick={()=>setReplyTo(null)}>×</button></div>}
        {commandSuggestions.length > 0 && <div className="slash-command-menu">
          <div className="slash-command-caption">Comandos disponiveis neste canal</div>
          {commandSuggestions.map((command, index) => <button type="button" className={index === commandIndex ? "active" : ""} key={`${command.applicationId}:${command.name}`} onMouseDown={(event) => event.preventDefault()} onClick={() => selectCommand(command)}>
            <span className="slash-command-icon">{command.applicationId === "__ginga__" ? <Trash2 size={17}/> : <Bot size={17}/>}</span><div><strong>/{command.name}</strong><span>{command.description}</span></div><small>{command.applicationId === "__ginga__" ? "Ginga" : command.bot?.displayName ?? "Bot"}</small>
          </button>)}
        </div>}
        {templateOpen && <div className="message-template-menu">
          <div className="slash-command-caption">Modelos de mensagem</div>
          {quickMessageTemplates.map((template) => <button type="button" key={template.id} onClick={() => insertMessageTemplate(template.body)}><FileText size={16}/><span>{template.label}</span></button>)}
        </div>}
        {mentionSuggestions.length > 0 && <div className="mention-suggestion-menu">
          <div className="slash-command-caption">Mencionar</div>
          {mentionSuggestions.map((mention, index) => <button type="button" className={index === mentionIndex ? "active" : ""} key={mention.key} onMouseDown={(event) => event.preventDefault()} onClick={() => selectMention(mention.username)}>
            {mention.everyone ? <span className="mention-everyone-icon">@</span> : <span className="mention-avatar" style={{ background: mention.color }}>{mention.label.slice(0,1).toUpperCase()}</span>}
            <div><strong>@{mention.username}</strong><span>{mention.label}</span></div>
          </button>)}
        </div>}
        {emojiOpen && <div className="emoji-picker">
          <header><div><Smile size={16}/><strong>Emojis</strong></div><button type="button" onClick={()=>setEmojiOpen(false)}><X size={15}/></button></header>
          <div className="emoji-picker-section"><span className="emoji-section-title">Padrao</span><div className="native-emoji-grid">{nativeEmojis.map((emoji)=><button type="button" key={emoji} onClick={()=>insertNativeEmoji(emoji)}>{emoji}</button>)}</div></div>
          <div className="emoji-picker-section custom-emoji-section"><div className="emoji-section-heading"><span className="emoji-section-title">Personalizados</span><small>{customEmojis.length}/10</small></div>
            {customEmojis.length > 0 ? <div className="custom-emoji-grid">{customEmojis.map((emoji)=><div className="custom-emoji-item" key={emoji.id}><button type="button" className="custom-emoji-use" onClick={()=>void insertCustomEmoji(emoji)} disabled={customEmojiBusy}><img src={emoji.dataUrl} alt={`:${emoji.name}:`}/><span>:{emoji.name}:</span></button><button type="button" className="custom-emoji-remove" aria-label="Remover emoji" onClick={()=>removeCustomEmoji(emoji)}><X size={12}/></button></div>)}</div> : <div className="emoji-empty">Adicione uma imagem. O Ginga corta e converte para 128x128 automaticamente.</div>}
            {customEmojis.length < 10 && <div className="custom-emoji-add"><input value={customEmojiName} onChange={(event)=>setCustomEmojiName(event.target.value)} maxLength={24} placeholder="nome-do-emoji"/><label className={customEmojiBusy ? "disabled" : ""}>{customEmojiBusy ? <LoaderCircle className="spin" size={14}/> : <Plus size={14}/>} Adicionar<input type="file" accept="image/png,image/jpeg,image/webp,image/gif" disabled={customEmojiBusy} onChange={chooseCustomEmoji}/></label></div>}
          </div>
        </div>}
        {channel.slowModeSeconds && channel.slowModeSeconds > 0 ? <div className={`slow-mode-composer-hint ${slowModeRemaining > 0 ? "waiting" : ""}`}><Clock3 size={13}/> {slowModeRemaining > 0 && !permissions.canManageMessages ? `Modo lento: aguarde ${slowModeRemaining}s para enviar novamente.` : `Modo lento: ${channel.slowModeSeconds}s entre mensagens para membros.`}</div> : null}
        <MessageFormattingToolbar textareaRef={textareaRef} value={content} onChange={setContent} active={composerFocused} />
        <div className="composer">
          <label className={`composer-attach ${uploading ? "disabled" : ""}`} aria-label="Adicionar arquivo">
            {uploading ? <LoaderCircle className="spin" size={20} /> : <Paperclip size={20} />}
            <input type="file" multiple disabled={uploading || pendingAttachments.length >= 10} onChange={chooseFiles} />
          </label>
          <textarea
            ref={textareaRef}
            value={content}
            onChange={(event) => setContent(event.target.value)}
            onFocus={() => setComposerFocused(true)}
            onBlur={() => setComposerFocused(false)}
            onKeyDown={onKeyDown}
            onPaste={onPaste}
            placeholder={channel.type === "ANNOUNCEMENT" ? `Publicar anúncio em #${channel.name}` : `Mensagem em ${channel.name}`}
            rows={1}
            maxLength={4000}
          />
          <button className={`composer-emoji ${emojiOpen ? "active" : ""}`} type="button" onClick={() => { setEmojiOpen((value) => !value); setTemplateOpen(false); }} aria-label="Emojis"><Smile size={19}/></button>
          <button className={`composer-template ${templateOpen ? "active" : ""}`} type="button" onClick={() => { setTemplateOpen((value) => !value); setEmojiOpen(false); }} aria-label="Modelos de mensagem"><FileText size={18}/></button>
          {permissions.canScheduleMessages && <button className="composer-schedule" type="button" onClick={()=>void scheduleCurrent()} disabled={!content.trim()} aria-label="Agendar mensagem"><CalendarClock size={18}/></button>}
          <VoiceMessageRecorder disabled={sending || uploading} onSendFile={sendVoiceMessage} />
          <button className="send-button" type="submit" disabled={sending || (slowModeRemaining > 0 && !permissions.canManageMessages) || (!content.trim() && pendingAttachments.length === 0)} aria-label="Enviar mensagem">
            {sending ? <LoaderCircle className="spin" size={19} /> : <Send size={19} />}
          </button>
        </div>
      </form>
      {mediaViewer && <MediaViewer attachment={mediaViewer} onClose={() => setMediaViewer(null)} />}
    </section>
  );
}
