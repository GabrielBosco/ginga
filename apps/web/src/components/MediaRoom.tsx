import { useEffect, useMemo, useRef, useState } from "react";
import {
  Camera,
  CameraOff,
  Gauge,
  LoaderCircle,
  LogOut,
  Maximize2,
  Mic,
  MicOff,
  MonitorUp,
  PhoneOff,
  Radio,
  UserPlus,
  Users,
  Volume2,
  VolumeX,
  X
} from "lucide-react";
import {
  ConnectionState,
  Participant,
  Room,
  RoomEvent,
  Track,
  TrackPublication
} from "livekit-client";
import type { Socket } from "socket.io-client";
import { api } from "../lib/api";
import { applyMicrophoneSensitivity, loadVoicePreferences } from "../lib/voicePreferences";
import { setVoiceScreenShare } from "../lib/voiceScreenShare";
import { watchVoiceNetworkStats } from "../lib/voiceDiagnostics";
import type { LiveKitCredentials, User } from "../types";
import type { DirectCall } from "../lib/directCalls";
import { Avatar } from "./Avatar";

interface MediaRoomProps {
  title: string;
  subtitle?: string;
  tokenPath: string;
  tokenBody: Record<string, string>;
  socket?: Socket;
  presenceChannelId?: string;
  directCall?: DirectCall | null;
  inviteCandidates?: User[];
  onInviteParticipant?: (userId: string) => Promise<void> | void;
  onEndCallForEveryone?: () => Promise<void> | void;
  onLeave: () => void;
}

interface AudioPublicationEntry {
  participant: Participant;
  publication: TrackPublication;
}

function participantColor(participant: Participant): string {
  if (!participant.metadata) return "#22a699";
  try {
    const metadata = JSON.parse(participant.metadata) as { avatarColor?: string };
    return metadata.avatarColor ?? "#22a699";
  } catch {
    return "#22a699";
  }
}

function AttachedTrack({ publication, muted = false, volume = 1 }: { publication: TrackPublication; muted?: boolean; volume?: number }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const isVideo = publication.kind === Track.Kind.Video;

  useEffect(() => {
    const element = isVideo ? videoRef.current : audioRef.current;
    const track = publication.track;
    if (!element || !track) return;
    if (element instanceof HTMLMediaElement) {
      element.muted = muted;
      element.volume = Math.max(0, Math.min(1, volume));
    }
    try { track.attach(element); } catch { return; }
    if (element instanceof HTMLMediaElement) void element.play().catch(() => undefined);
    return () => {
      try { track.detach(element); } catch {}
      if (element instanceof HTMLMediaElement) {
        try { element.pause(); } catch {}
        element.muted = true;
        element.srcObject = null;
      }
    };
  }, [isVideo, muted, publication.track, volume]);

  if (isVideo) return <video ref={videoRef} autoPlay playsInline muted={muted} />;
  return <audio ref={audioRef} autoPlay playsInline muted={muted} />;
}

function ParticipantTile({ participant, onFocusScreen }: { participant: Participant; onFocusScreen: (identity: string) => void }) {
  const videoPublications = Array.from(participant.videoTrackPublications.values())
    .filter((publication) => Boolean(publication.track) && !publication.isMuted);
  const screenPublication = videoPublications.find((publication) => publication.source === Track.Source.ScreenShare);
  const cameraPublication = videoPublications.find((publication) => publication.source === Track.Source.Camera);
  const publication = screenPublication ?? cameraPublication;
  const displayName = participant.name || participant.identity;

  return (
    <article
      className={`participant-tile ${publication ? "with-video" : "without-video"} ${screenPublication ? "screen-tile" : ""} ${participant.isSpeaking ? "speaking" : ""}`}
      onDoubleClick={() => { if (screenPublication) onFocusScreen(participant.identity); }}
    >
      {publication ? (
        <AttachedTrack publication={publication} muted={participant.isLocal} />
      ) : (
        <div className="participant-placeholder">
          <Avatar name={displayName} color={participantColor(participant)} size="xl" />
        </div>
      )}
      <div className="participant-label">
        <span>{displayName}{participant.isLocal ? " (voce)" : ""}</span>
        {participant.isMicrophoneEnabled ? <Mic size={14} /> : <MicOff size={14} />}
      </div>
      {screenPublication && (
        <>
          <span className="screen-badge"><MonitorUp size={13} /> Compartilhando tela</span>
          <button className="screen-expand-button" type="button" onClick={() => onFocusScreen(participant.identity)} aria-label="Abrir transmissao em tela maior">
            <Maximize2 size={15} />
          </button>
        </>
      )}
    </article>
  );
}

