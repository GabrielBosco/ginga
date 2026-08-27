import { useEffect, useMemo, useRef, useState } from "react";
import { ConnectionState, RoomEvent, Track, type Participant, type TrackPublication } from "livekit-client";
import { api } from "../lib/api";
import { loadVoicePreferences, saveVoicePreferences, type VoicePreferences } from "../lib/voicePreferences";
import { keyboardEventMatchesBinding, mouseButtonFromBinding } from "../lib/pushToTalkBinding";
import { loadNotificationPreferences } from "../lib/preferences";
import { isChannelMuted, isGuildSilent, loadGuildPreferences } from "../lib/serverPreferences";
import { playUiSound } from "../lib/sounds";
import { watchVoiceNetworkStats } from "../lib/voiceDiagnostics";
import type { LiveKitCredentials } from "../types";

interface PersistentVoiceAudioProps {
  activeChannelId: string;
  activeGuildId?: string;
  voiceViewVisible: boolean;
}

interface RemoteAudioPublication {
  identity: string;
  publication: TrackPublication;
}

const PARTICIPANT_VOLUME_KEY = "ginga.voice.participantVolumes";
const PARTICIPANT_MUTE_KEY = "ginga.voice.participantMutes";

let sharedVoiceAudioContext: AudioContext | null = null;

function getSharedVoiceAudioContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const AudioContextCtor = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioContextCtor) return null;
  if (!sharedVoiceAudioContext || sharedVoiceAudioContext.state === "closed") sharedVoiceAudioContext = new AudioContextCtor();
  return sharedVoiceAudioContext;
}

function readVolumeMap(): Record<string, number> {
  try {
    const parsed = JSON.parse(localStorage.getItem(PARTICIPANT_VOLUME_KEY) || "{}") as Record<string, unknown>;
    const result: Record<string, number> = {};
    for (const [identity, value] of Object.entries(parsed)) {
      const numeric = Number(value);
      if (Number.isFinite(numeric)) result[identity] = Math.max(0, Math.min(200, numeric));
    }
    return result;
  } catch {
    return {};
  }
}

function readMuteMap(): Record<string, boolean> {
  try {
    const parsed = JSON.parse(localStorage.getItem(PARTICIPANT_MUTE_KEY) || "{}") as Record<string, unknown>;
    const result: Record<string, boolean> = {};
    for (const [identity, value] of Object.entries(parsed)) if (value === true) result[identity] = true;
    return result;
  } catch {
    return {};
  }
}

function notifyPlaybackBlocked(blocked: boolean) {
  window.dispatchEvent(new CustomEvent("ginga:voice-playback-state", { detail: { blocked } }));
}

function PersistentAudioTrack({
  identity,
  publication,
  preferences,
  deafened,
  participantVolume,
  participantMuted
}: {
  identity: string;
  publication: TrackPublication;
  preferences: VoicePreferences;
  deafened: boolean;
  participantVolume: number;
  participantMuted: boolean;
}) {
  const ref = useRef<HTMLAudioElement>(null);
  const sourceRef = useRef<MediaElementAudioSourceNode | null>(null);
  const gainNodeRef = useRef<GainNode | null>(null);
  const gain = Math.max(0, Math.min(4, (preferences.outputVolume / 100) * (participantVolume / 100)));
  const effectivelyMuted = participantMuted || deafened || gain <= 0;

  useEffect(() => {
    const track = publication.track;
    const element = ref.current;
    if (!track || !element) return;

    try { track.attach(element); } catch { return; }

    // HTMLMediaElement.volume aceita somente 0..1. Para manter o controle de
    // usuario ate 200% (e combinacao geral x participante) usamos GainNode.
    // O fallback continua limitado a 100% em navegadores sem Web Audio.
    try {
      const ctx = getSharedVoiceAudioContext();
      if (ctx) {
        const source = ctx.createMediaElementSource(element);
        const gainNode = ctx.createGain();
        source.connect(gainNode);
        gainNode.connect(ctx.destination);
        sourceRef.current = source;
        gainNodeRef.current = gainNode;
        // O elemento nunca passa de 100%; o boost acontece exclusivamente no GainNode.
        element.volume = 1;
        element.muted = false;
        void ctx.resume().catch(() => undefined);
      }
    } catch {
      sourceRef.current = null;
      gainNodeRef.current = null;
    }

    void element.play().then(() => {
      void getSharedVoiceAudioContext()?.resume().catch(() => undefined);
      notifyPlaybackBlocked(false);
    }).catch(() => notifyPlaybackBlocked(true));

    return () => {
      try { track.detach(element); } catch {}
      try { element.pause(); } catch {}
      element.srcObject = null;
      try { sourceRef.current?.disconnect(); } catch {}
      try { gainNodeRef.current?.disconnect(); } catch {}
      sourceRef.current = null;
      gainNodeRef.current = null;
      // Contexto compartilhado permanece vivo: criar um AudioContext por usuario
      // estoura o limite do Chromium em salas maiores.
    };
  }, [publication.track, identity]);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const gainNode = gainNodeRef.current;
    if (gainNode) {
      gainNode.gain.value = effectivelyMuted ? 0 : gain;
      // O audio passa pelo Web Audio; nunca escrevemos valor > 1 no elemento.
      element.volume = 1;
      element.muted = false;
      if (!effectivelyMuted) void getSharedVoiceAudioContext()?.resume().catch(() => undefined);
      return;
    }
    element.muted = effectivelyMuted;
    element.volume = effectivelyMuted ? 0 : Math.max(0, Math.min(1, gain));
  }, [gain, effectivelyMuted]);

  useEffect(() => {
    const element = ref.current as (HTMLAudioElement & { setSinkId?: (deviceId: string) => Promise<void> }) | null;
    if (!element || !preferences.outputDevice) return;
    void element.setSinkId?.(preferences.outputDevice).catch(() => undefined);
  }, [preferences.outputDevice]);

  return <audio ref={ref} autoPlay playsInline />;
}

