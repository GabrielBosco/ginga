import { Bold, Code2, Italic, Link2, Strikethrough, Underline } from "lucide-react";
import type { KeyboardEvent, RefObject } from "react";

export type MessageFormat = "bold" | "italic" | "underline" | "strike" | "code" | "link";

interface FormattingTarget {
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  value: string;
  onChange: (value: string) => void;
}

interface MessageFormattingToolbarProps extends FormattingTarget {
  active?: boolean;
}

function formatDefinition(kind: Exclude<MessageFormat, "link">) {
  if (kind === "bold") return { prefix: "**", suffix: "**", placeholder: "texto em negrito" };
  if (kind === "italic") return { prefix: "*", suffix: "*", placeholder: "texto em italico" };
  if (kind === "underline") return { prefix: "__", suffix: "__", placeholder: "texto sublinhado" };
  if (kind === "strike") return { prefix: "~~", suffix: "~~", placeholder: "texto riscado" };
  return { prefix: "`", suffix: "`", placeholder: "codigo" };
}

export function applyMessageFormat(kind: MessageFormat, target: FormattingTarget) {
  const textarea = target.textareaRef.current;
  if (!textarea) return;
  const start = textarea.selectionStart ?? target.value.length;
  const end = textarea.selectionEnd ?? start;
  const selected = target.value.slice(start, end);

  let replacement = "";
  let selectionStart = start;
  let selectionEnd = end;

  if (kind === "link") {
    const label = selected || "texto do link";
    replacement = `[${label}](https://)`;
    if (selected) {
      selectionStart = start + label.length + 3;
      selectionEnd = selectionStart + "https://".length;
    } else {
      selectionStart = start + 1;
      selectionEnd = selectionStart + label.length;
    }
  } else {
    const { prefix, suffix, placeholder } = formatDefinition(kind);
    const body = selected || placeholder;
    replacement = `${prefix}${body}${suffix}`;
    selectionStart = start + prefix.length;
    selectionEnd = selectionStart + body.length;
  }

  const next = `${target.value.slice(0, start)}${replacement}${target.value.slice(end)}`;
  target.onChange(next);
  requestAnimationFrame(() => {
    textarea.focus();
    textarea.setSelectionRange(selectionStart, selectionEnd);
  });
}

export function handleMessageFormatShortcut(event: KeyboardEvent<HTMLTextAreaElement>, target: FormattingTarget) {
  if (!(event.ctrlKey || event.metaKey) || event.altKey) return false;
  const key = event.key.toLowerCase();
  let format: MessageFormat | null = null;
  if (key === "b") format = "bold";
  else if (key === "i") format = "italic";
  else if (key === "u") format = "underline";
  else if (key === "k") format = "link";
  else if (key === "e") format = "code";
  if (!format) return false;
  event.preventDefault();
  applyMessageFormat(format, target);
  return true;
}

export function MessageFormattingToolbar({ textareaRef, value, onChange, active = false }: MessageFormattingToolbarProps) {
  const action = (kind: MessageFormat) => applyMessageFormat(kind, { textareaRef, value, onChange });
  return <div className={`message-format-toolbar ${active ? "is-visible" : ""}`} role="toolbar" aria-label="Formatacao da mensagem" aria-hidden={!active}>
    <button type="button" onMouseDown={(event)=>event.preventDefault()} onClick={()=>action("bold")} title="Negrito (Ctrl+B)" aria-label="Negrito"><Bold size={15}/></button>
    <button type="button" onMouseDown={(event)=>event.preventDefault()} onClick={()=>action("italic")} title="Italico (Ctrl+I)" aria-label="Italico"><Italic size={15}/></button>
    <button type="button" onMouseDown={(event)=>event.preventDefault()} onClick={()=>action("underline")} title="Sublinhado (Ctrl+U)" aria-label="Sublinhado"><Underline size={15}/></button>
    <button type="button" onMouseDown={(event)=>event.preventDefault()} onClick={()=>action("strike")} title="Riscado" aria-label="Riscado"><Strikethrough size={15}/></button>
    <button type="button" onMouseDown={(event)=>event.preventDefault()} onClick={()=>action("code")} title="Codigo (Ctrl+E)" aria-label="Codigo"><Code2 size={15}/></button>
    <button type="button" onMouseDown={(event)=>event.preventDefault()} onClick={()=>action("link")} title="Link (Ctrl+K)" aria-label="Inserir link"><Link2 size={15}/></button>
    <span className="message-format-help">**negrito** · *italico* · __sublinhado__ · `codigo`</span>
  </div>;
}