function FocusedScreenShare({
  participant,
  volume,
  onVolumeChange,
  onClose
}: {
  participant: Participant;
  volume: number;
  onVolumeChange: (volume: number) => void;
  onClose: () => void;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const screenPublication = Array.from(participant.videoTrackPublications.values())
    .find((publication) => publication.source === Track.Source.ScreenShare && Boolean(publication.track) && !publication.isMuted);
  const hasScreenAudio = Array.from(participant.audioTrackPublications.values())
    .some((publication) => publication.source === Track.Source.ScreenShareAudio && Boolean(publication.track) && !publication.isMuted);
  const displayName = participant.name || participant.identity;

  if (!screenPublication) return null;

  async function toggleFullscreen() {
    const panel = panelRef.current;
    if (!panel) return;
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await panel.requestFullscreen();
    } catch {
      // O modo ampliado continua disponivel mesmo se o SO bloquear fullscreen.
    }
  }

  return (
    <div className="screen-focus-layer">
      <div className="screen-focus-panel" ref={panelRef}>
        <header className="screen-focus-header">
          <div>
            <strong>{displayName}</strong>
            <span>Compartilhamento de tela</span>
          </div>
          <div className="screen-focus-actions">
            <button type="button" onClick={() => void toggleFullscreen()} aria-label="Tela cheia"><Maximize2 size={18} /></button>
            <button type="button" onClick={onClose} aria-label="Voltar para a grade"><X size={18} /></button>
          </div>
        </header>
        <div className="screen-focus-video">
          <AttachedTrack publication={screenPublication} muted={participant.isLocal} />
        </div>
        <footer className="screen-focus-footer">
          {participant.isLocal ? (
            <span className="screen-audio-hint">Voce esta transmitindo esta tela.</span>
          ) : hasScreenAudio ? (
            <label className="screen-volume-control">
              {volume <= 0.01 ? <VolumeX size={18} /> : <Volume2 size={18} />}
              <input
                type="range"
                min="0"
                max="100"
                value={Math.round(volume * 100)}
                onChange={(event) => onVolumeChange(Number(event.target.value) / 100)}
              />
              <span>{Math.round(volume * 100)}%</span>
            </label>
          ) : (
            <span className="screen-audio-hint"><VolumeX size={16} /> Esta transmissao nao esta enviando audio.</span>
          )}
        </footer>
      </div>
    </div>
  );
}

