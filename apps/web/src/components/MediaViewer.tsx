import { useEffect, useMemo, useState, type MouseEvent } from "react";
import { Download, ExternalLink, FileAudio, FileText, Image as ImageIcon, RotateCcw, Video, X, ZoomIn, ZoomOut } from "lucide-react";
import type { Attachment } from "../types";
import { AudioPlayer } from "./AudioPlayer";

interface MediaViewerProps {
  attachment: Attachment;
  onClose: () => void;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function safeDownloadName(value: string) {
  return value.replace(/[\\/:*?"<>|]+/g, "-").trim() || "arquivo";
}

function mediaKind(mimeType: string): "image" | "video" | "audio" | "pdf" | "file" {
  if (mimeType.startsWith("image/")) return "image";
  if (mimeType.startsWith("video/")) return "video";
  if (mimeType.startsWith("audio/")) return "audio";
  if (mimeType === "application/pdf") return "pdf";
  return "file";
}

function KindIcon({ kind }: { kind: ReturnType<typeof mediaKind> }) {
  if (kind === "image") return <ImageIcon size={17} />;
  if (kind === "video") return <Video size={17} />;
  if (kind === "audio") return <FileAudio size={17} />;
  return <FileText size={17} />;
}

export function MediaViewer({ attachment, onClose }: MediaViewerProps) {
  const kind = mediaKind(attachment.mimeType);
  const [zoom, setZoom] = useState(1);
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState("");
  const zoomPercent = useMemo(() => Math.round(zoom * 100), [zoom]);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
      if (kind !== "image") return;
      if ((event.ctrlKey || event.metaKey) && (event.key === "+" || event.key === "=")) {
        event.preventDefault();
        setZoom((value) => Math.min(3, Number((value + 0.25).toFixed(2))));
      }
      if ((event.ctrlKey || event.metaKey) && event.key === "-") {
        event.preventDefault();
        setZoom((value) => Math.max(0.5, Number((value - 0.25).toFixed(2))));
      }
      if ((event.ctrlKey || event.metaKey) && event.key === "0") {
        event.preventDefault();
        setZoom(1);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [kind, onClose]);

  async function downloadAttachment() {
    if (downloading) return;
    setDownloading(true);
    setError("");
    try {
      const response = await fetch(attachment.url, { credentials: "same-origin", cache: "no-store" });
      if (!response.ok) throw new Error("Nao foi possivel baixar o arquivo.");
      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      try {
        const link = document.createElement("a");
        link.href = objectUrl;
        link.download = safeDownloadName(attachment.originalName);
        link.rel = "noopener";
        document.body.appendChild(link);
        link.click();
        link.remove();
      } finally {
        window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Nao foi possivel baixar o arquivo.");
    } finally {
      setDownloading(false);
    }
  }

  function stopFrameClick(event: MouseEvent<HTMLElement>) {
    event.stopPropagation();
  }

  return (
    <div className="image-viewer-backdrop media-viewer-backdrop" role="presentation" onMouseDown={onClose}>
      <section className={`image-viewer media-viewer media-viewer-${kind}`} role="dialog" aria-modal="true" aria-label={`Visualizando ${attachment.originalName}`} onMouseDown={stopFrameClick}>
        <header className="image-viewer-header">
          <div className="image-viewer-title">
            <span className="image-viewer-file-icon"><KindIcon kind={kind} /></span>
            <div><strong>{attachment.originalName}</strong><span>{formatBytes(attachment.size)} · {attachment.mimeType}</span></div>
          </div>
          <div className="image-viewer-actions">
            {kind === "image" && <>
              <button type="button" onClick={() => setZoom((value) => Math.max(0.5, Number((value - 0.25).toFixed(2))))} disabled={zoom <= 0.5} aria-label="Diminuir zoom"><ZoomOut size={18} /></button>
              <span className="image-viewer-zoom">{zoomPercent}%</span>
              <button type="button" onClick={() => setZoom((value) => Math.min(3, Number((value + 0.25).toFixed(2))))} disabled={zoom >= 3} aria-label="Aumentar zoom"><ZoomIn size={18} /></button>
              <button type="button" onClick={() => setZoom(1)} disabled={zoom === 1} aria-label="Restaurar zoom"><RotateCcw size={17} /></button>
              <span className="image-viewer-divider" />
            </>}
            <button type="button" onClick={() => window.open(attachment.url, "_blank", "noopener,noreferrer")} aria-label="Abrir arquivo original"><ExternalLink size={18} /></button>
            <button type="button" className="image-viewer-download" onClick={() => void downloadAttachment()} disabled={downloading}><Download size={18} /> <span>{downloading ? "Baixando" : "Baixar"}</span></button>
            <button type="button" className="image-viewer-close" onClick={onClose} aria-label="Fechar visualizador"><X size={20} /></button>
          </div>
        </header>

        <div className="image-viewer-stage media-viewer-stage">
          {kind === "image" && <div className="image-viewer-canvas"><img src={attachment.url} alt={attachment.originalName} draggable={false} style={{ transform: `scale(${zoom})` }} /></div>}
          {kind === "video" && <div className="media-viewer-video-wrap"><video src={attachment.url} controls autoFocus playsInline preload="metadata" /></div>}
          {kind === "audio" && <div className="media-viewer-audio-wrap"><span className="media-viewer-audio-icon"><FileAudio size={34}/></span><div><strong>{attachment.originalName.startsWith("ginga-voice-") ? "Mensagem de voz" : attachment.originalName}</strong><span>Reproduza sem sair da conversa.</span></div><AudioPlayer src={attachment.url} title={attachment.originalName.startsWith("ginga-voice-") ? "Mensagem de voz" : attachment.originalName} /></div>}
          {kind === "pdf" && <iframe className="media-viewer-pdf" src={attachment.url} title={attachment.originalName} />}
          {kind === "file" && <div className="media-viewer-generic"><FileText size={42}/><strong>{attachment.originalName}</strong><span>Este formato nao possui visualizacao integrada.</span><button type="button" className="primary-button" onClick={() => void downloadAttachment()}><Download size={16}/> Baixar arquivo</button></div>}
        </div>

        <footer className="image-viewer-footer"><span>ESC para fechar</span>{kind === "image" && <span>Ctrl + / - para zoom</span>}{error && <strong>{error}</strong>}</footer>
      </section>
    </div>
  );
}
