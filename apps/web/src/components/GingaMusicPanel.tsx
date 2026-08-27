import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import {
  ExternalLink,
  ListMusic,
  LoaderCircle,
  Music2,
  Pause,
  Play,
  Plus,
  Repeat2,
  Search,
  Shuffle,
  SkipBack,
  SkipForward,
  Trash2,
  Volume1,
  VolumeX,
  X
} from "lucide-react";
import type { Socket } from "socket.io-client";
import { api } from "../lib/api";
import {
  loadMusicUserPreferences,
  MUSIC_PREFERENCES_EVENT,
  saveMusicUserPreferences,
  type MusicUserPreferences
} from "../lib/musicPreferences";
import type { Channel, MusicPayload, MusicProvider, MusicSearchResult, MusicState } from "../types";

interface GingaMusicPanelProps {
  guildId: string;
  userId: string;
  channel: Channel;
  voiceChannels: Channel[];
  socket?: Socket;
}

function formatDuration(seconds: number | null | undefined) {
  if (!seconds || seconds <= 0) return "--:--";
  const total = Math.floor(seconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const rest = total % 60;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(rest).padStart(2, "0")}`
    : `${minutes}:${String(rest).padStart(2, "0")}`;
}

function providerLabel(provider: MusicProvider) {
  return provider === "YOUTUBE" ? "YouTube" : "SoundCloud";
}

export function GingaMusicPanel({ guildId, userId, channel, voiceChannels, socket }: GingaMusicPanelProps) {
  const [payload, setPayload] = useState<MusicPayload | null>(null);
  const [input, setInput] = useState("");
  const [youtubeSearch, setYoutubeSearch] = useState("");
  const [soundcloudSearch, setSoundcloudSearch] = useState("");
  const [resultProvider, setResultProvider] = useState<MusicProvider | null>(null);
  const [results, setResults] = useState<MusicSearchResult[]>([]);
  const [preferences, setPreferences] = useState<MusicUserPreferences>({ volume: 70, muted: false });
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [searchingProvider, setSearchingProvider] = useState<MusicProvider | null>(null);
  const [error, setError] = useState("");
  const [engineError, setEngineError] = useState("");
  const [expanded, setExpanded] = useState(true);

  const acceptState = useCallback((state: MusicState) => {
    setPayload((current) => current ? { ...current, state } : current);
  }, []);

  const load = useCallback(async () => {
    if (!guildId) return;
    try {
      const next = await api<MusicPayload>(`/api/guilds/${guildId}/music`);
      setPayload(next);
      setPreferences(loadMusicUserPreferences(userId, guildId, next.settings.defaultVolume));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Nao foi possivel carregar o Ginga Music");
    }
  }, [guildId, userId]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (!socket) return;
    const onMusic = (state: MusicState) => { if (state.guildId === guildId) acceptState(state); };
    const onSettings = (event: { guildId: string; settings: MusicPayload["settings"] }) => {
      if (event.guildId !== guildId) return;
      setPayload((current) => current ? { ...current, settings: event.settings } : current);
      setPreferences(loadMusicUserPreferences(userId, guildId, event.settings.defaultVolume));
      if (!event.settings.enabled) setResults([]);
    };
    socket.on("music:state", onMusic);
    socket.on("music:settings", onSettings);
    return () => { socket.off("music:state", onMusic); socket.off("music:settings", onSettings); };
  }, [acceptState, guildId, socket, userId]);

  useEffect(() => {
    const onPreferences = (event: Event) => {
      const detail = (event as CustomEvent<{ userId?: string; guildId?: string; preferences?: MusicUserPreferences }>).detail;
      if (detail?.userId !== userId || detail?.guildId !== guildId || !detail.preferences) return;
      setPreferences(detail.preferences);
    };
    window.addEventListener(MUSIC_PREFERENCES_EVENT, onPreferences as EventListener);
    return () => window.removeEventListener(MUSIC_PREFERENCES_EVENT, onPreferences as EventListener);
  }, [guildId, userId]);

  useEffect(() => {
    const onEngineError = (event: Event) => {
      const detail = (event as CustomEvent<{ message?: string }>).detail;
      setEngineError(detail?.message || "O provedor recusou a reproducao desta faixa.");
    };
    window.addEventListener("ginga:music-engine-error", onEngineError as EventListener);
    return () => window.removeEventListener("ginga:music-engine-error", onEngineError as EventListener);
  }, []);

  const state = payload?.state;
  const current = state?.current ?? null;
  const activeHere = state?.channelId === channel.id;
  const activeChannelName = useMemo(() => {
    if (!state?.channelId) return "";
    return voiceChannels.find((item) => item.id === state.channelId)?.name ?? "outra sala";
  }, [state?.channelId, voiceChannels]);

  function updateLocalSound(next: Partial<MusicUserPreferences>) {
    const saved = saveMusicUserPreferences(userId, guildId, next, payload?.settings.defaultVolume ?? 70);
    setPreferences(saved);
  }

  function beginBusy() {
    if (busyRef.current) return false;
    busyRef.current = true;
    setBusy(true);
    return true;
  }

  function endBusy() {
    busyRef.current = false;
    setBusy(false);
  }

  async function joinCurrentChannel() {
    const result = await api<{ state: MusicState }>(`/api/guilds/${guildId}/music/join`, {
      method: "POST",
      body: JSON.stringify({ channelId: channel.id })
    });
    acceptState(result.state);
    return result.state;
  }

  async function addUrl(rawInput = input) {
    const value = rawInput.trim();
    if (!value || !beginBusy()) return;
    setError(""); setEngineError("");
    try {
      if (!activeHere) await joinCurrentChannel();
      const result = await api<{ state: MusicState }>(`/api/guilds/${guildId}/music/queue`, {
        method: "POST",
        body: JSON.stringify({ input: value })
      });
      acceptState(result.state);
      setInput("");
      if (rawInput !== input) setResults([]);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Nao foi possivel adicionar esta musica");
    } finally { endBusy(); }
  }

  async function submitUrl(event: FormEvent) {
    event.preventDefault();
    await addUrl();
  }

  async function control(action: "PLAY" | "PAUSE" | "SKIP" | "PREVIOUS" | "STOP" | "CLEAR" | "SHUFFLE" | "REPEAT", extra: Record<string, unknown> = {}) {
    if (!beginBusy()) return;
    setError("");
    try {
      const result = await api<{ state: MusicState }>(`/api/guilds/${guildId}/music/control`, {
        method: "POST",
        body: JSON.stringify({ action, ...extra })
      });
      acceptState(result.state);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Nao foi possivel controlar a reproducao");
    } finally { endBusy(); }
  }

  async function removeTrack(trackId: string) {
    if (!beginBusy()) return;
    setError("");
    try {
      const result = await api<{ state: MusicState }>(`/api/guilds/${guildId}/music/queue/${trackId}`, { method: "DELETE" });
      acceptState(result.state);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Nao foi possivel remover a faixa");
    } finally { endBusy(); }
  }

  async function runSearch(provider: MusicProvider, event: FormEvent) {
    event.preventDefault();
    const query = (provider === "YOUTUBE" ? youtubeSearch : soundcloudSearch).trim();
    const enabled = provider === "YOUTUBE" ? payload?.settings.youtubeSearchEnabled : payload?.settings.soundcloudSearchEnabled;
    if (!query || !enabled || searchingProvider) return;
    setSearchingProvider(provider); setError(""); setResultProvider(provider);
    try {
      const response = await api<{ results: MusicSearchResult[] }>(`/api/guilds/${guildId}/music/search?provider=${provider}&q=${encodeURIComponent(query)}&limit=8`);
      setResults(response.results);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : `Nao foi possivel pesquisar no ${providerLabel(provider)}`);
      setResults([]);
    } finally { setSearchingProvider(null); }
  }

  if (!payload?.settings.enabled) return null;

  return (
    <section className={`ginga-music-panel ${expanded ? "expanded" : "collapsed"}`}>
      <header className="ginga-music-panel-head">
        <div className="ginga-music-brand"><span><Music2 size={18}/></span><div><strong>Ginga Music</strong><small>{activeHere ? `tocando em #${channel.name}` : state?.channelId ? `ativo em #${activeChannelName}` : "pronto para entrar nesta sala"}</small></div></div>
        <div className="ginga-music-head-actions">
          {!activeHere && <button type="button" className="music-join-button" disabled={busy} onClick={() => void joinCurrentChannel().catch((caught) => setError(caught instanceof Error ? caught.message : "Nao foi possivel mover o Ginga Music"))}><Music2 size={14}/> Trazer pra ca</button>}
          <button type="button" className="music-collapse-button" onClick={() => setExpanded((value) => !value)} aria-label={expanded ? "Recolher Ginga Music" : "Expandir Ginga Music"}><ListMusic size={16}/></button>
        </div>
      </header>

      {expanded && <div className="ginga-music-body">
        {(error || engineError) && <div className="ginga-music-error"><X size={15}/><span>{error || engineError}</span><button type="button" onClick={() => { setError(""); setEngineError(""); }}><X size={13}/></button></div>}

        <div className="ginga-music-now">
          <div className="ginga-music-cover">{current?.thumbnailUrl ? <img src={current.thumbnailUrl} alt=""/> : <Music2 size={28}/>}</div>
          <div className="ginga-music-now-copy">
            <small>{current ? providerLabel(current.provider) : "FILA VAZIA"}</small>
            <strong>{current?.title ?? "Escolha uma musica ou playlist"}</strong>
            <span>{current ? `pedido por ${current.requestedByName} · ${formatDuration(current.durationSeconds)}` : "Cole um link ou pesquise no YouTube / SoundCloud."}</span>
          </div>
          {current && <a className="ginga-music-open-provider" href={current.url} target="_blank" rel="noreferrer" aria-label="Abrir no provedor"><ExternalLink size={15}/></a>}
        </div>

        <div className="ginga-music-controls">
          <button type="button" disabled={busy || !current} onClick={() => void control("PREVIOUS")} aria-label="Anterior"><SkipBack size={18}/></button>
          <button type="button" className="primary" disabled={busy || !current} onClick={() => void control(state?.status === "PLAYING" ? "PAUSE" : "PLAY")} aria-label={state?.status === "PLAYING" ? "Pausar" : "Tocar"}>{state?.status === "PLAYING" ? <Pause size={19}/> : <Play size={19}/>}</button>
          <button type="button" disabled={busy || !current} onClick={() => void control("SKIP")} aria-label="Pular"><SkipForward size={18}/></button>
          <button type="button" className={state?.shuffle ? "active" : ""} disabled={busy || !current} onClick={() => void control("SHUFFLE")} aria-label="Embaralhar"><Shuffle size={16}/></button>
          <button type="button" className={state?.repeat !== "OFF" ? "active" : ""} disabled={busy} onClick={() => void control("REPEAT")} aria-label={`Repeticao ${state?.repeat ?? "OFF"}`}><Repeat2 size={16}/><small>{state?.repeat === "TRACK" ? "1" : state?.repeat === "QUEUE" ? "∞" : ""}</small></button>
          <div className="ginga-music-local-sound" title="Este volume afeta somente voce">
            <button type="button" className={preferences.muted ? "active" : ""} onClick={() => updateLocalSound({ muted: !preferences.muted })} aria-label={preferences.muted ? "Ativar Ginga Music para voce" : "Silenciar Ginga Music para voce"}>{preferences.muted ? <VolumeX size={16}/> : <Volume1 size={16}/>}</button>
            <label className="ginga-music-volume"><input type="range" min="0" max="100" value={preferences.muted ? 0 : preferences.volume} onChange={(event) => updateLocalSound({ volume: Number(event.target.value), muted: false })}/><span>{preferences.muted ? 0 : preferences.volume}%</span></label>
            <small>so voce</small>
          </div>
        </div>

        <form className="ginga-music-add" onSubmit={submitUrl}>
          <div><Plus size={16}/><input value={input} onChange={(event) => setInput(event.target.value)} placeholder="Cole um link de musica ou playlist do YouTube / SoundCloud" /></div>
          <button className="primary-button" disabled={busy || !input.trim()}>{busy ? <LoaderCircle className="spin" size={16}/> : <Plus size={16}/>} Adicionar</button>
        </form>

        <div className="ginga-music-search-grid">
          <form className={`ginga-music-search provider-youtube ${!payload.settings.youtubeSearchEnabled ? "disabled" : ""}`} onSubmit={(event) => void runSearch("YOUTUBE", event)}>
            <span className="music-search-provider">YT</span>
            <div><Search size={15}/><input value={youtubeSearch} onChange={(event) => setYoutubeSearch(event.target.value)} placeholder={payload.settings.youtubeSearchEnabled ? "Pesquisar no YouTube" : "YouTube: configure YOUTUBE_API_KEY"} disabled={!payload.settings.youtubeSearchEnabled}/></div>
            <button type="submit" disabled={!payload.settings.youtubeSearchEnabled || Boolean(searchingProvider) || youtubeSearch.trim().length < 2}>{searchingProvider === "YOUTUBE" ? <LoaderCircle className="spin" size={15}/> : <Search size={15}/>}</button>
          </form>
          <form className={`ginga-music-search provider-soundcloud ${!payload.settings.soundcloudSearchEnabled ? "disabled" : ""}`} onSubmit={(event) => void runSearch("SOUNDCLOUD", event)}>
            <span className="music-search-provider">SC</span>
            <div><Search size={15}/><input value={soundcloudSearch} onChange={(event) => setSoundcloudSearch(event.target.value)} placeholder={payload.settings.soundcloudSearchEnabled ? "Pesquisar no SoundCloud" : "SoundCloud: configure a API"} disabled={!payload.settings.soundcloudSearchEnabled}/></div>
            <button type="submit" disabled={!payload.settings.soundcloudSearchEnabled || Boolean(searchingProvider) || soundcloudSearch.trim().length < 2}>{searchingProvider === "SOUNDCLOUD" ? <LoaderCircle className="spin" size={15}/> : <Search size={15}/>}</button>
          </form>
        </div>

        {results.length > 0 && <div className="ginga-music-search-results"><div className="music-search-results-heading"><strong>Resultados no {resultProvider ? providerLabel(resultProvider) : "provedor"}</strong><button type="button" onClick={() => setResults([])}><X size={13}/> Limpar</button></div>{results.map((result) => <button type="button" key={`${result.provider}:${result.providerId}`} disabled={busy} onClick={() => void addUrl(result.url)}><span className="music-result-cover">{result.thumbnailUrl ? <img src={result.thumbnailUrl} alt=""/> : <Music2 size={18}/>}</span><span><strong>{result.title}</strong><small>{providerLabel(result.provider)} · {result.author}</small></span><Plus size={16}/></button>)}</div>}

        <div className="ginga-music-queue-head"><div><ListMusic size={16}/><strong>Fila</strong><span>{Math.max(0, (state?.queue.length ?? 0) - (current ? 1 : 0))} proxima(s)</span></div>{(state?.queue.length ?? 0) > 1 && <button type="button" disabled={busy} onClick={() => void control("CLEAR")}><Trash2 size={14}/> Limpar proximas</button>}</div>
        <div className="ginga-music-queue">
          {(state?.queue ?? []).slice(1, 13).map((track, index) => <article key={track.id}><span className="music-queue-index">{index + 1}</span><div className="music-queue-cover">{track.thumbnailUrl ? <img src={track.thumbnailUrl} alt=""/> : <Music2 size={16}/>}</div><div><strong>{track.title}</strong><small>{providerLabel(track.provider)} · {track.requestedByName}</small></div><span>{formatDuration(track.durationSeconds)}</span><button type="button" disabled={busy} onClick={() => void removeTrack(track.id)} aria-label={`Remover ${track.title}`}><X size={14}/></button></article>)}
          {(state?.queue.length ?? 0) <= 1 && <div className="ginga-music-empty">A fila esta vazia. Adicione links ou pesquise uma musica.</div>}
          {(state?.queue.length ?? 0) > 13 && <small className="ginga-music-more">+ {(state?.queue.length ?? 0) - 13} itens na fila</small>}
        </div>
      </div>}
    </section>
  );
}
