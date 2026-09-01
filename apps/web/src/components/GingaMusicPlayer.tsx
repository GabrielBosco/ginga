import { useCallback, useEffect, useRef, useState } from "react";
import type { Socket } from "socket.io-client";
import { api } from "../lib/api";
import {
  loadMusicUserPreferences,
  MUSIC_PREFERENCES_EVENT,
  type MusicUserPreferences
} from "../lib/musicPreferences";
import type { MusicPayload, MusicState, MusicTrack } from "../types";

type YTPlayer = {
  destroy: () => void;
  playVideo: () => void;
  pauseVideo: () => void;
  seekTo: (seconds: number, allowSeekAhead?: boolean) => void;
  setVolume: (volume: number) => void;
  getCurrentTime: () => number;
};

type YTNamespace = {
  Player: new (element: HTMLElement, options: Record<string, unknown>) => YTPlayer;
  PlayerState?: { ENDED?: number };
};

type SoundCloudWidget = {
  bind: (event: string, callback: () => void) => void;
  unbind?: (event: string) => void;
  play: () => void;
  pause: () => void;
  seekTo: (milliseconds: number) => void;
  setVolume: (volume: number) => void;
};

type SoundCloudWidgetFactory = ((iframe: HTMLIFrameElement) => SoundCloudWidget) & {
  Events: { READY: string; FINISH: string };
};

declare global {
  interface Window {
    YT?: YTNamespace;
    onYouTubeIframeAPIReady?: () => void;
    SC?: { Widget: SoundCloudWidgetFactory };
  }
}

let youtubeApiPromise: Promise<YTNamespace> | null = null;
let soundCloudApiPromise: Promise<SoundCloudWidgetFactory> | null = null;

function loadYouTubeApi(): Promise<YTNamespace> {
  if (window.YT?.Player) return Promise.resolve(window.YT);
  if (youtubeApiPromise) return youtubeApiPromise;
  youtubeApiPromise = new Promise<YTNamespace>((resolve, reject) => {
    const timeout = window.setTimeout(() => reject(new Error("O player do YouTube demorou demais para responder.")), 12_000);
    const previousReady = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      window.clearTimeout(timeout);
      previousReady?.();
      if (window.YT?.Player) resolve(window.YT);
      else reject(new Error("O player do YouTube nao ficou disponivel."));
    };
    const existing = document.querySelector<HTMLScriptElement>('script[data-ginga-music="youtube"]');
    if (existing) return;
    const script = document.createElement("script");
    script.src = "https://www.youtube.com/iframe_api";
    script.async = true;
    script.dataset.gingaMusic = "youtube";
    script.onerror = () => {
      window.clearTimeout(timeout);
      youtubeApiPromise = null;
      reject(new Error("Nao foi possivel carregar o player do YouTube."));
    };
    document.head.appendChild(script);
  });
  return youtubeApiPromise;
}

function loadSoundCloudApi(): Promise<SoundCloudWidgetFactory> {
  if (window.SC?.Widget) return Promise.resolve(window.SC.Widget);
  if (soundCloudApiPromise) return soundCloudApiPromise;
  soundCloudApiPromise = new Promise<SoundCloudWidgetFactory>((resolve, reject) => {
    const timeout = window.setTimeout(() => reject(new Error("O player do SoundCloud demorou demais para responder.")), 12_000);
    const existing = document.querySelector<HTMLScriptElement>('script[data-ginga-music="soundcloud"]');
    const finish = () => {
      if (!window.SC?.Widget) return;
      window.clearTimeout(timeout);
      resolve(window.SC.Widget);
    };
    if (existing) {
      existing.addEventListener("load", finish, { once: true });
      return;
    }
    const script = document.createElement("script");
    script.src = "https://w.soundcloud.com/player/api.js";
    script.async = true;
    script.dataset.gingaMusic = "soundcloud";
    script.addEventListener("load", finish, { once: true });
    script.onerror = () => {
      window.clearTimeout(timeout);
      soundCloudApiPromise = null;
      reject(new Error("Nao foi possivel carregar o player do SoundCloud."));
    };
    document.head.appendChild(script);
  });
  return soundCloudApiPromise;
}

