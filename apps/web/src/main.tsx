import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { AppErrorBoundary } from "./components/AppErrorBoundary";
import "./styles.css";
import "./remember-device.css";
import "./ui-audit-pass.css";
import "./v090.css";
import "./ui-foundation-v043.css";
import "./ui-release-v043.css";
import "./ui-rc5-v043.css";
import "./ui-rc6-v043.css";
import "./ui-rc7-v043.css";
import "./ui-rc8-v043.css";
import "./ui-rc9-v043.css";
import "./ui-hotfix-v045.css";
import "./ui-v046.css";
import "./ui-v047.css";
import "./ui-v047-final.css";
import "./auth-v047.css";
import "./auth-v047-r2.css";
import "./auth-v047-r3.css";
import "./ui-v048-viewport-fit.css";
import "./ui-v048-responsive-final.css";
import "./auth-v048-redesign.css";
import "./ui-packfix-20260901.css";

type DesktopRuntimeLogger = { logRuntime?: (payload: unknown) => Promise<unknown> | unknown };

function desktopRuntimeLogger(): DesktopRuntimeLogger | undefined {
  return (window as unknown as { gingaDesktop?: DesktopRuntimeLogger }).gingaDesktop;
}

function safeErrorText(value: unknown) {
  if (value instanceof Error) return { message: value.message, stack: value.stack || "" };
  if (typeof value === "string") return { message: value };
  try { return { message: JSON.stringify(value) }; } catch { return { message: String(value) }; }
}

let lastRuntimeWarningAt = 0;
let lastRuntimeWarningFingerprint = "";

function reportRuntimeError(kind: string, value: unknown) {
  const safe = safeErrorText(value);
  const payload = { kind, at: new Date().toISOString(), ...safe };
  console.error(`[Ginga:${kind}]`, value);
  try { void desktopRuntimeLogger()?.logRuntime?.(payload); } catch { /* best effort */ }

  if (kind === "react-boundary") return;
  const fingerprint = `${kind}:${safe.message}`.slice(0, 500);
  const now = Date.now();
  if (fingerprint === lastRuntimeWarningFingerprint && now - lastRuntimeWarningAt < 12_000) return;
  lastRuntimeWarningFingerprint = fingerprint;
  lastRuntimeWarningAt = now;
  try {
    window.dispatchEvent(new CustomEvent("ginga:runtime-warning", { detail: { kind } }));
  } catch { /* warning visual e best-effort */ }
}

window.addEventListener("error", (event) => {
  reportRuntimeError("window-error", event.error || `${event.message} @ ${event.filename}:${event.lineno}:${event.colno}`);
});
window.addEventListener("unhandledrejection", (event) => reportRuntimeError("unhandled-rejection", event.reason));
window.addEventListener("ginga:runtime-error", (event) => reportRuntimeError("react-boundary", (event as CustomEvent).detail));

const rootElement = document.getElementById("root");
if (!rootElement) throw new Error("Elemento raiz do Ginga nao encontrado");

createRoot(rootElement).render(
  <StrictMode>
    <AppErrorBoundary><App /></AppErrorBoundary>
  </StrictMode>
);


if ("serviceWorker" in navigator && !(window as unknown as { gingaDesktop?: unknown }).gingaDesktop) { window.addEventListener("load",()=>{void navigator.serviceWorker.register("/sw.js",{scope:"/"}).catch(()=>undefined);}); }
