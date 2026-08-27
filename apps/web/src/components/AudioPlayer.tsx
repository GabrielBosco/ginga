import { useEffect, useRef, useState, type CSSProperties } from "react";
import { Pause, Play, Volume2, VolumeX } from "lucide-react";

interface AudioPlayerProps {
  src: string;
  title?: string;
  compact?: boolean;
}

function formatTime(value: number) {
  if (!Number.isFinite(value) || value < 0) return "0:00";
  const total = Math.floor(value);
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

export function AudioPlayer({ src, title = "Audio", compact = false }: AudioPlayerProps) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [volume, setVolume] = useState(0.9);
  const [muted, setMuted] = useState(false);

  useEffect(() => {
    setPlaying(false);
    setCurrentTime(0);
    setDuration(0);
  }, [src]);

  async function togglePlay() {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) {
      try { await audio.play(); } catch { /* O navegador pode exigir nova interacao. */ }
    } else {
      audio.pause();
    }
  }

  function seek(value: number) {
    const audio = audioRef.current;
    if (!audio) return;
    audio.currentTime = value;
    setCurrentTime(value);
  }

  function changeVolume(value: number) {
    const audio = audioRef.current;
    if (!audio) return;
    const safeVolume = Math.max(0, Math.min(1, Number(value) || 0));
    audio.volume = safeVolume;
    audio.muted = false;
    setVolume(safeVolume);
    setMuted(false);
  }

  function toggleMute() {
    const audio = audioRef.current;
    if (!audio) return;
    audio.muted = !audio.muted;
    setMuted(audio.muted);
  }

  const progress = duration > 0 ? (currentTime / duration) * 100 : 0;

  return (
    <div className={`ginga-audio-player ${compact ? "compact" : ""}`}>
      <audio
        ref={audioRef}
        src={src}
        preload="metadata"
        onLoadedMetadata={(event) => setDuration(event.currentTarget.duration || 0)}
        onDurationChange={(event) => setDuration(event.currentTarget.duration || 0)}
        onTimeUpdate={(event) => setCurrentTime(event.currentTarget.currentTime || 0)}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => { setPlaying(false); setCurrentTime(0); }}
      />
      <button type="button" className="ginga-audio-play" onClick={() => void togglePlay()} aria-label={playing ? `Pausar ${title}` : `Reproduzir ${title}`}>
        {playing ? <Pause size={17} fill="currentColor"/> : <Play size={17} fill="currentColor"/>}
      </button>
      <div className="ginga-audio-main">
        <div className="ginga-audio-progress-wrap">
          <input
            className="ginga-audio-progress"
            type="range"
            min={0}
            max={Math.max(duration, 0.01)}
            step={0.05}
            value={Math.min(currentTime, Math.max(duration, 0.01))}
            onChange={(event) => seek(Number(event.target.value))}
            aria-label="Posicao do audio"
            style={{ "--audio-progress": `${progress}%` } as CSSProperties}
          />
        </div>
        <div className="ginga-audio-time"><span>{formatTime(currentTime)}</span><span>{formatTime(duration)}</span></div>
      </div>
      <div className="ginga-audio-volume">
        <button type="button" onClick={toggleMute} aria-label={muted ? "Ativar som" : "Silenciar audio"}>{muted || volume === 0 ? <VolumeX size={16}/> : <Volume2 size={16}/>}</button>
        {!compact && <input type="range" min={0} max={1} step={0.05} value={muted ? 0 : volume} onChange={(event) => changeVolume(Number(event.target.value))} aria-label="Volume"/>}
      </div>
    </div>
  );
}