export function MediaRoom({ title, subtitle, tokenPath, tokenBody, socket, presenceChannelId, directCall, inviteCandidates = [], onInviteParticipant, onEndCallForEveryone, onLeave }: MediaRoomProps) {
  const [room, setRoom] = useState<Room | null>(null);
  const [revision, setRevision] = useState(0);
  const [status, setStatus] = useState<ConnectionState>(ConnectionState.Disconnected);
  const [error, setError] = useState("");
  const [mediaWarning, setMediaWarning] = useState("");
  const [busy, setBusy] = useState(false);
  const [micEnabled, setMicEnabled] = useState(false);
  const [cameraEnabled, setCameraEnabled] = useState(false);
  const [screenEnabled, setScreenEnabled] = useState(false);
  const [audioBlocked, setAudioBlocked] = useState(false);
  const [pingMs, setPingMs] = useState<number | null>(null);
  const [jitterMs, setJitterMs] = useState<number | null>(null);
  const [packetLossPercent, setPacketLossPercent] = useState<number | null>(null);
  const [focusedParticipantIdentity, setFocusedParticipantIdentity] = useState<string | null>(null);
  const [screenVolumes, setScreenVolumes] = useState<Record<string, number>>({});
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteQuery, setInviteQuery] = useState("");
  const [inviteBusyId, setInviteBusyId] = useState("");
  const desiredMicEnabledRef = useRef(true);
  const desiredScreenEnabledRef = useRef(false);

  const bodyKey = JSON.stringify(tokenBody);

  useEffect(() => {
    let cancelled = false;
    let reconnectTimer: number | null = null;
    let micHealthTimer: number | null = null;
    let reconnectAttempts = 0;
    let reconnecting = false;
    let livekitConnected = false;
    const activeRoom = new Room({ adaptiveStream: true, dynacast: true });
    setRoom(activeRoom);
    setError("");
    setMediaWarning("");
    setStatus(ConnectionState.Connecting);

    const refresh = () => {
      if (cancelled) return;
      setRevision((value) => value + 1);
      setMicEnabled(activeRoom.localParticipant.isMicrophoneEnabled);
      setCameraEnabled(activeRoom.localParticipant.isCameraEnabled);
      setScreenEnabled(activeRoom.localParticipant.isScreenShareEnabled);
    };

    const announcePresence = () => {
      if (!socket || !presenceChannelId) return;
      socket.emit("voice:join", { channelId: presenceChannelId }, (response: { ok: boolean; error?: string }) => {
        if (!cancelled && !response?.ok) setMediaWarning(response?.error ?? "Nao foi possivel atualizar sua presenca na chamada");
      });
    };
    const clearPresence = () => {
      if (socket && presenceChannelId) socket.emit("voice:leave", { channelId: presenceChannelId });
    };
    const onSocketConnect = () => { if (livekitConnected) announcePresence(); };

    const ensurePlayback = async () => {
      if (cancelled || activeRoom.state !== ConnectionState.Connected) return;
      try {
        await activeRoom.startAudio();
        if (!cancelled) setAudioBlocked(false);
      } catch {
        if (!cancelled) setAudioBlocked(true);
      }
      for (const participant of activeRoom.remoteParticipants.values()) {
        for (const publication of participant.trackPublications.values()) {
          const subscribable = publication as unknown as { setSubscribed?: (enabled: boolean) => void };
          try { subscribable.setSubscribed?.(true); } catch {}
        }
      }
    };

    const repairMicrophone = async () => {
      if (cancelled || activeRoom.state !== ConnectionState.Connected || !desiredMicEnabledRef.current) return;
      const publication = activeRoom.localParticipant.getTrackPublication(Track.Source.Microphone);
      const mediaTrack = publication?.track?.mediaStreamTrack;
      const healthy = activeRoom.localParticipant.isMicrophoneEnabled && Boolean(mediaTrack) && mediaTrack?.readyState === "live";
      if (healthy) return;
      try {
        try { await activeRoom.localParticipant.setMicrophoneEnabled(false); } catch {}
        await activeRoom.localParticipant.setMicrophoneEnabled(true, {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        });
        if (!cancelled) {
          setMediaWarning("");
          refresh();
        }
      } catch {
        if (!cancelled) setMediaWarning("O microfone parou de enviar audio. Confira o dispositivo e a permissao do Ginga.");
      }
    };

    const fetchCredentials = () => api<LiveKitCredentials>(tokenPath, {
      method: "POST",
      body: JSON.stringify(JSON.parse(bodyKey) as Record<string, string>)
    });

    const connectFresh = async (recovery: boolean) => {
      if (cancelled || reconnecting) return;
      reconnecting = true;
      try {
        const credentials = await fetchCredentials();
        if (cancelled) return;
        await activeRoom.connect(credentials.url, credentials.token, { autoSubscribe: true });
        livekitConnected = true;
        reconnectAttempts = 0;
        setError("");
        setStatus(ConnectionState.Connected);
        announcePresence();
        if (!cancelled) setMediaWarning("");
        await ensurePlayback();
        if (desiredMicEnabledRef.current) await repairMicrophone();
        if (!cancelled) refresh();
      } catch (caught) {
        reconnectAttempts += 1;
        if (!cancelled && !recovery) {
          setError(caught instanceof Error ? caught.message : "Falha ao conectar na chamada");
          setStatus(ConnectionState.Disconnected);
        } else if (!cancelled && reconnectAttempts >= 5) {
          setError("A chamada perdeu a conexao e nao conseguiu se recuperar automaticamente.");
          setStatus(ConnectionState.Disconnected);
        }
        throw caught;
      } finally {
        reconnecting = false;
      }
    };

    const scheduleReconnect = () => {
      if (cancelled || reconnectAttempts >= 5 || reconnectTimer !== null) return;
      const delay = Math.min(10_000, 900 * 2 ** reconnectAttempts);
      if (!cancelled) setMediaWarning("A conexao de voz oscilou. Reconectando automaticamente...");
      reconnectTimer = window.setTimeout(() => {
        reconnectTimer = null;
        void connectFresh(true).catch(() => { if (!cancelled) scheduleReconnect(); });
      }, delay);
    };

    const onState = (nextState: ConnectionState) => {
      livekitConnected = nextState === ConnectionState.Connected;
      if (!cancelled) setStatus(nextState);
      if (nextState === ConnectionState.Connected) {
        reconnectAttempts = 0;
        if (reconnectTimer !== null) window.clearTimeout(reconnectTimer);
        reconnectTimer = null;
        announcePresence();
        void ensurePlayback();
        void repairMicrophone();
      } else if (nextState === ConnectionState.Disconnected && !cancelled) {
        clearPresence();
        scheduleReconnect();
      }
    };
    const onAudioPlaybackChanged = () => { if (!cancelled) setAudioBlocked(!activeRoom.canPlaybackAudio); };
    const onLocalTrackUnpublished = (publication?: TrackPublication) => {
      refresh();
      if (publication?.source === Track.Source.ScreenShare && desiredScreenEnabledRef.current) { desiredScreenEnabledRef.current = false; if (!cancelled) setMediaWarning("A transmissao de tela foi interrompida. Escolha a fonte novamente para continuar."); }
      if (publication?.source === Track.Source.Microphone && desiredMicEnabledRef.current) window.setTimeout(() => { void repairMicrophone(); }, 500);
    };
    const refreshEvents = [
      RoomEvent.ParticipantConnected,
      RoomEvent.ParticipantDisconnected,
      RoomEvent.TrackSubscribed,
      RoomEvent.TrackUnsubscribed,
      RoomEvent.TrackPublished,
      RoomEvent.TrackUnpublished,
      RoomEvent.TrackMuted,
      RoomEvent.TrackUnmuted,
      RoomEvent.LocalTrackPublished,
      RoomEvent.ActiveSpeakersChanged,
      RoomEvent.ConnectionQualityChanged
    ] as const;

    refreshEvents.forEach((event) => activeRoom.on(event, refresh));
    activeRoom.on(RoomEvent.LocalTrackUnpublished, onLocalTrackUnpublished);
    activeRoom.on(RoomEvent.ConnectionStateChanged, onState);
    activeRoom.on(RoomEvent.AudioPlaybackStatusChanged, onAudioPlaybackChanged);
    socket?.on("connect", onSocketConnect);

    void connectFresh(false).catch(() => { if (!cancelled) scheduleReconnect(); });
    micHealthTimer = window.setInterval(() => { void repairMicrophone(); }, 8_000);

    return () => {
      cancelled = true;
      livekitConnected = false;
      if (reconnectTimer !== null) window.clearTimeout(reconnectTimer);
      if (micHealthTimer !== null) window.clearInterval(micHealthTimer);
      clearPresence();
      socket?.off("connect", onSocketConnect);
      refreshEvents.forEach((event) => activeRoom.off(event, refresh));
      activeRoom.off(RoomEvent.LocalTrackUnpublished, onLocalTrackUnpublished);
      activeRoom.off(RoomEvent.ConnectionStateChanged, onState);
      activeRoom.off(RoomEvent.AudioPlaybackStatusChanged, onAudioPlaybackChanged);
      activeRoom.disconnect();
    };
  }, [bodyKey, presenceChannelId, socket, tokenPath]);

  useEffect(() => {
    if (!room || status !== ConnectionState.Connected) { setPingMs(null); setJitterMs(null); setPacketLossPercent(null); return; }
    return watchVoiceNetworkStats(room, (stats) => { setPingMs(stats.pingMs); setJitterMs(stats.jitterMs); setPacketLossPercent(stats.packetLossPercent); }, 3000);
  }, [room, status]);

  const participants = useMemo(() => room ? [room.localParticipant, ...Array.from(room.remoteParticipants.values())] : [], [room, revision]);
  const audioPublications = useMemo<AudioPublicationEntry[]>(() => {
    if (!room) return [];
    return Array.from(room.remoteParticipants.values()).flatMap((participant) =>
      Array.from(participant.audioTrackPublications.values())
        .filter((publication) => Boolean(publication.track) && !publication.isMuted)
        .map((publication) => ({ participant, publication }))
    );
  }, [room, revision]);
  const hasScreenShare = participants.some((participant) => participant.isScreenShareEnabled);
  const focusedParticipant = focusedParticipantIdentity
    ? participants.find((participant) => participant.identity === focusedParticipantIdentity && participant.isScreenShareEnabled) ?? null
    : null;

  const callParticipantIds = useMemo(() => new Set((directCall?.participants ?? []).map((item) => item.userId)), [directCall]);
  const callInviteCandidates = useMemo(() => {
    const query = inviteQuery.trim().toLowerCase();
    return inviteCandidates.filter((candidate) => !callParticipantIds.has(candidate.id) && (!query || `${candidate.displayName} ${candidate.username}`.toLowerCase().includes(query))).slice(0, 30);
  }, [callParticipantIds, inviteCandidates, inviteQuery]);

  async function inviteParticipant(userId: string) {
    if (!onInviteParticipant || inviteBusyId) return;
    setInviteBusyId(userId);
    setMediaWarning("");
    try { await onInviteParticipant(userId); }
    catch (caught) { setMediaWarning(caught instanceof Error ? caught.message : "Nao foi possivel convidar essa pessoa"); }
    finally { setInviteBusyId(""); }
  }

  useEffect(() => {
    if (focusedParticipantIdentity && !focusedParticipant) setFocusedParticipantIdentity(null);
  }, [focusedParticipant, focusedParticipantIdentity]);

  async function toggleMedia(kind: "mic" | "camera" | "screen") {
    if (!room || busy || status !== ConnectionState.Connected) return;
    setBusy(true);
    setMediaWarning("");
    try {
      if (kind === "mic") {
        const next = !room.localParticipant.isMicrophoneEnabled;
        desiredMicEnabledRef.current = next;
        const preferences = loadVoicePreferences();
        await room.localParticipant.setMicrophoneEnabled(next, next ? {
          deviceId: preferences.microphoneDevice || undefined,
          echoCancellation: true,
          noiseSuppression: preferences.noiseSuppression,
          autoGainControl: true
        } : undefined);
        if (next) await applyMicrophoneSensitivity(room, preferences.microphoneSensitivity).catch(() => false);
      }
      if (kind === "camera") await room.localParticipant.setCameraEnabled(!room.localParticipant.isCameraEnabled);
      if (kind === "screen") {
        const next = !room.localParticipant.isScreenShareEnabled;
        desiredScreenEnabledRef.current = next;
        try { await setVoiceScreenShare(room, next); }
        catch (caught) { if (next) desiredScreenEnabledRef.current = false; throw caught; }
      }
      setMicEnabled(room.localParticipant.isMicrophoneEnabled);
      setCameraEnabled(room.localParticipant.isCameraEnabled);
      setScreenEnabled(room.localParticipant.isScreenShareEnabled);
      setRevision((value) => value + 1);
    } catch (caught) {
      setMediaWarning(caught instanceof Error ? caught.message : "O navegador bloqueou o dispositivo");
    } finally {
      setBusy(false);
    }
  }

  async function enablePlayback() {
    if (!room) return;
    try {
      await room.startAudio();
      setAudioBlocked(false);
    } catch (caught) {
      setMediaWarning(caught instanceof Error ? caught.message : "O navegador ainda bloqueou o audio");
    }
  }

  function leave() {
    room?.disconnect();
    onLeave();
  }

  return (
    <section className="voice-view">
      <header className="content-header voice-header">
        <div>
          <div className="channel-title"><Volume2 size={20} /><strong>{title}</strong></div>
          <span className="channel-topic">{subtitle ?? `${participants.length} participante${participants.length === 1 ? "" : "s"}`}</span>
        </div>
        <div className="voice-network-state">
          {directCall && <span className="call-participant-pill"><Users size={14}/> {directCall.participants.filter((item) => item.status === "JOINED").length} na chamada</span>}
          {directCall && onInviteParticipant && <button type="button" className={`call-invite-toggle ${inviteOpen ? "active" : ""}`} onClick={() => setInviteOpen((value) => !value)}><UserPlus size={15}/> Adicionar pessoas</button>}
          <span className={`latency-pill ${pingMs !== null && pingMs > 180 ? "warn" : ""}`}><Gauge size={14} /> {pingMs === null ? "-- ms" : `${pingMs} ms`}</span><span className={`latency-pill compact ${jitterMs !== null && jitterMs > 30 ? "warn" : ""}`}>Jitter {jitterMs === null ? "--" : jitterMs} ms</span><span className={`latency-pill compact ${packetLossPercent !== null && packetLossPercent > 2 ? "danger" : ""}`}>Perda {packetLossPercent === null ? "--" : packetLossPercent}%</span>
          <span className={`connection-pill state-${status.toLowerCase()}`}><Radio size={14} /> {status === ConnectionState.Connected ? "Conectado" : status === ConnectionState.Connecting ? "Conectando" : status}</span>
        </div>
      </header>

      <div className="voice-stage">
        {error ? (
          <div className="voice-error">
            <PhoneOff size={38} />
            <h2>Nao foi possivel entrar na chamada</h2>
            <p>{error}</p>
            <button className="secondary-button" onClick={onLeave}><LogOut size={17} /> Voltar</button>
          </div>
        ) : status !== ConnectionState.Connected ? (
          <div className="center-state large"><LoaderCircle className="spin" /> Entrando na chamada...</div>
        ) : (
          <div className={`participant-grid ${hasScreenShare ? "has-screen-share" : ""}`}>
            {participants.map((participant) => (
              <ParticipantTile
                key={participant.sid || participant.identity}
                participant={participant}
                onFocusScreen={setFocusedParticipantIdentity}
              />
            ))}
          </div>
        )}

        {directCall && inviteOpen && <aside className="direct-call-invite-panel">
          <header><div><strong>Adicionar pessoas</strong><span>Convide amigos sem encerrar a chamada atual.</span></div><button type="button" onClick={() => setInviteOpen(false)} aria-label="Fechar"><X size={16}/></button></header>
          <input value={inviteQuery} onChange={(event) => setInviteQuery(event.target.value)} placeholder="Buscar amigos" autoFocus/>
          <div className="direct-call-participant-roster">
            <strong>Na chamada</strong>
            {directCall.participants.filter((item) => ["JOINED","INVITED","LEFT"].includes(item.status)).map((item) => <div key={item.userId} className={`direct-call-roster-row ${item.status.toLowerCase()}`}><Avatar user={item.user ?? undefined} size="sm"/><span><b>{item.user?.displayName ?? "Usuario"}</b><small>{item.status === "JOINED" ? "Conectado" : item.status === "INVITED" ? "Convidado" : "Saiu da chamada"}</small></span></div>)}
          </div>
          <div className="direct-call-invite-list"><strong>Amigos</strong>{callInviteCandidates.length === 0 ? <span className="direct-call-invite-empty">Nenhum amigo disponivel para convidar.</span> : callInviteCandidates.map((candidate) => <div key={candidate.id} className="direct-call-invite-row"><Avatar user={candidate} size="sm"/><span><b>{candidate.displayName}</b><small>@{candidate.username}</small></span><button type="button" disabled={Boolean(inviteBusyId)} onClick={() => void inviteParticipant(candidate.id)}>{inviteBusyId === candidate.id ? "Enviando..." : "Convidar"}</button></div>)}</div>
        </aside>}

        {focusedParticipant && (
          <FocusedScreenShare
            participant={focusedParticipant}
            volume={screenVolumes[focusedParticipant.identity] ?? 1}
            onVolumeChange={(volume) => setScreenVolumes((current) => ({ ...current, [focusedParticipant.identity]: volume }))}
            onClose={() => setFocusedParticipantIdentity(null)}
          />
        )}

        <div className="audio-sinks" aria-hidden="true">
          {audioPublications.map(({ participant, publication }) => (
            <AttachedTrack
              key={publication.trackSid}
              publication={publication}
              volume={publication.source === Track.Source.ScreenShareAudio ? (screenVolumes[participant.identity] ?? 1) : 1}
            />
          ))}
        </div>
      </div>

      <footer className="voice-controls-wrap">
        {audioBlocked && <div className="media-warning">O navegador bloqueou o som. <button type="button" onClick={() => void enablePlayback()}>Ativar audio</button></div>}
        {mediaWarning && <div className="media-warning">{mediaWarning}</div>}
        <div className="voice-controls">
          <button className={`media-button ${!micEnabled ? "off" : ""}`} onClick={() => void toggleMedia("mic")} disabled={busy || status !== ConnectionState.Connected} aria-label={micEnabled ? "Desativar microfone" : "Ativar microfone"}>{micEnabled ? <Mic /> : <MicOff />}</button>
          <button className={`media-button ${!cameraEnabled ? "off" : ""}`} onClick={() => void toggleMedia("camera")} disabled={busy || status !== ConnectionState.Connected} aria-label={cameraEnabled ? "Desativar camera" : "Ativar camera"}>{cameraEnabled ? <Camera /> : <CameraOff />}</button>
          <button className={`media-button ${screenEnabled ? "active" : ""}`} onClick={() => void toggleMedia("screen")} disabled={busy || status !== ConnectionState.Connected} aria-label="Escolher tela ou janela para compartilhar"><MonitorUp /></button>
          <button className="media-button hangup" onClick={leave} aria-label="Sair da chamada"><PhoneOff /></button>{onEndCallForEveryone && <button className="media-button end-for-all" onClick={() => void onEndCallForEveryone()} aria-label="Encerrar chamada para todos"><X/></button>}
        </div>
        <span className="voice-identity">Conectado como <strong>{room?.localParticipant.name || "voce"}</strong></span>
      </footer>
    </section>
  );
}
