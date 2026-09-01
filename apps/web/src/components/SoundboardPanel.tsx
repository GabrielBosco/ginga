import { useEffect, useMemo, useRef, useState } from "react";
import { LoaderCircle, Music2, Play, Plus, Scissors, Search, Star, Trash2, Upload, Volume2, X } from "lucide-react";
import type { Socket } from "socket.io-client";
import { api } from "../lib/api";
import { gingaConfirm } from "../lib/dialogs";
import {
  formatSoundDuration,
  loadSoundboardFavorites,
  loadSoundboardVolume,
  readSoundDurationMs,
  saveSoundboardFavorites,
  saveSoundboardVolume,
  soundboardMimeForFile,
  type SoundboardListResponse,
  type SoundboardPlayedEvent,
  type SoundboardSound
} from "../lib/soundboard";

interface SoundboardPanelProps {
  guildId: string;
  channelId: string;
  socket?: Socket;
  canManage?: boolean;
  onClose: () => void;
}

type PendingUpload = {
  file: File;
  name: string;
  emoji: string;
  sourceDurationMs: number;
  trimStartMs: number;
  trimEndMs: number;
  mimeType: string;
};

function safeBaseName(fileName: string) {
  return fileName.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 40) || "Novo som";
}

function playAck(socket: Socket, channelId: string, soundId: string) {
  return new Promise<{ ok: boolean; error?: string }>((resolve) => {
    const timer = window.setTimeout(() => resolve({ ok: false, error: "O servidor demorou para responder" }), 5000);
    socket.emit("voice:soundboard-play", { channelId, soundId }, (response: { ok?: boolean; error?: string } | undefined) => {
      window.clearTimeout(timer);
      resolve({ ok: Boolean(response?.ok), error: response?.error });
    });
  });
}

