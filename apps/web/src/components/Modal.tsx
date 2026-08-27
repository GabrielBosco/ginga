import { useEffect, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

interface ModalProps {
  title: string;
  children: ReactNode;
  onClose: () => void;
  width?: "sm" | "md" | "lg";
}

export function Modal({ title, children, onClose, width = "md" }: ModalProps) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const content = (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <section className={`modal-card modal-${width}`} role="dialog" aria-modal="true" aria-label={title}>
        <header className="modal-header">
          <h2>{title}</h2>
          <button className="icon-button" onClick={onClose} aria-label="Fechar">
            <X size={19} />
          </button>
        </header>
        <div className="modal-body">{children}</div>
      </section>
    </div>
  );

  return createPortal(content, document.body);
}
