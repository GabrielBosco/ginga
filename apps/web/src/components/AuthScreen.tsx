import { useEffect, useRef, useState, type FormEvent } from "react";
import { BookOpen, Download, Eye, EyeOff, ExternalLink, Github, Headphones, KeyRound, MessageCircleMore, MonitorUp, ShieldCheck, UsersRound } from "lucide-react";
import { ApiError, api, setToken } from "../lib/api";
import type { User } from "../types";

interface AuthScreenProps {
  onAuthenticated: (session: { token: string; user: User }) => void;
}

type Mode = "login" | "register";
type RegisterStep = "form" | "code";

type DesktopBridge = {
  isDesktop?: boolean;
  openExternalPath?: (path: string) => Promise<boolean>;
};

type RegistrationPayload = {
  email: string;
  username: string;
  displayName: string;
  password: string;
};

type RegistrationPolicy = {
  required: boolean;
  available: boolean;
  codeLength: number;
  expiresInSeconds: number;
};

type VerificationChallenge = {
  required: boolean;
  challengeId: string | null;
  expiresInSeconds: number;
};

type LoginResult =
  | { token: string; user: User; twoFactorRequired?: false }
  | { twoFactorRequired: true; challengeId: string; expiresInSeconds: number };

type UpdateManifest = {
  schema: number;
  product: string;
  platform: string;
  version: string;
  file: string;
};

function desktopBridge() {
  return (window as unknown as { gingaDesktop?: DesktopBridge }).gingaDesktop;
}

function initialMode(isDesktop: boolean): Mode {
  if (isDesktop) return "login";
  return window.location.pathname.toLowerCase().startsWith("/register") ? "register" : "login";
}

function validUpdateManifest(value: unknown): value is UpdateManifest {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<UpdateManifest>;
  return item.schema === 1
    && item.product === "Ginga"
    && item.platform === "win32-x64"
    && typeof item.version === "string"
    && /^\d+\.\d+\.\d+(?:-[0-9A-Za-z]+(?:[.-][0-9A-Za-z]+)*)?$/.test(item.version)
    && item.file === `Ginga-Setup-${item.version}-x64.exe`;
}