export function PersistentVoiceAudio({ activeChannelId, activeGuildId, voiceViewVisible }: PersistentVoiceAudioProps) {
  // Audio stays centralized here even while VoiceRoom is visible. Keeping a single
  // attachment path prevents duplicate remote tracks during navigation/reconnects.
  void voiceViewVisible;
  const [revision, setRevision] = useState(0);
  const [preferences, setPreferences] = useState<VoicePreferences>(() => loadVoicePreferences());
  const [deafened, setDeafened] = useState(() => Boolean(window.__gingaVoiceSession?.deafened));
  const [participantVolumes, setParticipantVolumes] = useState<Record<string, number>>(readVolumeMap);
  const [participantMutes, setParticipantMutes] = useState<Record<string, boolean>>(readMuteMap);
  const recoverTimerRef = useRef<number | null>(null);
  const recoverAttemptsRef = useRef(0);
  const micRepairingRef = useRef(false);
  const micHealthTimerRef = useRef<number | null>(null);
  const session = window.__gingaVoiceSession;
  const room = session?.channelId === activeChannelId ? session.room : null;

  useEffect(() => {
    const onPreferences = (event: Event) => {
      const next = (event as CustomEvent<VoicePreferences>).detail;
      if (next) setPreferences(next);
    };
    const onDeafen = (event: Event) => {
      const local = Boolean((event as CustomEvent<{ deafened?: boolean }>).detail?.deafened);
      setDeafened(Boolean(window.__gingaVoiceSession?.serverDeafened) || local);
    };
    const onServerModeration = (event: Event) => {
      const detail = (event as CustomEvent<{ guildId?: string; muted?: boolean; deafened?: boolean }>).detail;
      const active = window.__gingaVoiceSession;
      if (!active) return;
      if (typeof detail?.muted === "boolean") active.serverMuted = detail.muted;
      if (typeof detail?.deafened === "boolean") active.serverDeafened = detail.deafened;
      if (active.serverMuted || active.serverDeafened) {
        active.desiredMicEnabled = false;
        void active.room.localParticipant.setMicrophoneEnabled(false).catch(() => undefined);
      }
      setDeafened(Boolean(active.serverDeafened || active.deafened));
    };
    const onParticipantAudio = (event: Event) => {
      const detail = (event as CustomEvent<{ identity?: string; volume?: number; muted?: boolean }>).detail;
      const identity = String(detail?.identity || "");
      if (!identity) return;
      if (typeof detail?.volume === "number" && Number.isFinite(detail.volume)) {
        const volume = Math.max(0, Math.min(200, detail.volume));
        setParticipantVolumes((current) => ({ ...current, [identity]: volume }));
      }
      if (typeof detail?.muted === "boolean") setParticipantMutes((current) => ({ ...current, [identity]: Boolean(detail.muted) }));
    };
    const onStorage = (event: StorageEvent) => {
      if (event.key === PARTICIPANT_VOLUME_KEY) setParticipantVolumes(readVolumeMap());
      if (event.key === PARTICIPANT_MUTE_KEY) setParticipantMutes(readMuteMap());
    };

    window.addEventListener("ginga:voice-preferences-changed", onPreferences as EventListener);
    window.addEventListener("ginga:voice-deafen-changed", onDeafen as EventListener);
    window.addEventListener("ginga:voice-server-moderation", onServerModeration as EventListener);
    window.addEventListener("ginga:voice-participant-audio-changed", onParticipantAudio as EventListener);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener("ginga:voice-preferences-changed", onPreferences as EventListener);
      window.removeEventListener("ginga:voice-deafen-changed", onDeafen as EventListener);
      window.removeEventListener("ginga:voice-server-moderation", onServerModeration as EventListener);
      window.removeEventListener("ginga:voice-participant-audio-changed", onParticipantAudio as EventListener);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  useEffect(() => {
    if (!room || !session) return;
    if (preferences.inputMode === "voice") {
      if (session.serverMuted || session.serverDeafened) {
        session.desiredMicEnabled = false;
        if (room.localParticipant.isMicrophoneEnabled) void room.localParticipant.setMicrophoneEnabled(false).catch(() => undefined);
        return;
      }
      session.desiredMicEnabled = true;
      if (room.state === ConnectionState.Connected && !room.localParticipant.isMicrophoneEnabled) {
        void room.localParticipant.setMicrophoneEnabled(true, { deviceId: preferences.microphoneDevice || undefined, echoCancellation: true, noiseSuppression: preferences.noiseSuppression, autoGainControl: true }).catch(() => undefined);
      }
      return;
    }
    session.desiredMicEnabled = false;
    let pressed=false; let sequence=0;
    const editable=(target:EventTarget|null)=>target instanceof HTMLElement && Boolean(target.closest("input,textarea,select,[contenteditable='true']"));
    const setPtt=(enabled:boolean)=>{ if(pressed===enabled&&enabled)return; pressed=enabled; const op=++sequence; void(async()=>{if(room.state!==ConnectionState.Connected||window.__gingaVoiceSession!==session)return;try{if(enabled){if(session.serverMuted||session.serverDeafened)return;try{await room.localParticipant.setMicrophoneEnabled(true,{deviceId:preferences.microphoneDevice||undefined,echoCancellation:true,noiseSuppression:preferences.noiseSuppression,autoGainControl:true})}catch(error){if(!preferences.microphoneDevice)throw error;await room.localParticipant.setMicrophoneEnabled(true,{echoCancellation:true,noiseSuppression:preferences.noiseSuppression,autoGainControl:true});const fallback={...preferences,microphoneDevice:""};setPreferences(fallback);saveVoicePreferences(fallback);}}else await room.localParticipant.setMicrophoneEnabled(false);if(op!==sequence&&enabled)return;window.dispatchEvent(new CustomEvent("ginga:voice-local-mic-state",{detail:{channelId:activeChannelId,enabled:room.localParticipant.isMicrophoneEnabled,pushToTalk:true}}));}catch{window.dispatchEvent(new CustomEvent("ginga:voice-ptt-error",{detail:{channelId:activeChannelId}}));}})(); };
    const down=(event:globalThis.KeyboardEvent)=>{if(!keyboardEventMatchesBinding(preferences.pushToTalkKey,event)||event.repeat||editable(event.target))return;event.preventDefault();setPtt(true)};
    const up=(event:globalThis.KeyboardEvent)=>{if(!keyboardEventMatchesBinding(preferences.pushToTalkKey,event))return;event.preventDefault();setPtt(false)};
    const mouseButton=mouseButtonFromBinding(preferences.pushToTalkKey);
    const md=(event:MouseEvent)=>{if(mouseButton===null||event.button!==mouseButton||editable(event.target))return;event.preventDefault();setPtt(true)};
    const mu=(event:MouseEvent)=>{if(mouseButton===null||event.button!==mouseButton)return;event.preventDefault();setPtt(false)};
    const context=(event:MouseEvent)=>{if(mouseButton===2){event.preventDefault();event.stopPropagation();}};
    const release=()=>setPtt(false);
    window.addEventListener("keydown",down,true);window.addEventListener("keyup",up,true);window.addEventListener("mousedown",md,true);window.addEventListener("mouseup",mu,true);window.addEventListener("contextmenu",context,true);window.addEventListener("blur",release);document.addEventListener("visibilitychange",release);setPtt(false);
    return()=>{window.removeEventListener("keydown",down,true);window.removeEventListener("keyup",up,true);window.removeEventListener("mousedown",md,true);window.removeEventListener("mouseup",mu,true);window.removeEventListener("contextmenu",context,true);window.removeEventListener("blur",release);document.removeEventListener("visibilitychange",release);if(pressed&&room.state===ConnectionState.Connected)void room.localParticipant.setMicrophoneEnabled(false).catch(()=>undefined)};
  }, [activeChannelId, room, session, preferences.inputMode, preferences.pushToTalkKey, preferences.microphoneDevice, preferences.noiseSuppression]);

  useEffect(() => {
    if (!room || !session) return;
    return watchVoiceNetworkStats(room, (stats) => {
      if (window.__gingaVoiceSession !== session) return;
      window.dispatchEvent(new CustomEvent("ginga:voice-network-stats", { detail: { channelId: activeChannelId, ...stats } }));
    }, 3000);
  }, [activeChannelId, room, session]);

  useEffect(() => {
    if (!room || !session) return;
    let disposed = false;
    let playbackBlocked = false;

    const dispatchSpeaking = (speakers: Participant[] = []) => {
      if (disposed || window.__gingaVoiceSession !== session) return;
      window.dispatchEvent(new CustomEvent("ginga:voice-speaking", {
        detail: { channelId: activeChannelId, userIds: speakers.map((participant) => participant.identity).filter(Boolean) }
      }));
    };

    const ensurePlayback = async () => {
      if (disposed || room.state !== ConnectionState.Connected) return;
      try {
        await room.startAudio();
        playbackBlocked = false;
        notifyPlaybackBlocked(false);
      } catch {
        playbackBlocked = true;
        notifyPlaybackBlocked(true);
      }
      for (const participant of room.remoteParticipants.values()) {
        for (const publication of participant.audioTrackPublications.values()) {
          const subscribable = publication as unknown as { setSubscribed?: (subscribed: boolean) => void };
          try { subscribable.setSubscribed?.(true); } catch {}
        }
      }
    };

    const microphoneOptions = (deviceId?: string) => ({
      deviceId: deviceId || undefined,
      echoCancellation: true,
      noiseSuppression: preferences.noiseSuppression,
      autoGainControl: true
    });

    const enableMicrophoneWithFallback = async () => {
      try {
        await room.localParticipant.setMicrophoneEnabled(true, microphoneOptions(preferences.microphoneDevice));
        return true;
      } catch (primaryError) {
        if (!preferences.microphoneDevice) throw primaryError;
        // Dispositivo salvo foi removido/trocou de ID. Mantemos a chamada viva
        // tentando o dispositivo padrao antes de declarar falha do microfone.
        await room.localParticipant.setMicrophoneEnabled(true, microphoneOptions());
        const fallbackPreferences = { ...preferences, microphoneDevice: "" };
        setPreferences(fallbackPreferences);
        saveVoicePreferences(fallbackPreferences);
        window.dispatchEvent(new CustomEvent("ginga:voice-device-fallback", {
          detail: { channelId: activeChannelId, kind: "audioinput" }
        }));
        return true;
      }
    };

    const repairMicrophone = async () => {
      if (disposed || micRepairingRef.current || room.state !== ConnectionState.Connected) return;
      if (session.serverMuted || session.serverDeafened || !session.desiredMicEnabled || preferences.inputMode !== "voice") return;
      const publication = room.localParticipant.getTrackPublication(Track.Source.Microphone);
      const mediaTrack = publication?.track?.mediaStreamTrack;
      const healthy = room.localParticipant.isMicrophoneEnabled && Boolean(mediaTrack) && mediaTrack?.readyState === "live";
      if (healthy) return;

      micRepairingRef.current = true;
      try {
        try { await room.localParticipant.setMicrophoneEnabled(false); } catch {}
        await enableMicrophoneWithFallback();
        if (!disposed && room.localParticipant.isMicrophoneEnabled) {
          window.dispatchEvent(new CustomEvent("ginga:voice-mic-recovered", { detail: { channelId: activeChannelId } }));
        }
      } catch {
        if (!disposed) window.dispatchEvent(new CustomEvent("ginga:voice-mic-recovery-failed", { detail: { channelId: activeChannelId } }));
      } finally {
        micRepairingRef.current = false;
      }
    };

    const recover = async () => {
      if (disposed || window.__gingaVoiceSession !== session || room.state !== ConnectionState.Disconnected || session.recovering) return;
      session.recovering = true;
      try {
        const credentials = await api<LiveKitCredentials>("/api/livekit/token", {
          method: "POST",
          body: JSON.stringify({ channelId: activeChannelId })
        });
        if (disposed || window.__gingaVoiceSession !== session) return;
        session.serverMuted = Boolean(credentials.serverVoiceState?.muted);
        session.serverDeafened = Boolean(credentials.serverVoiceState?.deafened);
        if (session.serverMuted || session.serverDeafened) session.desiredMicEnabled = false;
        setDeafened(Boolean(session.serverDeafened || session.deafened));
        await room.connect(credentials.url, credentials.token, { autoSubscribe: true });
        recoverAttemptsRef.current = 0;
        await ensurePlayback();
        if (!session.serverMuted && !session.serverDeafened && session.desiredMicEnabled && preferences.inputMode !== "ptt" && !room.localParticipant.isMicrophoneEnabled) {
          try {
            await enableMicrophoneWithFallback();
          } catch {
            // Listening must keep working even if no microphone can be reopened.
          }
        }
        window.dispatchEvent(new CustomEvent("ginga:voice-recovered", { detail: { channelId: activeChannelId } }));
      } catch {
        recoverAttemptsRef.current += 1;
        if (!disposed && recoverAttemptsRef.current < 5 && window.__gingaVoiceSession === session) {
          const delay = Math.min(10000, 1200 * 2 ** (recoverAttemptsRef.current - 1));
          recoverTimerRef.current = window.setTimeout(() => { void recover(); }, delay);
        } else {
          window.dispatchEvent(new CustomEvent("ginga:voice-recovery-failed", { detail: { channelId: activeChannelId } }));
        }
      } finally {
        session.recovering = false;
      }
    };

    const refresh = () => {
      setRevision((value) => value + 1);
      if (room.state === ConnectionState.Connected) void ensurePlayback();
    };
    const playParticipantSound = (kind: "join" | "leave") => {
      if (!activeGuildId || !loadNotificationPreferences().playSound) return;
      const guildPreferences = loadGuildPreferences(activeGuildId);
      if (isGuildSilent(guildPreferences) || isChannelMuted(guildPreferences, activeChannelId)) return;
      void playUiSound(kind);
    };
    const onParticipantConnected = () => {
      refresh();
      playParticipantSound("join");
    };
    const onParticipantDisconnected = () => {
      refresh();
      playParticipantSound("leave");
    };
    const onState = (next: ConnectionState) => {
      refresh();
      if (next === ConnectionState.Connected) {
        recoverAttemptsRef.current = 0;
        if (recoverTimerRef.current !== null) window.clearTimeout(recoverTimerRef.current);
        recoverTimerRef.current = null;
        void ensurePlayback();
      } else if (next === ConnectionState.Disconnected && window.__gingaVoiceSession === session) {
        if (recoverTimerRef.current !== null) window.clearTimeout(recoverTimerRef.current);
        recoverTimerRef.current = window.setTimeout(() => { void recover(); }, 900);
      }
    };
    const onActiveSpeakers = (speakers: Participant[]) => {
      dispatchSpeaking(speakers);
      setRevision((value) => value + 1);
    };
    const onLocalTrackUnpublished = () => {
      if (!session.desiredMicEnabled || preferences.inputMode !== "voice") return;
      window.setTimeout(() => { void repairMicrophone(); }, 450);
    };

    const retryPlaybackAfterGesture = () => { if (playbackBlocked) void ensurePlayback(); };
    const retryVoiceHealth = () => {
      if (disposed || window.__gingaVoiceSession !== session) return;
      if (room.state === ConnectionState.Disconnected) {
        recoverAttemptsRef.current = 0;
        if (recoverTimerRef.current !== null) window.clearTimeout(recoverTimerRef.current);
        recoverTimerRef.current = null;
        void recover();
        return;
      }
      void ensurePlayback();
      void repairMicrophone();
    };
    const onVisibility = () => { if (document.visibilityState === "visible") retryVoiceHealth(); };
    const onDeviceChange = () => { window.setTimeout(() => retryVoiceHealth(), 250); };

    room.on(RoomEvent.TrackSubscribed, refresh);
    room.on(RoomEvent.TrackUnsubscribed, refresh);
    room.on(RoomEvent.TrackMuted, refresh);
    room.on(RoomEvent.TrackUnmuted, refresh);
    room.on(RoomEvent.ParticipantConnected, onParticipantConnected);
    room.on(RoomEvent.ParticipantDisconnected, onParticipantDisconnected);
    room.on(RoomEvent.ActiveSpeakersChanged, onActiveSpeakers);
    room.on(RoomEvent.ConnectionStateChanged, onState);
    room.on(RoomEvent.LocalTrackUnpublished, onLocalTrackUnpublished);
    if (room.state === ConnectionState.Connected) {
      void ensurePlayback();
      void repairMicrophone();
    }
    micHealthTimerRef.current = window.setInterval(() => { void repairMicrophone(); }, 8_000);
    window.addEventListener("pointerdown", retryPlaybackAfterGesture, true);
    window.addEventListener("keydown", retryPlaybackAfterGesture, true);
    window.addEventListener("online", retryVoiceHealth);
    window.addEventListener("focus", retryVoiceHealth);
    document.addEventListener("visibilitychange", onVisibility);
    navigator.mediaDevices?.addEventListener?.("devicechange", onDeviceChange);
    dispatchSpeaking(room.activeSpeakers as Participant[]);

    return () => {
      disposed = true;
      if (recoverTimerRef.current !== null) window.clearTimeout(recoverTimerRef.current);
      recoverTimerRef.current = null;
      if (micHealthTimerRef.current !== null) window.clearInterval(micHealthTimerRef.current);
      micHealthTimerRef.current = null;
      room.off(RoomEvent.TrackSubscribed, refresh);
      room.off(RoomEvent.TrackUnsubscribed, refresh);
      room.off(RoomEvent.TrackMuted, refresh);
      room.off(RoomEvent.TrackUnmuted, refresh);
      room.off(RoomEvent.ParticipantConnected, onParticipantConnected);
      room.off(RoomEvent.ParticipantDisconnected, onParticipantDisconnected);
      room.off(RoomEvent.ActiveSpeakersChanged, onActiveSpeakers);
      room.off(RoomEvent.ConnectionStateChanged, onState);
      room.off(RoomEvent.LocalTrackUnpublished, onLocalTrackUnpublished);
      window.removeEventListener("pointerdown", retryPlaybackAfterGesture, true);
      window.removeEventListener("keydown", retryPlaybackAfterGesture, true);
      window.removeEventListener("online", retryVoiceHealth);
      window.removeEventListener("focus", retryVoiceHealth);
      document.removeEventListener("visibilitychange", onVisibility);
      navigator.mediaDevices?.removeEventListener?.("devicechange", onDeviceChange);
      dispatchSpeaking([]);
    };
  }, [activeChannelId, activeGuildId, room, session, preferences.inputMode, preferences.microphoneDevice, preferences.noiseSuppression]);

  const publications = useMemo(() => {
    void revision;
    if (!room || room.state !== ConnectionState.Connected) return [] as RemoteAudioPublication[];
    const result: RemoteAudioPublication[] = [];
    for (const participant of room.remoteParticipants.values()) {
      for (const publication of participant.audioTrackPublications.values()) {
        if (publication.track && !publication.isMuted && publication.source === Track.Source.Microphone) {
          result.push({ identity: participant.identity, publication: publication as TrackPublication });
        }
      }
    }
    return result;
  }, [room, revision]);

  if (!room || !activeChannelId) return null;
  return (
    <div className="persistent-voice-audio" aria-hidden="true">
      {publications.map(({ identity, publication }) => (
        <PersistentAudioTrack
          key={`${identity}:${publication.trackSid}`}
          identity={identity}
          publication={publication}
          preferences={preferences}
          deafened={deafened}
          participantVolume={participantVolumes[identity] ?? 100}
          participantMuted={Boolean(participantMutes[identity])}
        />
      ))}
    </div>
  );
}
