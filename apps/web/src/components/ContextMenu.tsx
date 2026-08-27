import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

interface ContextMenuProps {
  x: number;
  y: number;
  onClose: () => void;
  children: ReactNode;
}

const EDGE_GAP = 8;

export function ContextMenu({ x, y, onClose, children }: ContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: x, top: y, ready: false });

  useLayoutEffect(() => {
    const menu = menuRef.current;
    if (!menu) return;
    const place = () => {
      const rect = menu.getBoundingClientRect();
      const maxLeft = Math.max(EDGE_GAP, window.innerWidth - rect.width - EDGE_GAP);
      const maxTop = Math.max(EDGE_GAP, window.innerHeight - rect.height - EDGE_GAP);
      const next = {
        left: Math.max(EDGE_GAP, Math.min(x, maxLeft)),
        top: Math.max(EDGE_GAP, Math.min(y, maxTop)),
        ready: true
      };
      setPosition((current) => current.left === next.left && current.top === next.top && current.ready
        ? current
        : next);
    };
    place();
    const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(place) : null;
    observer?.observe(menu);
    return () => observer?.disconnect();
  }, [x, y]);

  useEffect(() => {
    const close = () => onClose();
    const keydown = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("pointerdown", close);
    window.addEventListener("blur", close);
    window.addEventListener("resize", close);
    window.addEventListener("keydown", keydown);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("blur", close);
      window.removeEventListener("resize", close);
      window.removeEventListener("keydown", keydown);
    };
  }, [onClose]);

  return createPortal(
    <div
      ref={menuRef}
      className="nexora-context-menu"
      style={{
        left: position.left,
        top: position.top,
        visibility: position.ready ? "visible" : "hidden",
        maxHeight: `calc(100vh - ${EDGE_GAP * 2}px)`,
        overflowY: "auto"
      }}
      onPointerDown={(event) => event.stopPropagation()}
      onContextMenu={(event) => event.preventDefault()}
      role="menu"
    >
      {children}
    </div>,
    document.body
  );
}
