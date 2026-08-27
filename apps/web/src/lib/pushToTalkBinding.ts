export type PushToTalkBinding = string;

const CODE_LABELS: Record<string, string> = {
  Space: "Espaco",
  Enter: "Enter",
  Tab: "Tab",
  Escape: "Esc",
  Backspace: "Backspace",
  Delete: "Delete",
  Insert: "Insert",
  Home: "Home",
  End: "End",
  PageUp: "Page Up",
  PageDown: "Page Down",
  ArrowUp: "Seta para cima",
  ArrowDown: "Seta para baixo",
  ArrowLeft: "Seta para esquerda",
  ArrowRight: "Seta para direita",
  CapsLock: "Caps Lock",
  NumLock: "Num Lock",
  ScrollLock: "Scroll Lock",
  ShiftLeft: "Shift esquerdo",
  ShiftRight: "Shift direito",
  ControlLeft: "Ctrl esquerdo",
  ControlRight: "Ctrl direito",
  AltLeft: "Alt esquerdo",
  AltRight: "Alt direito",
  MetaLeft: "Windows esquerdo",
  MetaRight: "Windows direito",
  ContextMenu: "Menu",
  NumpadAdd: "Num +",
  NumpadSubtract: "Num -",
  NumpadMultiply: "Num *",
  NumpadDivide: "Num /",
  NumpadDecimal: "Num .",
  NumpadEnter: "Num Enter"
};

/**
 * O binding usa KeyboardEvent.code quando disponivel para representar a tecla
 * fisica (independente de layout). Teclas sem code recebem o prefixo KeyValue:.
 * Botoes do mouse seguem a convencao Mouse1..MouseN.
 */
export function bindingFromKeyboardEvent(event: KeyboardEvent): PushToTalkBinding | null {
  const code = String(event.code || "").trim();
  if (code && code !== "Unidentified") return code;
  const key = String(event.key || "").trim();
  return key ? `KeyValue:${key}` : null;
}

export function bindingFromMouseEvent(event: MouseEvent): PushToTalkBinding | null {
  if (!Number.isInteger(event.button) || event.button < 0) return null;
  // Convencao usada por jogos: Mouse1=esquerdo, Mouse2=direito,
  // Mouse3=meio, Mouse4/5=laterais. O DOM usa 1=meio e 2=direito.
  const logical = event.button === 0 ? 1 : event.button === 2 ? 2 : event.button === 1 ? 3 : event.button + 1;
  return `Mouse${logical}`;
}

export function mouseButtonFromBinding(binding: PushToTalkBinding): number | null {
  const match = /^Mouse(\d+)$/.exec(binding);
  if (!match) return null;
  const logical = Number(match[1]);
  if (!Number.isInteger(logical) || logical < 1) return null;
  if (logical === 1) return 0;
  if (logical === 2) return 2;
  if (logical === 3) return 1;
  return logical - 1;
}

export function keyboardEventMatchesBinding(binding: PushToTalkBinding, event: KeyboardEvent): boolean {
  if (binding.startsWith("Mouse")) return false;
  if (binding.startsWith("KeyValue:")) return event.key === binding.slice("KeyValue:".length);
  return event.code === binding;
}

export function formatPushToTalkBinding(binding: PushToTalkBinding): string {
  const mouse = /^Mouse(\d+)$/.exec(binding);
  if (mouse) {
    const number = Number(mouse[1]);
    if (number === 1) return "Mouse 1 (esquerdo)";
    if (number === 2) return "Mouse 2 (direito)";
    if (number === 3) return "Mouse 3 (meio)";
    return `Mouse ${number}`;
  }
  if (binding.startsWith("KeyValue:")) return binding.slice("KeyValue:".length) || "Tecla";
  if (CODE_LABELS[binding]) return CODE_LABELS[binding];
  if (/^Key[A-Z]$/.test(binding)) return binding.slice(3);
  if (/^Digit\d$/.test(binding)) return binding.slice(5);
  if (/^Numpad\d$/.test(binding)) return `Num ${binding.slice(6)}`;
  if (/^F(?:[1-9]|1\d|2[0-4])$/.test(binding)) return binding;
  return binding.replace(/([a-z])([A-Z])/g, "$1 $2");
}

export function isMouseBinding(binding: PushToTalkBinding): boolean {
  return /^Mouse\d+$/.test(binding);
}
