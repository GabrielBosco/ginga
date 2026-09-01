import { useEffect, useState } from "react";
import { AuthScreen } from "./components/AuthScreen";
import { Workspace } from "./components/Workspace";
import { AdminPortal } from "./components/AdminPortal";
import { DeveloperPortal, OAuthAuthorize } from "./components/DeveloperPortal";
import { InviteLanding } from "./components/InviteLanding";
import { KnowledgeBase } from "./components/KnowledgeBase";
import { LegalPage } from "./components/LegalPage";
import { PasswordResetPage } from "./components/PasswordResetPage";
import { api, getToken, restoreRememberedSession, setToken } from "./lib/api";
import { applyAppearancePreferences, loadAppearancePreferences } from "./lib/preferences";
import type { User } from "./types";

interface Session { token: string; user: User; }

export default function App() {
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [path, setPath] = useState(location.pathname);
  const desktop = Boolean((window as unknown as { gingaDesktop?: { isDesktop?: boolean } }).gingaDesktop?.isDesktop);

  function navigate(next: string) {
    history.pushState({}, "", next);
    setPath(new URL(next, location.origin).pathname);
  }

  useEffect(() => {
    const onPop = () => setPath(location.pathname);
    addEventListener("popstate", onPop);
    return () => removeEventListener("popstate", onPop);
  }, []);

  useEffect(() => {
    const onSessionInvalid = () => setSession(null);
    const onSessionRestored = (event: Event) => {
      const detail = (event as CustomEvent<Session>).detail;
      if (detail?.token && detail?.user) setSession(detail);
    };
    window.addEventListener("ginga:session-invalid", onSessionInvalid as EventListener);
    window.addEventListener("ginga:session-restored", onSessionRestored as EventListener);
    return () => {
      window.removeEventListener("ginga:session-invalid", onSessionInvalid as EventListener);
      window.removeEventListener("ginga:session-restored", onSessionRestored as EventListener);
    };
  }, []);

  useEffect(() => {
    applyAppearancePreferences(loadAppearancePreferences());
    let cancelled = false;
    void (async () => {
      const token = getToken();
      if (token) {
        try {
          const result = await api<{ user: User }>("/api/auth/me");
          const activeToken = getToken() ?? token;
          if (!cancelled) setSession({ token: activeToken, user: result.user });
          return;
        } catch {
          // O helper da API ja tenta restaurar uma sessao lembrada antes de falhar.
        }
      }
      const remembered = await restoreRememberedSession();
      if (!cancelled) setSession(remembered ? { token: remembered.token, user: remembered.user } : null);
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    const nextSurface = !desktop && path === "/developers"
      ? "developer"
      : !desktop && path === "/admin"
        ? "admin"
        : "";
    if (nextSurface) root.dataset.gingaSurface = nextSurface;
    else delete root.dataset.gingaSurface;
    return () => {
      if (root.dataset.gingaSurface === nextSurface) delete root.dataset.gingaSurface;
    };
  }, [desktop, path]);

  if (path === "/knowledge") return <KnowledgeBase authenticated={Boolean(session)} onExit={() => navigate("/")} />;
  if (path === "/terms") return <LegalPage kind="terms" onExit={() => navigate("/")} />;
  if (path === "/privacy") return <LegalPage kind="privacy" onExit={() => navigate("/")} />;
  if (path === "/reset-password") return <PasswordResetPage />;

  if (session === undefined) return <div className="app-loading"><img className="ginga-mark-image loading" src="/favicon.svg" alt="" /><small>Iniciando...</small></div>;
  if (!session) return <AuthScreen onAuthenticated={setSession} />;

  if (!desktop && path === "/developers" && ["DEVELOPER","PLATFORM_ADMIN"].includes(session.user.systemRole ?? "USER")) {
    return <DeveloperPortal user={session.user} onExit={() => navigate("/")} />;
  }
  if (!desktop && path === "/admin" && session.user.systemRole === "PLATFORM_ADMIN") {
    return <AdminPortal user={session.user} onExit={() => navigate("/")} />;
  }
  if (!desktop && path === "/oauth2/authorize") return <OAuthAuthorize onExit={() => navigate("/")} />;
  if (!desktop && path.startsWith("/invite/")) {
    const code = decodeURIComponent(path.slice("/invite/".length)).trim();
    if (code) return <InviteLanding code={code} onDone={() => navigate("/")} onExit={() => navigate("/")} />;
  }

  return <Workspace token={session.token} user={session.user} onSessionUpdate={(token,user)=>setSession({token,user})} onLogout={()=>{
    void api<void>("/api/auth/logout", { method: "POST" }).catch(() => undefined).finally(() => {
      setToken(null);
      setSession(null);
    });
  }} onNavigate={navigate} desktop={desktop} />;
}
