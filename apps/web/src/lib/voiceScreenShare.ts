import { Track, type LocalTrack, type Room } from "livekit-client";
import { loadVoicePreferences } from "./voicePreferences";

function screenShareOptions() {
  const preferences = loadVoicePreferences();
  const size = preferences.quality === "480p"
    ? { width: 854, height: 480 }
    : preferences.quality === "1080p"
      ? { width: 1920, height: 1080 }
      : { width: 1280, height: 720 };
  return {
    resolution: { ...size, frameRate: preferences.streamFps },
    audio: true,
    systemAudio: "include",
    contentHint: "motion"
  } as Record<string, unknown>;
}

export async function setVoiceScreenShare(room: Room, enabled: boolean) {
  const fn = room.localParticipant.setScreenShareEnabled as unknown as (enabled: boolean, options?: Record<string, unknown>) => Promise<unknown>;
  await fn.call(room.localParticipant, enabled, enabled ? screenShareOptions() : undefined);
  window.dispatchEvent(new CustomEvent("ginga:voice-screen-state", {
    detail: { enabled: room.localParticipant.isScreenShareEnabled }
  }));
  return room.localParticipant.isScreenShareEnabled;
}

export async function switchVoiceScreenSource(room: Room) {
  if (!room.localParticipant.isScreenShareEnabled) throw new Error("Inicie uma transmissao antes de trocar a janela.");
  if (!navigator.mediaDevices?.getDisplayMedia) throw new Error("Este cliente nao suporta troca de janela durante a transmissao.");

  const preferences = loadVoicePreferences();
  const stream = await navigator.mediaDevices.getDisplayMedia({
    video: { frameRate: { ideal: preferences.streamFps, max: preferences.streamFps } },
    audio: true
  });
  const nextVideo = stream.getVideoTracks()[0];
  if (!nextVideo) {
    stream.getTracks().forEach((track) => track.stop());
    throw new Error("Nenhuma janela ou tela foi selecionada.");
  }

  const videoPublication = Array.from(room.localParticipant.videoTrackPublications.values())
    .find((publication) => publication.source === Track.Source.ScreenShare && publication.track);
  if (!videoPublication?.track) {
    stream.getTracks().forEach((track) => track.stop());
    throw new Error("A transmissao atual nao esta disponivel para troca.");
  }

  const nextAudio = stream.getAudioTracks()[0];
  const audioPublication = Array.from(room.localParticipant.audioTrackPublications.values())
    .find((publication) => publication.source === Track.Source.ScreenShareAudio && publication.track);

  try {
    await (videoPublication.track as LocalTrack).replaceTrack(nextVideo, false);

    if (nextAudio && audioPublication?.track) {
      await (audioPublication.track as LocalTrack).replaceTrack(nextAudio, false);
    } else if (nextAudio && !audioPublication?.track) {
      await room.localParticipant.publishTrack(nextAudio, { source: Track.Source.ScreenShareAudio });
    } else if (!nextAudio && audioPublication?.track) {
      await room.localParticipant.unpublishTrack(audioPublication.track, true);
    }

    // Qualquer faixa que nao passou a pertencer ao LiveKit pode ser descartada.
    for (const track of stream.getTracks()) {
      if (track === nextVideo || track === nextAudio) continue;
      track.stop();
    }
    window.dispatchEvent(new CustomEvent("ginga:voice-screen-source-changed", { detail: { enabled: true } }));
  } catch (error) {
    // Se a substituicao falhar, nao derrube a transmissao atual.
    stream.getTracks().forEach((track) => track.stop());
    throw error;
  }
}
