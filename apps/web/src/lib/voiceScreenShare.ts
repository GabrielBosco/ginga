import { Track, type LocalTrack, type Room, type ScreenShareCaptureOptions, type TrackPublishOptions } from "livekit-client";
import { loadVoicePreferences, type StreamQuality } from "./voicePreferences";

const qualitySize: Record<StreamQuality, { width: number; height: number }> = {
  "480p": { width: 854, height: 480 },
  "720p": { width: 1280, height: 720 },
  "1080p": { width: 1920, height: 1080 }
};

function screenShareBitrate(quality: StreamQuality, fps: 15 | 30 | 60) {
  const base = quality === "480p" ? 1_800_000 : quality === "720p" ? 4_000_000 : 7_000_000;
  if (fps >= 60) return Math.round(base * (quality === "1080p" ? 1.7 : 1.55));
  if (fps <= 15) return Math.round(base * 0.68);
  return base;
}

export function screenShareCaptureOptions(): ScreenShareCaptureOptions {
  const preferences = loadVoicePreferences();
  const size = qualitySize[preferences.quality];
  return {
    resolution: { ...size, frameRate: preferences.streamFps },
    audio: true,
    systemAudio: "include",
    contentHint: "motion"
  };
}

export function screenSharePublishOptions(): TrackPublishOptions {
  const preferences = loadVoicePreferences();
  return {
    // Para jogos, animacoes e video na tela, manter o frame rate e mais importante
    // do que congelar quadros para preservar cada pixel da resolucao nominal.
    degradationPreference: "maintain-framerate",
    videoCodec: "vp8",
    screenShareEncoding: {
      maxBitrate: screenShareBitrate(preferences.quality, preferences.streamFps),
      maxFramerate: preferences.streamFps,
      priority: "high"
    }
  };
}

export async function setVoiceScreenShare(room: Room, enabled: boolean) {
  const fn = room.localParticipant.setScreenShareEnabled.bind(room.localParticipant);
  await fn(
    enabled,
    enabled ? screenShareCaptureOptions() : undefined,
    enabled ? screenSharePublishOptions() : undefined
  );
  window.dispatchEvent(new CustomEvent("ginga:voice-screen-state", {
    detail: { enabled: room.localParticipant.isScreenShareEnabled }
  }));
  return room.localParticipant.isScreenShareEnabled;
}

export async function switchVoiceScreenSource(room: Room) {
  if (!room.localParticipant.isScreenShareEnabled) throw new Error("Inicie uma transmissao antes de trocar a janela.");
  if (!navigator.mediaDevices?.getDisplayMedia) throw new Error("Este cliente nao suporta troca de janela durante a transmissao.");

  const preferences = loadVoicePreferences();
  const size = qualitySize[preferences.quality];
  const stream = await navigator.mediaDevices.getDisplayMedia({
    video: {
      width: { ideal: size.width },
      height: { ideal: size.height },
      frameRate: { ideal: preferences.streamFps, max: preferences.streamFps }
    },
    audio: true
  });
  const nextVideo = stream.getVideoTracks()[0];
  if (!nextVideo) {
    stream.getTracks().forEach((track) => track.stop());
    throw new Error("Nenhuma janela ou tela foi selecionada.");
  }

  try { nextVideo.contentHint = "motion"; } catch {}
  try {
    await nextVideo.applyConstraints({
      width: { ideal: size.width },
      height: { ideal: size.height },
      frameRate: { ideal: preferences.streamFps, max: preferences.streamFps }
    });
  } catch {
    // Alguns capturadores de janela ignoram width/height. O track continua valido.
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
    const localVideo = videoPublication.videoTrack;
    if (localVideo && "setDegradationPreference" in localVideo) {
      await localVideo.setDegradationPreference("maintain-framerate").catch(() => undefined);
    }

    if (nextAudio && audioPublication?.track) {
      await (audioPublication.track as LocalTrack).replaceTrack(nextAudio, false);
    } else if (nextAudio && !audioPublication?.track) {
      await room.localParticipant.publishTrack(nextAudio, { source: Track.Source.ScreenShareAudio, dtx: false, red: true });
    } else if (!nextAudio && audioPublication?.track) {
      await room.localParticipant.unpublishTrack(audioPublication.track, true);
    }

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