export function AuthScreen({ onAuthenticated }: AuthScreenProps) {
  const desktop = desktopBridge();
  const isDesktop = Boolean(desktop?.isDesktop);
  const [mode, setMode] = useState<Mode>(() => initialMode(isDesktop));
  const [registerStep, setRegisterStep] = useState<RegisterStep>("form");
  const [pendingRegistration, setPendingRegistration] = useState<RegistrationPayload | null>(null);
  const [challengeId, setChallengeId] = useState("");
  const [verificationCode, setVerificationCode] = useState("");
  const [registrationPolicy, setRegistrationPolicy] = useState<RegistrationPolicy | null>(null);
  const [twoFactorChallengeId, setTwoFactorChallengeId] = useState("");
  const [twoFactorCode, setTwoFactorCode] = useState("");
  const [rememberTwoFactorDevice, setRememberTwoFactorDevice] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [passwordValue, setPasswordValue] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [errorField, setErrorField] = useState("");
  const [download, setDownload] = useState<{ href: string; version: string } | null>(null);
  const [downloadState, setDownloadState] = useState<"loading" | "ready" | "unavailable">("loading");
  const [downloadRetry, setDownloadRetry] = useState(0);
  const authCardRef = useRef<HTMLFormElement>(null);
  const codeInputRef = useRef<HTMLInputElement>(null);
  const githubRepositoryUrl = String(import.meta.env.VITE_GITHUB_REPOSITORY_URL ?? "").trim();

  useEffect(() => {
    if (isDesktop) return;
    let cancelled = false;
    void api<RegistrationPolicy>("/api/auth/registration-policy")
      .then((policy) => { if (!cancelled) setRegistrationPolicy(policy); })
      .catch(() => {
        if (!cancelled) setRegistrationPolicy({ required: false, available: true, codeLength: 6, expiresInSeconds: 600 });
      });
    return () => { cancelled = true; };
  }, [isDesktop]);

  useEffect(() => {
    if (isDesktop) return;
    const controller = new AbortController();
    let intervalId = 0;
    let checking = false;

    async function refreshDownload(silent = false) {
      if (checking || controller.signal.aborted) return;
      checking = true;
      if (!silent) setDownloadState("loading");
      try {
        const response = await fetch(`/updates/windows/manifest.json?_ginga_site=${Date.now()}`, { cache: "no-store", signal: controller.signal });
        if (!response.ok) throw new Error(`manifesto indisponivel (${response.status})`);
        const manifest = await response.json() as unknown;
        if (!validUpdateManifest(manifest)) throw new Error("manifesto invalido");
        const href = `/updates/windows/${encodeURIComponent(manifest.file)}`;
        // O manifesto e publicado por ultimo no pipeline. Mesmo assim, confirma o
        // instalador para nunca oferecer um botao que termina em 404.
        const installerResponse = await fetch(`${href}?_ginga_site=${Date.now()}`, { method: "HEAD", cache: "no-store", signal: controller.signal });
        if (!installerResponse.ok) throw new Error(`instalador indisponivel (${installerResponse.status})`);
        setDownload({ href, version: manifest.version });
        setDownloadState("ready");
      } catch (downloadError) {
        if (controller.signal.aborted) return;
        console.warn("Feed de download do Ginga indisponivel", downloadError);
        setDownload(null);
        setDownloadState("unavailable");
      } finally {
        checking = false;
      }
    }

    void refreshDownload(false);
    intervalId = window.setInterval(() => void refreshDownload(true), 30000);
    const onFocus = () => void refreshDownload(true);
    window.addEventListener("focus", onFocus);
    return () => {
      controller.abort();
      window.clearInterval(intervalId);
      window.removeEventListener("focus", onFocus);
    };
  }, [isDesktop, downloadRetry]);

  function retryDownload() {
    setDownload(null);
    setDownloadState("loading");
    setDownloadRetry((value) => value + 1);
  }

  useEffect(() => {
    if (registerStep === "code") codeInputRef.current?.focus();
  }, [registerStep]);

  function resetRegistrationFlow() {
    setRegisterStep("form");
    setPendingRegistration(null);
    setChallengeId("");
    setVerificationCode("");
  }

  function changeMode(nextMode: Mode) {
    setMode(nextMode);
    setError("");
    setErrorField("");
    setPasswordValue("");
    setShowPassword(false);
    setTwoFactorChallengeId("");
    setTwoFactorCode("");
    setRememberTwoFactorDevice(false);
    resetRegistrationFlow();
    if (!isDesktop) {
      const nextPath = nextMode === "register" ? "/register" : "/";
      if (window.location.pathname !== nextPath) window.history.replaceState(null, "", nextPath);
      requestAnimationFrame(() => authCardRef.current?.querySelector<HTMLInputElement>("input")?.focus());
    }
  }

  async function finishAuthentication(path: string, payload: object) {
    const result = await api<{ token: string; user: User }>(path, {
      method: "POST",
      body: JSON.stringify(payload)
    });
    setToken(result.token);
    onAuthenticated(result);
  }

  async function submitLogin(payload: { login: string; password: string }) {
    const result = await api<LoginResult>("/api/auth/login", { method: "POST", body: JSON.stringify(payload) });
    if ("twoFactorRequired" in result && result.twoFactorRequired) {
      setTwoFactorChallengeId(result.challengeId);
      setTwoFactorCode("");
      setRememberTwoFactorDevice(false);
      setPasswordValue("");
      return;
    }
    setToken(result.token);
    onAuthenticated(result);
  }

  async function requestVerificationCode(payload: RegistrationPayload) {
    if (!registrationPolicy) throw new Error("Nao foi possivel carregar a seguranca do cadastro. Atualize a pagina e tente novamente.");
    if (registrationPolicy.required && !registrationPolicy.available) {
      throw new Error("O cadastro por e-mail ainda nao foi configurado pelo administrador.");
    }

    if (!registrationPolicy.required) {
      await finishAuthentication("/api/auth/register", payload);
      return;
    }

    await api<{ ok: true }>("/api/auth/password-policy/check", {
      method: "POST",
      body: JSON.stringify({ password: payload.password })
    });

    const challenge = await api<VerificationChallenge>("/api/auth/register/code", {
      method: "POST",
      body: JSON.stringify({
        email: payload.email,
        username: payload.username,
        displayName: payload.displayName,
        password: payload.password
      })
    });

    if (!challenge.challengeId) throw new Error("Nao foi possivel iniciar a verificacao por e-mail.");
    setPendingRegistration(payload);
    setChallengeId(challenge.challengeId);
    setVerificationCode("");
    setRegisterStep("code");
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setErrorField("");
    setLoading(true);
    const form = new FormData(event.currentTarget);

    try {
      if (mode === "login") {
        if (twoFactorChallengeId) {
          const code = twoFactorCode.trim();
          if (code.length < 6) throw new Error("Digite o codigo do autenticador ou um codigo de recuperacao.");
          await finishAuthentication("/api/auth/login/2fa", { challengeId: twoFactorChallengeId, code, rememberDevice: rememberTwoFactorDevice });
          return;
        }
        await submitLogin({
          login: String(form.get("login") ?? "").trim(),
          password: String(form.get("password") ?? "")
        });
        return;
      }

      if (registerStep === "code") {
        if (!pendingRegistration || !challengeId) throw new Error("Solicite um novo codigo de verificacao.");
        const code = verificationCode.replace(/\D/g, "");
        if (!/^\d{6}$/.test(code)) throw new Error("Digite o codigo de 6 digitos enviado para seu e-mail.");
        await finishAuthentication("/api/auth/register", {
          ...pendingRegistration,
          challengeId,
          verificationCode: code
        });
        return;
      }

      const payload: RegistrationPayload = {
        email: String(form.get("email") ?? "").trim(),
        username: String(form.get("username") ?? "").trim(),
        displayName: String(form.get("displayName") ?? "").trim(),
        password: String(form.get("password") ?? "")
      };
      if (payload.password.length < 8) {
        setErrorField("password");
        throw new Error("Sua senha precisa ter pelo menos 8 caracteres.");
      }
      await requestVerificationCode(payload);
    } catch (caught) {
      if (caught instanceof ApiError && caught.field) setErrorField(caught.field);
      setError(caught instanceof Error ? caught.message : "Nao foi possivel concluir a operacao.");
    } finally {
      setLoading(false);
    }
  }

  async function resendVerificationCode() {
    if (!pendingRegistration) return;
    setLoading(true);
    setError("");
    try {
      const challenge = await api<VerificationChallenge>("/api/auth/register/code", {
        method: "POST",
        body: JSON.stringify({
          email: pendingRegistration.email,
          username: pendingRegistration.username,
          displayName: pendingRegistration.displayName,
          password: pendingRegistration.password
        })
      });
      if (!challenge.challengeId) throw new Error("Nao foi possivel reenviar o codigo.");
      setChallengeId(challenge.challengeId);
      setVerificationCode("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Nao foi possivel reenviar o codigo.");
    } finally {
      setLoading(false);
    }
  }

  function focusLogin() {
    changeMode("login");
    requestAnimationFrame(() => authCardRef.current?.querySelector<HTMLInputElement>('input[name="login"]')?.focus());
  }

  const form = (
    <form ref={authCardRef} className="auth-card" onSubmit={submit}>
      <img className="auth-app-icon-image" src="/ginga-mark.svg" alt="" />
      <div className="auth-heading">
        <h2>{mode === "login" ? twoFactorChallengeId ? "Verificacao em duas etapas" : "Bem-vindo de volta" : registerStep === "code" ? "Confirme seu e-mail" : "Crie sua conta"}</h2>
        <p>{mode === "login" ? twoFactorChallengeId ? "Abra seu aplicativo autenticador e confirme este acesso." : "Entre para continuar no Ginga." : registerStep === "code" ? `Enviamos um codigo para ${pendingRegistration?.email ?? "seu e-mail"}.` : "Seu usuario, seu espaco e suas conversas em um so lugar."}</p>
      </div>

      {mode === "register" && registerStep === "form" && (
        <>
          <label className={errorField === "displayName" ? "field-invalid" : ""}>Nome exibido<input name="displayName" required minLength={2} maxLength={32} placeholder="Como voce quer aparecer" autoComplete="name" /></label>
          <label className={errorField === "username" ? "field-invalid" : ""}>Nome de usuario<input name="username" required minLength={3} maxLength={24} placeholder="seu_usuario" autoComplete="username" /><small className="auth-field-hint">3 a 24 caracteres. Letras, numeros, ponto, traco e _.</small></label>
          <label className={errorField === "email" ? "field-invalid" : ""}>E-mail<input name="email" type="email" required maxLength={160} placeholder="voce@exemplo.com" autoComplete="email" /><small className="auth-field-hint">Use um e-mail real: voce precisara confirmar o codigo recebido.</small></label>
        </>
      )}

      {mode === "login" && !twoFactorChallengeId && <label>Usuario ou e-mail<input name="login" required placeholder="usuario ou e-mail" autoComplete="username" /></label>}

      {((mode === "login" && !twoFactorChallengeId) || (mode === "register" && registerStep === "form")) && (
        <label className={errorField === "password" ? "field-invalid" : ""}>Senha<span className="password-field"><input name="password" type={showPassword ? "text" : "password"} required minLength={mode === "register" ? 8 : 1} maxLength={128} value={passwordValue} onChange={(event) => { setPasswordValue(event.target.value); if (errorField === "password") setErrorField(""); }} placeholder="••••••••" autoComplete={mode === "login" ? "current-password" : "new-password"} /><button type="button" onClick={() => setShowPassword((value) => !value)} aria-label="Mostrar ou ocultar senha">{showPassword ? <EyeOff size={18} /> : <Eye size={18} />}</button></span>{mode === "register" && registerStep === "form" && <span className={`password-requirement ${passwordValue.length >= 8 ? "ok" : ""}`}><ShieldCheck size={14}/><span>{passwordValue.length >= 8 ? "O Ginga tambem verifica se esta senha ja apareceu em vazamentos" : `Minimo de 8 caracteres (${passwordValue.length}/8)`}</span></span>}</label>
      )}

      {mode === "login" && twoFactorChallengeId && (
        <div className="verification-box two-factor-login-box">
          <span className="two-factor-login-icon"><KeyRound size={20}/></span>
          <label>Codigo do autenticador ou recuperacao<input className="verification-code-input" value={twoFactorCode} onChange={(event) => setTwoFactorCode(event.target.value.replace(/\s+/g, "").slice(0, 32))} autoComplete="one-time-code" placeholder="000000 ou codigo de recuperacao" required autoFocus /></label>
          <label className="auth-remember-device">
            <input type="checkbox" checked={rememberTwoFactorDevice} onChange={(event) => setRememberTwoFactorDevice(event.target.checked)} />
            <span><strong>Lembrar deste dispositivo</strong><small>Nao pedir o codigo 2FA novamente por 30 dias neste navegador.</small></span>
          </label>
          <div className="verification-hint"><ShieldCheck size={16}/><span>Se perdeu o autenticador, use um dos codigos de recuperacao salvos quando ativou o 2FA.</span></div>
        </div>
      )}

      {mode === "register" && registerStep === "code" && (
        <div className="verification-box">
          <label>Codigo de verificacao<input ref={codeInputRef} className="verification-code-input" value={verificationCode} onChange={(event) => setVerificationCode(event.target.value.replace(/\D/g, "").slice(0, 6))} inputMode="numeric" autoComplete="one-time-code" placeholder="000000" required /></label>
          <div className="verification-hint"><ShieldCheck size={16} /><span>O codigo expira em 10 minutos e aceita no maximo 5 tentativas.</span></div>
        </div>
      )}

      {error && <div className="form-error">{error}</div>}
      <button className="primary-button auth-submit" disabled={loading}>{loading ? "Aguarde..." : mode === "login" ? twoFactorChallengeId ? "Confirmar acesso" : "Entrar" : registerStep === "code" ? "Confirmar e criar conta" : registrationPolicy?.required === false ? "Criar conta" : "Enviar codigo por e-mail"}</button>

      {mode === "register" && registerStep === "code" && (
        <div className="verification-actions">
          <button type="button" className="auth-link-button" disabled={loading} onClick={() => void resendVerificationCode()}>Reenviar codigo</button>
          <button type="button" className="auth-link-button muted" onClick={resetRegistrationFlow}>Alterar dados</button>
        </div>
      )}

      {mode === "login" && twoFactorChallengeId && <div className="verification-actions"><button type="button" className="auth-link-button muted" onClick={() => { setTwoFactorChallengeId(""); setTwoFactorCode(""); setRememberTwoFactorDevice(false); setError(""); }}>Voltar para usuario e senha</button></div>}

      {isDesktop ? (
        <div className="auth-links">
          <button type="button" className="auth-link-button" onClick={() => void desktop?.openExternalPath?.("/register")}>Criar conta no site</button>
          <button type="button" className="auth-link-button muted" onClick={() => void desktop?.openExternalPath?.("/reset-password")}>Esqueci minha senha</button>
        </div>
      ) : mode === "login" ? (
        <>
          <p className="auth-switch">Esqueceu a senha? <a href="/reset-password">Redefinir senha</a></p>
          <p className="auth-switch">Ainda nao tem conta? <button type="button" onClick={() => changeMode("register")}>Criar conta</button></p>
        </>
      ) : (
        <p className="auth-switch">Ja tem uma conta? <button type="button" onClick={() => changeMode("login")}>Entrar</button></p>
      )}
    </form>
  );

  if (isDesktop) {
    return (
      <main className="auth-page auth-simple auth-desktop">
        <section className="auth-panel">{form}</section>
      </main>
    );
  }

  return (
    <main className="auth-page auth-site auth-site-product">
      <section className="auth-hero">
        <header className="auth-site-nav">
          <div className="brand-lockup"><img src="/ginga-mark.svg" alt="" /><span>Ginga</span></div>
          <nav>
            <a className="site-nav-link" href="/knowledge"><BookOpen size={15}/> Base de conhecimento</a>
            {githubRepositoryUrl && <a className="site-nav-link" href={githubRepositoryUrl} target="_blank" rel="noreferrer"><Github size={15}/> GitHub</a>}
            {download ? <a className="site-download-link" href={download.href} title={`Ginga ${download.version}`}><Download size={16} /> Baixar</a> : downloadState === "loading" ? <span className="site-download-link disabled"><Download size={16} /> Procurando...</span> : <button className="site-download-link site-download-retry" type="button" onClick={retryDownload}><Download size={16} /> Tentar novamente</button>}
            <button className="site-login-button" type="button" onClick={focusLogin}>Entrar</button>
          </nav>
        </header>

        <div className="hero-copy">
          <span className="eyebrow">GINGA</span>
          <h1>Converse do seu jeito.</h1>
          <p>Texto, voz, comunidades e compartilhamento de tela em um so lugar. Rapido, moderno e feito para manter todo mundo conectado.</p>
          <div className="site-hero-actions">
            {download ? <a className="primary-button hero-download-button" href={download.href} title={`Baixar Ginga ${download.version}`}><Download size={18} /> Baixar para Windows</a> : downloadState === "loading" ? <button className="primary-button hero-download-button" type="button" disabled><Download size={18} /> Procurando ultima versao...</button> : <button className="primary-button hero-download-button" type="button" onClick={retryDownload}><Download size={18} /> Tentar download novamente</button>}
            <button type="button" className="secondary-button hero-login-button" onClick={focusLogin}>Abrir no navegador</button>
            {githubRepositoryUrl && <a className="secondary-button hero-github-button" href={githubRepositoryUrl} target="_blank" rel="noreferrer"><Github size={17}/> Abrir repositorio <ExternalLink size={13}/></a>}
          </div>
          <div className="feature-row auth-product-features">
            <span><MessageCircleMore size={15} /> Mensagens diretas</span>
            <span><Headphones size={15} /> Canais de voz</span>
            <span><MonitorUp size={15} /> Compartilhamento de tela</span>
            <span><UsersRound size={15} /> Comunidades</span>
            <span><Github size={15} /> Open Source</span>
          </div>
        </div>

        <div className="auth-product-preview" aria-label="Recursos do Ginga">
          <div className="auth-preview-channel"><span>VOZ</span><strong><Headphones size={15}/> Bate-papo</strong><small>Converse, compartilhe a tela e organize sua comunidade.</small></div>
          <div className="auth-preview-divider" />
          <div className="auth-preview-items"><span><MessageCircleMore size={15}/><b>Texto</b><small>Mensagens e arquivos</small></span><span><MonitorUp size={15}/><b>Tela</b><small>Compartilhamento em voz</small></span><span><UsersRound size={15}/><b>Comunidade</b><small>Servidores e canais</small></span></div>
          <a href="/knowledge"><BookOpen size={15}/> Aprender a usar o Ginga <ExternalLink size={12}/></a>
        </div>
      </section>

      <section className="auth-panel auth-site-panel">
        {form}
        {download && <a className="auth-site-mobile-download" href={download.href}><Download size={16} /> Baixar Ginga {download.version}</a>}
        <small className="auth-site-footer">Ginga · Open Source</small>
      </section>
    </main>
  );
}
