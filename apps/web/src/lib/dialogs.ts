type DialogTone = "default" | "warning" | "danger";
type DialogOptions = { title?: string; confirmLabel?: string; cancelLabel?: string; tone?: DialogTone; placeholder?: string };

function createDialog(message: string, options: DialogOptions & { input?: boolean; defaultValue?: string }) {
  return new Promise<string | boolean | null>((resolve) => {
    if (typeof document === "undefined") return resolve(options.input ? null : false);
    const backdrop = document.createElement("div");
    backdrop.className = "ginga-dialog-backdrop";
    const dialog = document.createElement("section");
    dialog.className = `ginga-dialog tone-${options.tone ?? "default"}`;
    dialog.setAttribute("role", options.tone === "danger" ? "alertdialog" : "dialog");
    dialog.setAttribute("aria-modal", "true");

    const heading = document.createElement("div");
    heading.className = "ginga-dialog-copy";
    const eyebrow = document.createElement("small");
    eyebrow.textContent = options.tone === "danger" ? "CONFIRMACAO" : options.input ? "INFORME O VALOR" : "CONFIRMAR ACAO";
    const title = document.createElement("h2");
    title.textContent = options.title ?? (options.input ? "Continuar" : "Confirmar");
    const body = document.createElement("p");
    body.textContent = message;
    heading.append(eyebrow, title, body);
    dialog.append(heading);

    let input: HTMLInputElement | null = null;
    if (options.input) {
      input = document.createElement("input");
      input.className = "ginga-dialog-input";
      input.value = options.defaultValue ?? "";
      input.placeholder = options.placeholder ?? "";
      input.maxLength = 240;
      dialog.append(input);
    }

    const actions = document.createElement("div");
    actions.className = "ginga-dialog-actions";
    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.className = "secondary-button";
    cancel.textContent = options.cancelLabel ?? "Cancelar";
    const confirm = document.createElement("button");
    confirm.type = "button";
    confirm.className = options.tone === "danger" ? "danger-button" : "primary-button";
    confirm.textContent = options.confirmLabel ?? (options.input ? "Salvar" : "Confirmar");
    actions.append(cancel, confirm);
    dialog.append(actions);
    backdrop.append(dialog);
    document.body.append(backdrop);

    const cleanup = (value: string | boolean | null) => {
      document.removeEventListener("keydown", onKeyDown, true);
      backdrop.remove();
      resolve(value);
    };
    const submit = () => {
      if (input) cleanup(input.value);
      else cleanup(true);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); cleanup(options.input ? null : false); }
      if (event.key === "Enter" && (!input || document.activeElement === input)) { event.preventDefault(); submit(); }
    };
    document.addEventListener("keydown", onKeyDown, true);
    backdrop.addEventListener("mousedown", (event) => { if (event.target === backdrop) cleanup(options.input ? null : false); });
    dialog.addEventListener("mousedown", (event) => event.stopPropagation());
    cancel.addEventListener("click", () => cleanup(options.input ? null : false));
    confirm.addEventListener("click", submit);
    window.setTimeout(() => (input ?? confirm).focus(), 0);
    if (input) input.select();
  });
}

export async function gingaConfirm(message: string, options: DialogOptions = {}) {
  return Boolean(await createDialog(message, options));
}

export async function gingaPrompt(message: string, defaultValue = "", options: DialogOptions = {}) {
  const result = await createDialog(message, { ...options, input: true, defaultValue });
  return typeof result === "string" ? result : null;
}
