/** Copia texto mesmo quando o Ginga esta em HTTP interno/Electron e a Clipboard API nao esta disponivel. */
export async function copyTextToClipboard(value: string) {
  const text = String(value ?? "");
  if (!text) return;
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return;
    }
  } catch {
    // Em contexto HTTP a Clipboard API pode existir e ainda assim recusar. Usa fallback abaixo.
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  textarea.style.top = "0";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();
  textarea.setSelectionRange(0, text.length);
  const copied = document.execCommand("copy");
  textarea.remove();
  if (!copied) throw new Error("A area de transferencia nao esta disponivel neste contexto.");
}
