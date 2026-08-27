import { useEffect, useRef, useState } from "react";
import { Check, LoaderCircle, Mic, Trash2 } from "lucide-react";

interface VoiceMessageRecorderProps {
  disabled?: boolean;
  onSendFile: (file: File) => Promise<void>;
}

type RecorderState = "idle" | "recording" | "preview" | "sending";
const MAX_RECORDING_SECONDS = 5 * 60;

function formatDuration(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(rest).padStart(2, "0")}`;
}

function preferredMimeType() {
  const candidates = ["audio/webm;codecs=opus", "audio/ogg;codecs=opus", "audio/webm"];
  return candidates.find((type) => typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(type)) || "";
}

export function VoiceMessageRecorder({ disabled = false, onSendFile }: VoiceMessageRecorderProps) {
  const [state, setState] = useState<RecorderState>("idle");
  const [seconds, setSeconds] = useState(0);
  const [error, setError] = useState("");
  const [previewUrl, setPreviewUrl] = useState("");
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const blobRef = useRef<Blob | null>(null);
  const timerRef = useRef<number | null>(null);
  const cancelledRef = useRef(false);

  function clearTimer() {
    if (timerRef.current !== null) window.clearInterval(timerRef.current);
    timerRef.current = null;
  }

  function stopStream() {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }

  function clearPreview() {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl("");
    blobRef.current = null;
    chunksRef.current = [];
  }

  useEffect(() => () => {
    clearTimer();
    stopStream();
    if (previewUrl) URL.revokeObjectURL(previewUrl);
  }, [previewUrl]);

  async function startRecording() {
    if (disabled || state !== "idle") return;
    setError("");
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setError("Gravacao de voz nao esta disponivel neste navegador.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false });
      const mimeType = preferredMimeType();
      const recorder = mimeType ? new MediaRecorder(stream, { mimeType, audioBitsPerSecond: 96000 }) : new MediaRecorder(stream);
      streamRef.current = stream;
      recorderRef.current = recorder;
      chunksRef.current = [];
      cancelledRef.current = false;
      setSeconds(0);
      setState("recording");
      recorder.ondataavailable = (event) => { if (event.data.size > 0) chunksRef.current.push(event.data); };
      recorder.onstop = () => {
        stopStream();
        clearTimer();
        if (cancelledRef.current) { chunksRef.current = []; setState("idle"); return; }
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || "audio/webm" });
        if (!blob.size) { setError("A gravacao ficou vazia. Tente novamente."); setState("idle"); return; }
        blobRef.current = blob;
        const url = URL.createObjectURL(blob);
        setPreviewUrl(url);
        setState("preview");
      };
      recorder.start(250);
      timerRef.current = window.setInterval(() => {
        setSeconds((value) => {
          const next = value + 1;
          if (next >= MAX_RECORDING_SECONDS) window.setTimeout(() => finishRecording(), 0);
          return Math.min(MAX_RECORDING_SECONDS, next);
        });
      }, 1000);
    } catch (caught) {
      stopStream();
      setState("idle");
      setError(caught instanceof Error ? caught.message : "Nao foi possivel acessar o microfone.");
    }
  }

  function finishRecording() {
    if (recorderRef.current?.state === "recording") recorderRef.current.stop();
  }

  function cancelRecording() {
    cancelledRef.current = true;
    clearTimer();
    if (recorderRef.current?.state === "recording") recorderRef.current.stop();
    else { stopStream(); clearPreview(); setState("idle"); }
  }

  async function sendRecording() {
    const blob = blobRef.current;
    if (!blob || state !== "preview") return;
    setState("sending");
    setError("");
    try {
      const extension = blob.type.includes("ogg") ? "ogg" : "webm";
      const normalizedMime = (blob.type || `audio/${extension}`).split(";")[0];
      const file = new File([blob], `ginga-voice-${Date.now()}.${extension}`, { type: normalizedMime });
      await onSendFile(file);
      clearPreview();
      setSeconds(0);
      setState("idle");
    } catch (caught) {
      setState("preview");
      setError(caught instanceof Error ? caught.message : "Nao foi possivel enviar a mensagem de voz.");
    }
  }

  if (state === "idle") return <div className="voice-recorder-slot"><button type="button" className="composer-voice-button" disabled={disabled} onClick={() => void startRecording()} aria-label="Gravar mensagem de voz"><Mic size={19}/></button>{error && <span className="voice-recorder-error">{error}</span>}</div>;

  return <div className={`voice-message-recorder state-${state}`}>
    {state === "recording" && <><span className="voice-recording-dot"/><strong>Gravando</strong><time>{formatDuration(seconds)}</time><span className="voice-recorder-limit">max. 05:00</span><button type="button" className="voice-recorder-cancel" onClick={cancelRecording}><Trash2 size={16}/> Cancelar</button><button type="button" className="voice-recorder-finish" onClick={finishRecording}><Check size={16}/> Concluir</button></>}
    {state === "preview" && <><div className="voice-recorder-preview-copy"><strong>Mensagem de voz</strong><span>{formatDuration(seconds)}</span></div><audio src={previewUrl} controls preload="metadata"/><button type="button" className="voice-recorder-cancel" onClick={cancelRecording}><Trash2 size={16}/> Descartar</button><button type="button" className="voice-recorder-send" onClick={() => void sendRecording()}><Check size={16}/> Enviar</button></>}
    {state === "sending" && <><LoaderCircle className="spin" size={18}/><strong>Enviando mensagem de voz...</strong></>}
    {error && <span className="voice-recorder-error">{error}</span>}
  </div>;
}