export function SoundboardPanel({ guildId, channelId, socket, canManage = false, onClose }: SoundboardPanelProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const playingTimerRef = useRef<number | null>(null);
  const previewAudioRef = useRef<HTMLAudioElement | null>(null);
  const previewUrlRef = useRef("");
  const previewTimerRef = useRef<number | null>(null);
  const [sounds, setSounds] = useState<SoundboardSound[]>([]);
  const [limits, setLimits] = useState({ maxSounds: 48, maxBytes: 2 * 1024 * 1024, maxDurationMs: 12_000, maxSourceDurationMs: 300_000 });
  const [query, setQuery] = useState("");
  const [volume, setVolume] = useState(loadSoundboardVolume);
  const [favorites, setFavorites] = useState<Set<string>>(() => loadSoundboardFavorites(guildId));
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [playingId, setPlayingId] = useState("");
  const [pendingUpload, setPendingUpload] = useState<PendingUpload | null>(null);
  const [uploading, setUploading] = useState(false);
  const [removingId, setRemovingId] = useState("");

  const load = async (quiet = false) => {
    if (!quiet) setLoading(true);
    try {
      const response = await api<SoundboardListResponse>(`/api/guilds/${encodeURIComponent(guildId)}/soundboard`);
      setSounds(response.sounds || []);
      if (response.limits) setLimits((current) => ({ ...current, ...response.limits, maxSourceDurationMs: response.limits.maxSourceDurationMs ?? current.maxSourceDurationMs }));
      setError("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Nao foi possivel carregar os sons");
    } finally {
      if (!quiet) setLoading(false);
    }
  };

  useEffect(() => { void load(); }, [guildId]);

  useEffect(() => () => { stopPreview(); }, []);

  useEffect(() => {
    setFavorites(loadSoundboardFavorites(guildId));
  }, [guildId]);

  useEffect(() => {
    if (!socket) return;
    const changed = (payload: { guildId?: string }) => { if (payload?.guildId === guildId) void load(true); };
    socket.on("soundboard:changed", changed);
    return () => { socket.off("soundboard:changed", changed); };
  }, [socket, guildId]);

  useEffect(() => {
    const onPlayed = (event: Event) => {
      const detail = (event as CustomEvent<SoundboardPlayedEvent>).detail;
      if (!detail || detail.channelId !== channelId) return;
      setPlayingId(detail.sound.id);
      if (playingTimerRef.current) window.clearTimeout(playingTimerRef.current);
      const visibleFor = Math.min(12_000, Math.max(700, Number(detail.sound.durationMs || 1200)));
      playingTimerRef.current = window.setTimeout(() => {
        setPlayingId((current) => current === detail.sound.id ? "" : current);
        playingTimerRef.current = null;
      }, visibleFor);
    };
    window.addEventListener("ginga:soundboard-played", onPlayed as EventListener);
    return () => {
      window.removeEventListener("ginga:soundboard-played", onPlayed as EventListener);
      if (playingTimerRef.current) window.clearTimeout(playingTimerRef.current);
      playingTimerRef.current = null;
    };
  }, [channelId]);

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as HTMLElement | null;
      if (rootRef.current?.contains(target)) return;
      if (target?.closest?.(".soundboard-trigger")) return;
      onClose();
    };
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown, true);
    };
  }, [onClose]);

  const visible = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase("pt-BR");
    return normalized ? sounds.filter((sound) => sound.name.toLocaleLowerCase("pt-BR").includes(normalized)) : sounds;
  }, [sounds, query]);

  const favoriteSounds = visible.filter((sound) => favorites.has(sound.id));
  const regularSounds = visible.filter((sound) => !favorites.has(sound.id));

  const toggleFavorite = (soundId: string) => {
    const next = new Set(favorites);
    if (next.has(soundId)) next.delete(soundId); else next.add(soundId);
    setFavorites(next);
    saveSoundboardFavorites(guildId, next);
  };

  const play = async (sound: SoundboardSound) => {
    if (!socket?.connected) {
      setError("A conexao em tempo real nao esta pronta. Aguarde a sala reconectar.");
      return;
    }
    // Executado diretamente no clique do usuario para liberar a saida de audio
    // antes do evento sincronizado chegar pelo Socket.IO.
    try { await window.__gingaVoiceSession?.room.startAudio(); } catch {}
    setPlayingId(sound.id);
    const result = await playAck(socket, channelId, sound.id);
    if (!result.ok) {
      setError(result.error || "Nao foi possivel tocar este som");
      setPlayingId("");
    } else {
      setError("");
      // O evento real de playback, disparado pelo PersistentVoiceAudio, mantem
      // a animacao durante a duracao do clip. Este timeout cobre apenas o
      // pequeno intervalo de sincronizacao/preload.
      window.setTimeout(() => setPlayingId((current) => current === sound.id ? "" : current), 900);
    }
  };

  function stopPreview() {
    if (previewTimerRef.current !== null) window.clearTimeout(previewTimerRef.current);
    previewTimerRef.current = null;
    if (previewAudioRef.current) {
      try { previewAudioRef.current.pause(); } catch {}
      previewAudioRef.current.removeAttribute("src");
    }
    previewAudioRef.current = null;
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    previewUrlRef.current = "";
  }

  async function previewPendingSound() {
    if (!pendingUpload) return;
    stopPreview();
    const url = URL.createObjectURL(pendingUpload.file);
    const audio = new Audio(url);
    previewUrlRef.current = url;
    previewAudioRef.current = audio;
    audio.preload = "auto";
    audio.volume = Math.max(0, Math.min(1, volume / 100));
    const startSeconds = pendingUpload.trimStartMs / 1000;
    const durationMs = Math.max(250, pendingUpload.trimEndMs - pendingUpload.trimStartMs);
    const start = async () => {
      try {
        audio.currentTime = startSeconds;
        await audio.play();
        previewTimerRef.current = window.setTimeout(stopPreview, durationMs);
      } catch {
        stopPreview();
        setError("O navegador bloqueou a pre-escuta deste som.");
      }
    };
    if (audio.readyState >= 1) await start();
    else audio.addEventListener("loadedmetadata", () => { void start(); }, { once: true });
    audio.addEventListener("ended", stopPreview, { once: true });
    audio.addEventListener("error", stopPreview, { once: true });
    try { audio.load(); } catch {}
  }

  const updateTrimStart = (value: number) => {
    if (!pendingUpload) return;
    const source = pendingUpload.sourceDurationMs;
    const start = Math.max(0, Math.min(source - 250, Math.round(value)));
    let end = pendingUpload.trimEndMs;
    if (end <= start + 250 || end - start > limits.maxDurationMs) end = Math.min(source, start + limits.maxDurationMs);
    if (end <= start) end = source;
    stopPreview();
    setPendingUpload({ ...pendingUpload, trimStartMs: start, trimEndMs: end });
  };

  const updateTrimEnd = (value: number) => {
    if (!pendingUpload) return;
    const minEnd = pendingUpload.trimStartMs + 250;
    const maxEnd = Math.min(pendingUpload.sourceDurationMs, pendingUpload.trimStartMs + limits.maxDurationMs);
    const end = Math.max(minEnd, Math.min(maxEnd, Math.round(value)));
    stopPreview();
    setPendingUpload({ ...pendingUpload, trimEndMs: end });
  };

  const chooseFile = async (file: File | undefined) => {
    if (!file) return;
    setError("");
    const mimeType = soundboardMimeForFile(file);
    if (!mimeType) {
      setError("Use MP3, WAV, OGG, WebM, M4A ou AAC.");
      return;
    }
    if (file.size > limits.maxBytes) {
      setError(`O arquivo pode ter no maximo ${Math.round(limits.maxBytes / 1024 / 1024)} MB.`);
      return;
    }
    try {
      const sourceDurationMs = await readSoundDurationMs(file);
      if (sourceDurationMs > (limits.maxSourceDurationMs || 300_000)) {
        setError(`O arquivo de origem pode ter no maximo ${Math.round((limits.maxSourceDurationMs || 300_000) / 60_000)} minutos.`);
        return;
      }
      if (sourceDurationMs < 250) {
        setError("O audio precisa ter pelo menos 0,25 segundo.");
        return;
      }
      const trimStartMs = 0;
      const trimEndMs = Math.min(sourceDurationMs, limits.maxDurationMs);
      stopPreview();
      setPendingUpload({ file, name: safeBaseName(file.name), emoji: "🔊", sourceDurationMs, trimStartMs, trimEndMs, mimeType });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Nao foi possivel validar este audio");
    } finally {
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const upload = async () => {
    if (!pendingUpload || uploading) return;
    const name = pendingUpload.name.trim();
    if (!name) return setError("Informe um nome para o som.");
    setUploading(true);
    setError("");
    try {
      const params = new URLSearchParams({
        name,
        emoji: pendingUpload.emoji.trim() || "🔊",
        durationMs: String(pendingUpload.trimEndMs - pendingUpload.trimStartMs),
        sourceDurationMs: String(pendingUpload.sourceDurationMs),
        trimStartMs: String(pendingUpload.trimStartMs),
        trimEndMs: String(pendingUpload.trimEndMs)
      });
      await api(`/api/guilds/${encodeURIComponent(guildId)}/soundboard?${params.toString()}`, {
        method: "POST",
        headers: { "Content-Type": pendingUpload.mimeType },
        body: pendingUpload.file
      });
      stopPreview();
      setPendingUpload(null);
      await load(true);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Nao foi possivel adicionar o som");
    } finally {
      setUploading(false);
    }
  };

  const remove = async (sound: SoundboardSound) => {
    const confirmed = await gingaConfirm(`Remover o som “${sound.name}” deste servidor?`, {
      title: "Remover som",
      confirmLabel: "Remover",
      tone: "danger"
    });
    if (!confirmed) return;
    setRemovingId(sound.id);
    setError("");
    try {
      await api(`/api/guilds/${encodeURIComponent(guildId)}/soundboard/${encodeURIComponent(sound.id)}`, { method: "DELETE" });
      setSounds((current) => current.filter((item) => item.id !== sound.id));
      if (favorites.has(sound.id)) toggleFavorite(sound.id);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Nao foi possivel remover o som");
    } finally {
      setRemovingId("");
    }
  };

  const renderGrid = (items: SoundboardSound[]) => (
    <div className="soundboard-grid">
      {items.map((sound) => (
        <div className={`soundboard-sound ${playingId === sound.id ? "playing" : ""}`} key={sound.id}>
          <button type="button" className="soundboard-play" onClick={() => void play(sound)} title={`Tocar ${sound.name} para a sala`}>
            <span className="soundboard-emoji">{sound.emoji || "🔊"}</span>
            <span className="soundboard-sound-copy"><strong>{sound.name}</strong><small>{formatSoundDuration(sound.durationMs) || "som"}</small></span>
            {playingId === sound.id && <span className="soundboard-playing-bars" aria-hidden="true"><i/><i/><i/></span>}
          </button>
          <button type="button" className={`soundboard-favorite ${favorites.has(sound.id) ? "active" : ""}`} onClick={() => toggleFavorite(sound.id)} aria-label={favorites.has(sound.id) ? "Remover dos favoritos" : "Adicionar aos favoritos"}><Star size={13}/></button>
          {canManage && <button type="button" className="soundboard-remove" disabled={removingId === sound.id} onClick={() => void remove(sound)} aria-label={`Remover ${sound.name}`}>{removingId === sound.id ? <LoaderCircle size={13} className="spin"/> : <Trash2 size={13}/>}</button>}
        </div>
      ))}
    </div>
  );

  return (
    <div className="soundboard-panel" ref={rootRef} role="dialog" aria-label="Painel de sons">
      <header className="soundboard-header">
        <div><span className="soundboard-kicker">SOUNDBOARD</span><strong>Sons</strong></div>
        <div className="soundboard-header-actions">
          {canManage && <button type="button" className="soundboard-add" disabled={sounds.length >= limits.maxSounds} onClick={() => fileRef.current?.click()} title={sounds.length >= limits.maxSounds ? "Limite de sons atingido" : "Adicionar som"}><Plus size={16}/></button>}
          <button type="button" className="soundboard-close" onClick={onClose} aria-label="Fechar painel de sons"><X size={16}/></button>
        </div>
      </header>

      <div className="soundboard-search"><Search size={15}/><input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Pesquisar sons"/></div>

      <label className="soundboard-volume">
        <span><Volume2 size={15}/><strong>Volume dos sons</strong></span>
        <input type="range" min={0} max={100} value={volume} onChange={(event) => { const next = saveSoundboardVolume(Number(event.target.value)); setVolume(next); }}/>
        <output>{volume}%</output>
      </label>

      <input ref={fileRef} hidden type="file" accept=".mp3,.wav,.ogg,.oga,.webm,.m4a,.aac,audio/mpeg,audio/wav,audio/ogg,audio/webm,audio/mp4,audio/aac" onChange={(event) => void chooseFile(event.target.files?.[0])}/>

      {pendingUpload && <div className="soundboard-upload-card">
        <div className="soundboard-upload-title"><Upload size={15}/><div><strong>Novo som</strong><span>{pendingUpload.file.name} · origem {formatSoundDuration(pendingUpload.sourceDurationMs)}</span></div></div>
        <div className="soundboard-upload-fields">
          <input className="soundboard-emoji-input" maxLength={16} value={pendingUpload.emoji} onChange={(event) => setPendingUpload({ ...pendingUpload, emoji: event.target.value })} aria-label="Emoji do som"/>
          <input maxLength={40} value={pendingUpload.name} onChange={(event) => setPendingUpload({ ...pendingUpload, name: event.target.value })} placeholder="Nome do som"/>
        </div>
        <div className="soundboard-trimmer">
          <div className="soundboard-trimmer-head"><span><Scissors size={14}/><strong>Corte do audio</strong></span><em>{formatSoundDuration(pendingUpload.trimStartMs)} - {formatSoundDuration(pendingUpload.trimEndMs)} · {formatSoundDuration(pendingUpload.trimEndMs - pendingUpload.trimStartMs)}</em></div>
          <div className="soundboard-trim-track" aria-hidden="true"><span style={{ left: `${(pendingUpload.trimStartMs / pendingUpload.sourceDurationMs) * 100}%`, width: `${((pendingUpload.trimEndMs - pendingUpload.trimStartMs) / pendingUpload.sourceDurationMs) * 100}%` }}/></div>
          <div className="soundboard-trim-controls">
            <label>Inicio<input type="range" min={0} max={Math.max(0, pendingUpload.sourceDurationMs - 250)} step={50} value={pendingUpload.trimStartMs} onChange={(event) => updateTrimStart(Number(event.target.value))}/><output>{formatSoundDuration(pendingUpload.trimStartMs)}</output></label>
            <label>Fim<input type="range" min={pendingUpload.trimStartMs + 250} max={Math.min(pendingUpload.sourceDurationMs, pendingUpload.trimStartMs + limits.maxDurationMs)} step={50} value={pendingUpload.trimEndMs} onChange={(event) => updateTrimEnd(Number(event.target.value))}/><output>{formatSoundDuration(pendingUpload.trimEndMs)}</output></label>
          </div>
          <button type="button" className="soundboard-preview-button" onClick={() => void previewPendingSound()}><Play size={13}/> Ouvir trecho</button>
        </div>
        <div className="soundboard-upload-actions"><button type="button" className="secondary-button" disabled={uploading} onClick={() => { stopPreview(); setPendingUpload(null); }}>Cancelar</button><button type="button" className="primary-button" disabled={uploading || !pendingUpload.name.trim()} onClick={() => void upload()}>{uploading ? <LoaderCircle size={14} className="spin"/> : <Upload size={14}/>} {uploading ? "Enviando" : "Adicionar"}</button></div>
      </div>}

      {error && <div className="soundboard-error">{error}</div>}

      <div className="soundboard-content">
        {loading ? <div className="soundboard-state"><LoaderCircle className="spin"/><span>Carregando sons...</span></div> : sounds.length === 0 ? <div className="soundboard-state"><Music2/><strong>Nenhum som ainda</strong><span>{canManage ? "Adicione o primeiro som do servidor." : "Um administrador pode adicionar sons para esta comunidade."}</span>{canManage && <button type="button" className="secondary-button" onClick={() => fileRef.current?.click()}><Plus size={14}/> Adicionar som</button>}</div> : visible.length === 0 ? <div className="soundboard-state compact"><Search/><span>Nenhum som encontrado.</span></div> : <>
          {favoriteSounds.length > 0 && <section className="soundboard-section"><div className="soundboard-section-title"><Star size={13}/><span>Favoritos</span></div>{renderGrid(favoriteSounds)}</section>}
          {regularSounds.length > 0 && <section className="soundboard-section"><div className="soundboard-section-title"><Music2 size={13}/><span>{favoriteSounds.length ? "Sons do servidor" : "Todos os sons"}</span><em>{sounds.length}/{limits.maxSounds}</em></div>{renderGrid(regularSounds)}</section>}
        </>}
      </div>

      <footer className="soundboard-footer"><span>Som sincronizado com todos na sala</span><span>{Math.round(limits.maxDurationMs / 1000)}s max.</span></footer>
    </div>
  );
}
