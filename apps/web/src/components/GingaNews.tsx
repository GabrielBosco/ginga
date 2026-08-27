import { useCallback, useEffect, useMemo, useState } from "react";
import {
  BellRing,
  CheckCheck,
  CircleAlert,
  CircleCheckBig,
  Info,
  LoaderCircle,
  Megaphone,
  RefreshCw,
  Rocket,
  ShieldAlert
} from "lucide-react";
import { api } from "../lib/api";
import type { PlatformAnnouncement } from "../types";

interface NewsSocket {
  on?: (event: string, listener: (payload: PlatformAnnouncement) => void) => void;
  off?: (event: string, listener: (payload: PlatformAnnouncement) => void) => void;
}

interface GingaNewsProps {
  socket?: NewsSocket;
}

type NewsFilter = "ALL" | "UPDATE" | "INFO" | "WARNING" | "CRITICAL";

const READ_STORAGE_KEY = "ginga.news.read.v1";

const severityMeta: Record<string, { label: string; icon: typeof Info }> = {
  UPDATE: { label: "Atualização", icon: Rocket },
  INFO: { label: "Informação", icon: Info },
  SUCCESS: { label: "Concluído", icon: CircleCheckBig },
  WARNING: { label: "Atenção", icon: CircleAlert },
  CRITICAL: { label: "Importante", icon: ShieldAlert }
};

function loadReadIds() {
  try {
    const parsed = JSON.parse(localStorage.getItem(READ_STORAGE_KEY) || "[]") as unknown;
    return new Set(Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : []);
  } catch {
    return new Set<string>();
  }
}

function saveReadIds(ids: Set<string>) {
  try { localStorage.setItem(READ_STORAGE_KEY, JSON.stringify(Array.from(ids).slice(-500))); } catch { /* Preferência local opcional. */ }
}

function relativeDate(value: string) {
  const date = new Date(value);
  const delta = Date.now() - date.getTime();
  const minutes = Math.floor(delta / 60_000);
  if (minutes < 1) return "agora";
  if (minutes < 60) return `há ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `há ${hours} h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `há ${days} d`;
  return new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "short", year: date.getFullYear() !== new Date().getFullYear() ? "numeric" : undefined }).format(date);
}