function playbackPosition(state: MusicState) {
  const networkDelta = state.status === "PLAYING" ? Math.max(0, (Date.now() - state.serverNow) / 1000) : 0;
  return Math.max(0, state.positionSeconds + networkDelta);
}

function announceEngineError(message: string) {
  window.dispatchEvent(new CustomEvent("ginga:music-engine-error", { detail: { message } }));
}

interface GingaMusicPlayerProps {
  guildId: string;
  channelId: string;
  userId: string;
  socket?: Socket;
  deafened?: boolean;
  onState?: (state: MusicState) => void;
}

/**
 * Motor local do Ginga Music.
 *
 * O servidor e apenas control-plane: sincroniza fila/clock. O audio nunca
 * atravessa a API/LiveKit do Ginga; cada ouvinte reproduz direto do provedor.
 * Volume e mute sao preferencias individuais e nunca sao enviados aos outros.
 */
export function GingaMusicPlayer({ guildId, channelId, userId, socket, deafened = false, onState }: GingaMusicPlayerProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const stateRef = useRef<MusicState | null>(null);
  const youtubePlayerRef = useRef<YTPlayer | null>(null);
  const soundCloudWidgetRef = useRef<SoundCloudWidget | null>(null);
  const soundCloudIframeRef = useRef<HTMLIFrameElement | null>(null);
  const currentTrackIdRef = useRef("");
  const engineKindRef = useRef<MusicTrack["provider"] | "">("");
  const endedRequestRef = useRef("");
  const engineGenerationRef = useRef(0);
  const lastAppliedStatusRef = useRef("");
  const defaultVolumeRef = useRef(70);
  const localPlaybackOwnerRef = useRef(false);
  const playbackOwnerRef = useRef(false);
  const effectiveVolumeRef = useRef(70);
  const instanceIdRef = useRef(globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`);
  const [state, setState] = useState<MusicState | null>(null);
  const [localPlaybackOwner, setLocalPlaybackOwner] = useState(false);
  const [preferences, setPreferences] = useState<MusicUserPreferences>({ volume: 70, muted: false });

  const effectiveVolume = deafened || preferences.muted ? 0 : preferences.volume;
  // O audio e edge/local: cada usuario ouve direto do YouTube/SoundCloud.
  // Somente o lock local evita eco em duas abas da mesma conta.
  const playbackOwner = localPlaybackOwner;
  playbackOwnerRef.current = playbackOwner;
  effectiveVolumeRef.current = effectiveVolume;

  const setLocalOwner = useCallback((value: boolean) => {
    localPlaybackOwnerRef.current = value;
    setLocalPlaybackOwner(value);
  }, []);

  const acceptState = useCallback((next: MusicState) => {
    stateRef.current = next;
    setState(next);
    onState?.(next);
  }, [onState]);

  useEffect(() => {
    if (!guildId) {
      stateRef.current = null;
      setState(null);
      return;
    }
    let cancelled = false;
    void api<MusicPayload>(`/api/guilds/${guildId}/music`)
      .then((payload) => {
        if (cancelled) return;
        defaultVolumeRef.current = payload.settings.defaultVolume;
        setPreferences(loadMusicUserPreferences(userId, guildId, payload.settings.defaultVolume));
        acceptState(payload.state);
      })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, [acceptState, guildId, userId]);

  useEffect(() => {
    const refresh = (event?: Event) => {
      const detail = (event as CustomEvent<{ userId?: string; guildId?: string }> | undefined)?.detail;
      if (detail && (detail.userId !== userId || detail.guildId !== guildId)) return;
      setPreferences(loadMusicUserPreferences(userId, guildId, defaultVolumeRef.current));
    };
    const onStorage = () => refresh();
    window.addEventListener(MUSIC_PREFERENCES_EVENT, refresh as EventListener);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(MUSIC_PREFERENCES_EVENT, refresh as EventListener);
      window.removeEventListener("storage", onStorage);
    };
  }, [guildId, userId]);

  // Evita eco/duplicacao quando a mesma conta deixa duas abas/janelas do Ginga abertas.
  // O lock e intencionalmente local ao navegador e funciona inclusive no HTTP atual.
  useEffect(() => {
    if (!userId || !guildId) { setLocalOwner(true); return; }
    const storageKey = `ginga.music.playback-owner.${userId}.${guildId}`;
    const instanceId = instanceIdRef.current;
    const ttlMs = 6_000;
    let disposed = false;

    const parseOwner = (raw: string | null) => {
      if (!raw) return null;
      try { return JSON.parse(raw) as { id?: string; updatedAt?: number }; } catch { return null; }
    };

    const claimIfAvailable = () => {
      if (disposed) return;
      const now = Date.now();
      let current: { id?: string; updatedAt?: number } | null = null;
      try { current = parseOwner(localStorage.getItem(storageKey)); } catch { /* armazenamento opcional */ }
      const stale = !current?.id || !current.updatedAt || now - current.updatedAt > ttlMs;
      if (stale || current?.id === instanceId) {
        try { localStorage.setItem(storageKey, JSON.stringify({ id: instanceId, updatedAt: now })); } catch { /* armazenamento opcional */ }
        setLocalOwner(true);
      } else {
        setLocalOwner(false);
      }
    };

    const heartbeat = () => {
      if (disposed) return;
      if (!localPlaybackOwnerRef.current) { claimIfAvailable(); return; }
      try { localStorage.setItem(storageKey, JSON.stringify({ id: instanceId, updatedAt: Date.now() })); } catch { /* armazenamento opcional */ }
    };

    const onStorage = (event: StorageEvent) => {
      if (event.key !== storageKey) return;
      const next = parseOwner(event.newValue);
      if (next?.id && next.id !== instanceId && Date.now() - Number(next.updatedAt ?? 0) <= ttlMs) setLocalOwner(false);
      else if (!next?.id) claimIfAvailable();
    };

    claimIfAvailable();
    const timer = window.setInterval(heartbeat, 2_000);
    window.addEventListener("storage", onStorage);
    window.addEventListener("focus", claimIfAvailable);
    return () => {
      disposed = true;
      window.clearInterval(timer);
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("focus", claimIfAvailable);
      try {
        const current = parseOwner(localStorage.getItem(storageKey));
        if (current?.id === instanceId) localStorage.removeItem(storageKey);
      } catch { /* armazenamento opcional */ }
      localPlaybackOwnerRef.current = false;
    };
  }, [guildId, setLocalOwner, userId]);

  useEffect(() => {
    if (!socket) return;
    const onMusicState = (next: MusicState) => {
      if (next.guildId === guildId) acceptState(next);
    };
    socket.on("music:state", onMusicState);
    return () => { socket.off("music:state", onMusicState); };
  }, [acceptState, guildId, socket]);

  const reportEnded = useCallback((trackId: string) => {
    if (!guildId || !trackId || endedRequestRef.current === trackId || !playbackOwnerRef.current) return;
    endedRequestRef.current = trackId;
    const snapshot = stateRef.current;
    const requestedByMe = snapshot?.current?.id === trackId && snapshot.current.requestedBy === userId;
    // A API 0.4.8 agenda o fim de faixas com duracao conhecida. O callback do
    // provider e fallback: o requester tenta primeiro e os demais so depois,
    // evitando uma rajada de requests em salas grandes.
    const delayMs = requestedByMe ? 850 + Math.floor(Math.random() * 450) : 4_000 + Math.floor(Math.random() * 4_000);
    window.setTimeout(() => {
      if (stateRef.current?.current?.id !== trackId || !playbackOwnerRef.current) {
        if (endedRequestRef.current === trackId) endedRequestRef.current = "";
        return;
      }
      void api<{ state: MusicState }>(`/api/guilds/${guildId}/music/control`, {
        method: "POST",
        body: JSON.stringify({ action: "ENDED", expectedTrackId: trackId })
      }).then((result) => acceptState(result.state)).catch(() => undefined).finally(() => {
        window.setTimeout(() => {
          if (endedRequestRef.current === trackId) endedRequestRef.current = "";
        }, 1_500);
      });
    }, delayMs);
  }, [acceptState, guildId, userId]);

  const destroyEngine = useCallback(() => {
    engineGenerationRef.current += 1;
    lastAppliedStatusRef.current = "";
    const youtube = youtubePlayerRef.current;
    if (youtube) {
      try { youtube.setVolume(0); } catch { /* player externo */ }
      try { youtube.pauseVideo(); } catch { /* player externo */ }
      try { youtube.destroy(); } catch { /* player externo */ }
    }
    youtubePlayerRef.current = null;

    const widget = soundCloudWidgetRef.current;
    if (widget && window.SC?.Widget) {
      try { widget.setVolume(0); } catch { /* player externo */ }
      try { widget.pause(); } catch { /* player externo */ }
      try { widget.unbind?.(window.SC.Widget.Events.READY); } catch { /* player externo */ }
      try { widget.unbind?.(window.SC.Widget.Events.FINISH); } catch { /* player externo */ }
    }
    soundCloudWidgetRef.current = null;

    const iframe = soundCloudIframeRef.current;
    if (iframe) {
      try { iframe.src = "about:blank"; } catch { /* iframe externo */ }
      try { iframe.remove(); } catch { /* DOM */ }
    }
    soundCloudIframeRef.current = null;
    if (hostRef.current) hostRef.current.replaceChildren();
    currentTrackIdRef.current = "";
    engineKindRef.current = "";
  }, []);

  useEffect(() => destroyEngine, [destroyEngine]);

  useEffect(() => {
    const current = state?.current ?? null;
    const shouldAttach = Boolean(playbackOwner && current && guildId && channelId && state?.channelId === channelId);
    if (!shouldAttach || !current) {
      if (currentTrackIdRef.current || youtubePlayerRef.current || soundCloudIframeRef.current) destroyEngine();
      return;
    }
    if (currentTrackIdRef.current === current.id && engineKindRef.current === current.provider) return;

    destroyEngine();
    currentTrackIdRef.current = current.id;
    engineKindRef.current = current.provider;
    const generationTrackId = current.id;
    const generation = engineGenerationRef.current;

    if (current.provider === "YOUTUBE") {
      void loadYouTubeApi().then((YT) => {
        if (!hostRef.current || currentTrackIdRef.current !== generationTrackId || generation !== engineGenerationRef.current || !playbackOwnerRef.current) return;
        const mount = document.createElement("div");
        mount.className = "ginga-music-youtube-mount";
        hostRef.current.replaceChildren(mount);
        const player = new YT.Player(mount, {
          host: "https://www.youtube-nocookie.com",
          width: "200",
          height: "200",
          videoId: current.providerId,
          playerVars: {
            autoplay: 0,
            controls: 0,
            disablekb: 1,
            fs: 0,
            playsinline: 1,
            rel: 0,
            origin: window.location.origin
          },
          events: {
            onReady: () => {
              const latest = stateRef.current;
              if (!latest || latest.current?.id !== generationTrackId || generation !== engineGenerationRef.current || youtubePlayerRef.current !== player || !playbackOwnerRef.current) return;
              player.setVolume(effectiveVolumeRef.current);
              const position = playbackPosition(latest);
              if (position > 1) player.seekTo(position, true);
              if (latest.status === "PLAYING") player.playVideo();
              else player.pauseVideo();
              lastAppliedStatusRef.current = `${generationTrackId}:${latest.status}`;
            },
            onStateChange: (event: { data?: number }) => {
              if (event.data === (YT.PlayerState?.ENDED ?? 0)) reportEnded(generationTrackId);
            },
            onError: () => announceEngineError("O YouTube recusou a reproducao desta musica. Tente outra faixa.")
          }
        });
        youtubePlayerRef.current = player;
      }).catch((caught) => announceEngineError(caught instanceof Error ? caught.message : "Falha no player do YouTube."));
      return;
    }

    void loadSoundCloudApi().then((Widget) => {
      if (!hostRef.current || currentTrackIdRef.current !== generationTrackId || generation !== engineGenerationRef.current || !playbackOwnerRef.current) return;
      const iframe = document.createElement("iframe");
      iframe.className = "ginga-music-provider-frame";
      iframe.allow = "autoplay";
      iframe.referrerPolicy = "no-referrer";
      iframe.setAttribute("aria-hidden", "true");
      iframe.src = `https://w.soundcloud.com/player/?url=${encodeURIComponent(current.url)}&auto_play=false&hide_related=true&show_comments=false&show_user=false&show_reposts=false&visual=false`;
      hostRef.current.replaceChildren(iframe);
      soundCloudIframeRef.current = iframe;
      const widget = Widget(iframe);
      soundCloudWidgetRef.current = widget;
      widget.bind(Widget.Events.READY, () => {
        const latest = stateRef.current;
        if (!latest || latest.current?.id !== generationTrackId || generation !== engineGenerationRef.current || soundCloudWidgetRef.current !== widget || !playbackOwnerRef.current) return;
        widget.setVolume(effectiveVolumeRef.current);
        const position = playbackPosition(latest);
        if (position > 1) widget.seekTo(Math.round(position * 1000));
        if (latest.status === "PLAYING") widget.play();
        else widget.pause();
        lastAppliedStatusRef.current = `${generationTrackId}:${latest.status}`;
      });
      widget.bind(Widget.Events.FINISH, () => reportEnded(generationTrackId));
    }).catch((caught) => announceEngineError(caught instanceof Error ? caught.message : "Falha no player do SoundCloud."));
  }, [channelId, destroyEngine, guildId, playbackOwner, reportEnded, state?.channelId, state?.current?.id, state?.current?.provider, state?.current?.providerId, state?.current?.url]);

  useEffect(() => {
    if (!playbackOwner || !state?.current || state.channelId !== channelId || currentTrackIdRef.current !== state.current.id) return;
    const volume = effectiveVolume;
    try { youtubePlayerRef.current?.setVolume(volume); } catch { /* player externo */ }
    try { soundCloudWidgetRef.current?.setVolume(volume); } catch { /* player externo */ }
  }, [channelId, effectiveVolume, playbackOwner, state?.channelId, state?.current?.id]);

  useEffect(() => {
    if (!playbackOwner || !state?.current || state.channelId !== channelId || currentTrackIdRef.current !== state.current.id) return;
    const statusKey = `${state.current.id}:${state.status}`;
    const statusChanged = lastAppliedStatusRef.current !== statusKey;
    const targetPosition = playbackPosition(state);

    if (engineKindRef.current === "YOUTUBE") {
      const player = youtubePlayerRef.current;
      if (!player) return;
      try {
        const actual = player.getCurrentTime();
        if (Number.isFinite(actual) && Math.abs(actual - targetPosition) > 6) player.seekTo(targetPosition, true);
        if (statusChanged) {
          if (state.status === "PLAYING") player.playVideo();
          else player.pauseVideo();
        }
      } catch { /* player externo pode estar inicializando */ }
    } else {
      const widget = soundCloudWidgetRef.current;
      if (!widget) return;
      try {
        if (statusChanged) {
          if (state.status === "PLAYING") widget.play();
          else widget.pause();
        }
      } catch { /* player externo pode estar inicializando */ }
    }
    if (statusChanged) lastAppliedStatusRef.current = statusKey;
  }, [channelId, playbackOwner, state?.channelId, state?.current?.id, state?.positionSeconds, state?.revision, state?.serverNow, state?.status]);

  return <div className="ginga-music-engine" ref={hostRef} aria-hidden="true" data-playback-owner={playbackOwner ? "true" : "false"} />;
}