export function GingaNews({ socket }: GingaNewsProps) {
  const [items, setItems] = useState<PlatformAnnouncement[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState<NewsFilter>("ALL");
  const [readIds, setReadIds] = useState<Set<string>>(() => loadReadIds());
  const [expandedId, setExpandedId] = useState("");

  const load = useCallback(async (quiet = false) => {
    if (quiet) setRefreshing(true); else setLoading(true);
    setError("");
    try {
      const result = await api<{ announcements: PlatformAnnouncement[] }>("/api/platform/announcements");
      setItems(result.announcements);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Falha ao carregar as novidades do Ginga");
    } finally {
      if (quiet) setRefreshing(false); else setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    const onAnnouncement = (announcement: PlatformAnnouncement) => {
      if (!announcement?.published) return;
      setItems((current) => [announcement, ...current.filter((item) => item.id !== announcement.id)]);
    };
    socket?.on?.("platform:announcement", onAnnouncement);
    return () => socket?.off?.("platform:announcement", onAnnouncement);
  }, [socket]);

  const unreadCount = useMemo(() => items.filter((item) => !readIds.has(item.id)).length, [items, readIds]);
  const updateCount = useMemo(() => items.filter((item) => item.severity.toUpperCase() === "UPDATE").length, [items]);
  const filteredItems = useMemo(() => filter === "ALL" ? items : items.filter((item) => item.severity.toUpperCase() === filter), [filter, items]);

  function markRead(id: string) {
    setReadIds((current) => {
      if (current.has(id)) return current;
      const next = new Set(current);
      next.add(id);
      saveReadIds(next);
      return next;
    });
  }

  function markAllRead() {
    const next = new Set(readIds);
    items.forEach((item) => next.add(item.id));
    saveReadIds(next);
    setReadIds(next);
  }

  function toggleItem(item: PlatformAnnouncement) {
    markRead(item.id);
    setExpandedId((current) => current === item.id ? "" : item.id);
  }

  return (
    <section className="feature-view news-view ginga-news-view">
      <header className="content-header news-content-header">
        <div className="channel-title"><Megaphone size={20}/><strong>Novidades do Ginga</strong></div>
        <span className="channel-topic">Atualizações, manutenção e avisos importantes da plataforma</span>
        <div className="news-header-actions">
          {unreadCount > 0 && <button type="button" className="news-mark-read" onClick={markAllRead}><CheckCheck size={16}/> Marcar tudo como lido</button>}
          <button type="button" className="icon-button" onClick={() => void load(true)} aria-label="Atualizar novidades" title="Atualizar novidades"><RefreshCw size={17} className={refreshing ? "spin" : ""}/></button>
        </div>
      </header>

      <div className="feature-scroll news-scroll">
        <section className="news-hero-v2">
          <div className="news-hero-icon"><BellRing size={28}/></div>
          <div className="news-hero-copy">
            <span className="eyebrow">CENTRAL GINGA</span>
            <h1>O que mudou por aqui?</h1>
            <p>Releases, melhorias, manutenções e avisos oficiais em um lugar só. Novidades ficam em destaque até você abrir.</p>
          </div>
          <div className="news-hero-stats">
            <div><strong>{unreadCount}</strong><span>não lida{unreadCount === 1 ? "" : "s"}</span></div>
            <div><strong>{updateCount}</strong><span>release{updateCount === 1 ? "" : "s"}</span></div>
            <div><strong>{items.length}</strong><span>publicações</span></div>
          </div>
        </section>

        <div className="news-toolbar-v2">
          <div className="news-filter-chips" role="tablist" aria-label="Filtrar novidades">
            {(["ALL", "UPDATE", "INFO", "WARNING", "CRITICAL"] as NewsFilter[]).map((value) => {
              const labels: Record<NewsFilter, string> = { ALL: "Tudo", UPDATE: "Atualizações", INFO: "Informações", WARNING: "Atenção", CRITICAL: "Importante" };
              return <button type="button" role="tab" aria-selected={filter === value} className={filter === value ? "active" : ""} key={value} onClick={() => setFilter(value)}>{labels[value]}</button>;
            })}
          </div>
          <span>{filteredItems.length} item{filteredItems.length === 1 ? "" : "s"}</span>
        </div>

        {loading && <div className="center-state"><LoaderCircle className="spin"/> Carregando novidades...</div>}
        {error && <div className="inline-alert danger">{error}</div>}
        {!loading && filteredItems.length === 0 && (
          <div className="news-empty-v2"><Megaphone size={26}/><strong>Nada por aqui ainda</strong><span>Quando houver uma novidade nessa categoria, ela aparece aqui.</span></div>
        )}

        <div className="news-feed-v2">
          {filteredItems.map((item) => {
            const severity = item.severity.toUpperCase();
            const meta = severityMeta[severity] ?? severityMeta.INFO;
            const Icon = meta.icon;
            const unread = !readIds.has(item.id);
            const expanded = expandedId === item.id;
            return (
              <article className={`news-item-v2 severity-${severity.toLowerCase()} ${unread ? "unread" : "read"} ${expanded ? "expanded" : ""}`} key={item.id}>
                <button type="button" className="news-item-main" onClick={() => toggleItem(item)}>
                  <span className="news-severity-icon"><Icon size={19}/></span>
                  <span className="news-item-copy">
                    <span className="news-item-meta"><b>{meta.label}</b><time title={new Date(item.createdAt).toLocaleString("pt-BR")}>{relativeDate(item.createdAt)}</time>{unread && <em>NOVO</em>}</span>
                    <strong>{item.title}</strong>
                    <span className="news-item-preview">{item.body}</span>
                  </span>
                  <span className="news-item-action">{expanded ? "Recolher" : unread ? "Ler novidade" : "Ver detalhes"}</span>
                </button>
                {expanded && (
                  <div className="news-item-details">
                    <p>{item.body}</p>
                    <footer>
                      <span>{item.createdBy?.displayName ? `Publicado por ${item.createdBy.displayName}` : "Equipe Ginga"}</span>
                      <time>{new Date(item.createdAt).toLocaleString("pt-BR")}</time>
                    </footer>
                  </div>
                )}
              </article>
            );
          })}
        </div>
      </div>
    </section>
  );
}
