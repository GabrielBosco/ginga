import { useEffect, useRef, useState, type FormEvent } from "react";
import { BookOpen, CalendarDays, Download, Eye, EyeOff, FileText, Github, Headphones, KeyRound, MessageCircleMore, MonitorUp, ShieldCheck, UsersRound, WifiOff } from "lucide-react";
import { ApiError, api, setToken } from "../lib/api";
import type { User } from "../types";

interface AuthScreenProps {
  onAuthenticated: (session: { token: string; user: User }) => void;
}

type Mode = "login" | "register";
type RegisterStep = "form" | "code";
type LoginMethod = "password" | "two-factor";

type DesktopBridge = {
  isDesktop?: boolean;
  openExternalPath?: (path: string) => Promise<boolean>;
};

type RegistrationPayload = {
  email: string;
  username: string;
  displayName: string;
  birthDate: string;
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

type LinuxManifest = {
  schema: number;
  product: string;
  platform: "linux-x64" | "linux-arm64";
  version: string;
  primary: string;
  files: Array<{ file: string; type: "appimage" | "deb" | "rpm"; size: number; sha256: string; href?: string }>;
};

type LinuxDownload = {
  version: string;
  primaryHref: string;
  files: Array<{ file: string; type: string; href: string }>;
};

function desktopBridge() {
  return (window as unknown as { gingaDesktop?: DesktopBridge }).gingaDesktop;
}

function initialMode(isDesktop: boolean): Mode {
  if (isDesktop) return "login";
  return window.location.pathname.toLowerCase().startsWith("/register") ? "register" : "login";
}

function initialLoginMethod(): LoginMethod {
  if (typeof window === "undefined") return "password";
  return new URLSearchParams(window.location.search).get("login") === "2fa" ? "two-factor" : "password";
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

function linuxFormatLabel(type: string) {
  if (type === "appimage") return "AppImage";
  if (type === "deb") return "DEB";
  if (type === "rpm") return "RPM";
  return type.toUpperCase();
}

function validLinuxManifest(value: unknown, arch: "x64" | "arm64"): value is LinuxManifest {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<LinuxManifest>;
  if (item.schema !== 1 || item.product !== "Ginga" || item.platform !== `linux-${arch}` || typeof item.version !== "string") return false;
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z]+(?:[.-][0-9A-Za-z]+)*)?$/.test(item.version)) return false;
  if (!Array.isArray(item.files) || typeof item.primary !== "string") return false;
  const allowedTypes = arch === "x64" ? new Set(["appimage", "deb", "rpm"]) : new Set(["appimage", "deb"]);
  return item.files.length > 0 && item.files.every((file) => Boolean(file)
    && typeof file.file === "string" && /^Ginga-[0-9A-Za-z.-]+-linux-[0-9A-Za-z_]+\.(?:AppImage|deb|rpm)$/.test(file.file)
    && allowedTypes.has(file.type) && Number.isFinite(file.size) && file.size > 0
    && /^[0-9a-f]{64}$/i.test(file.sha256))
    && item.files.some((file) => file.file === item.primary);
}

function isoDateLocal(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function maximumRegistrationBirthDate() {
  const today = new Date();
  return isoDateLocal(new Date(today.getFullYear() - 16, today.getMonth(), today.getDate()));
}

function isAtLeastSixteen(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const birth = new Date(year, month - 1, day);
  if (birth.getFullYear() !== year || birth.getMonth() !== month - 1 || birth.getDate() !== day) return false;
  const today = new Date();
  const cutoff = new Date(today.getFullYear() - 16, today.getMonth(), today.getDate());
  return birth.getTime() <= cutoff.getTime();
}

export function AuthScreen({ onAuthenticated }: AuthScreenProps) {
  const desktop = desktopBridge();
  const isDesktop = Boolean(desktop?.isDesktop);
  const [mode, setMode] = useState<Mode>(() => initialMode(isDesktop));
  const [loginMethod, setLoginMethod] = useState<LoginMethod>(() => initialLoginMethod());
  const [registerStep, setRegisterStep] = useState<RegisterStep>("form");
  const [pendingRegistration, setPendingRegistration] = useState<RegistrationPayload | null>(null);
  const [challengeId, setChallengeId] = useState("");
  const [verificationCode, setVerificationCode] = useState("");
  const [registrationPolicy, setRegistrationPolicy] = useState<RegistrationPolicy | null>(null);
  const [twoFactorChallengeId, setTwoFactorChallengeId] = useState("");
  const [twoFactorCode, setTwoFactorCode] = useState("");
  const [rememberTwoFactorDevice, setRememberTwoFactorDevice] = useState(false);
  const [rememberSession, setRememberSession] = useState(() => {
    try { return localStorage.getItem("ginga.remember-login") === "1"; } catch { return false; }
  });
  const [showPassword, setShowPassword] = useState(false);
  const [capsLockOn, setCapsLockOn] = useState(false);
  const [passwordValue, setPasswordValue] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [errorField, setErrorField] = useState("");
  const [online, setOnline] = useState(() => typeof navigator === "undefined" ? true : navigator.onLine);
  const [download, setDownload] = useState<{ href: string; version: string } | null>(null);
  const [downloadState, setDownloadState] = useState<"loading" | "ready" | "unavailable">("loading");
  const [downloadRetry, setDownloadRetry] = useState(0);
  const [linuxDownloads, setLinuxDownloads] = useState<{ x64: LinuxDownload | null; arm64: LinuxDownload | null }>({ x64: null, arm64: null });
  const authCardRef = useRef<HTMLFormElement>(null);
  const codeInputRef = useRef<HTMLInputElement>(null);
  const githubRepositoryUrl = String(import.meta.env.VITE_GITHUB_REPOSITORY_URL ?? "").trim();

  useEffect(() => {
    const onOnline = () => setOnline(true);
    const onOffline = () => setOnline(false);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, []);

  useEffect(() => {
    document.documentElement.classList.add("ginga-auth-dark");
    document.body.classList.add("ginga-auth-dark");
    return () => {
      document.documentElement.classList.remove("ginga-auth-dark");
      document.body.classList.remove("ginga-auth-dark");
    };
  }, []);

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

  useEffect(() => {
    if (isDesktop) return;
    const controller = new AbortController();
    const loadLinux = async (arch: "x64" | "arm64") => {
      try {
        const response = await fetch(`/updates/linux/${arch}/manifest.json?_ginga_site=${Date.now()}`, { cache: "no-store", signal: controller.signal });
        if (!response.ok) return null;
        const manifest = await response.json() as unknown;
        if (!validLinuxManifest(manifest, arch)) return null;
        const files = manifest.files.map((file) => ({ file: file.file, type: file.type, href: `/updates/linux/${arch}/${encodeURIComponent(file.file)}` }));
        const primary = files.find((file) => file.file === manifest.primary);
        if (!primary) return null;
        const head = await fetch(`${primary.href}?_ginga_site=${Date.now()}`, { method: "HEAD", cache: "no-store", signal: controller.signal });
        if (!head.ok) return null;
        return { version: manifest.version, primaryHref: primary.href, files } satisfies LinuxDownload;
      } catch { return null; }
    };
    void Promise.all([loadLinux("x64"), loadLinux("arm64")]).then(([x64, arm64]) => {
      if (!controller.signal.aborted) setLinuxDownloads({ x64, arm64 });
    });
    return () => controller.abort();
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
    setLoginMethod("password");
    resetRegistrationFlow();
    if (!isDesktop) {
      const nextPath = nextMode === "register" ? "/register" : "/";
      if (window.location.pathname !== nextPath) window.history.replaceState(null, "", nextPath);
      requestAnimationFrame(() => authCardRef.current?.querySelector<HTMLInputElement>("input")?.focus());
    }
  }

  function changeLoginMethod(next: LoginMethod) {
    setLoginMethod(next);
    setTwoFactorChallengeId("");
    setTwoFactorCode("");
    setRememberTwoFactorDevice(next === "two-factor" ? rememberSession : false);
    setPasswordValue("");
    setShowPassword(false);
    setError("");
    setErrorField("");
    if (!isDesktop) {
      const url = new URL(window.location.href);
      if (next === "two-factor") url.searchParams.set("login", "2fa");
      else url.searchParams.delete("login");
      window.history.replaceState(null, "", `${url.pathname}${url.search}`);
    }
    requestAnimationFrame(() => authCardRef.current?.querySelector<HTMLInputElement>('input[name="login"]')?.focus());
  }

  async function finishAuthentication(path: string, payload: object) {
    const result = await api<{ token: string; user: User }>(path, {
      method: "POST",
      body: JSON.stringify(payload)
    });
    setToken(result.token);
    onAuthenticated(result);
  }

  async function submitLogin(payload: { login: string; password: string; rememberMe: boolean }) {
    const result = await api<LoginResult>("/api/auth/login", { method: "POST", body: JSON.stringify(payload) });
    if ("twoFactorRequired" in result && result.twoFactorRequired) {
      setTwoFactorChallengeId(result.challengeId);
      setTwoFactorCode("");
      setRememberTwoFactorDevice(payload.rememberMe);
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
        birthDate: payload.birthDate,
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
          await finishAuthentication("/api/auth/login/2fa", {
            challengeId: twoFactorChallengeId,
            code,
            rememberDevice: rememberTwoFactorDevice,
            rememberSession
          });
          return;
        }
        if (loginMethod === "two-factor") {
          const login = String(form.get("login") ?? "").trim();
          const code = twoFactorCode.trim();
          if (login.length < 3) throw new Error("Digite seu usuario ou e-mail.");
          if (code.length < 6) throw new Error("Digite o codigo do autenticador ou um codigo de recuperacao.");
          await finishAuthentication("/api/auth/login/2fa-only", {
            login,
            code,
            rememberMe: rememberSession,
            rememberDevice: rememberTwoFactorDevice
          });
          return;
        }
        try { localStorage.setItem("ginga.remember-login", rememberSession ? "1" : "0"); } catch { /* storage indisponivel */ }
        await submitLogin({
          login: String(form.get("login") ?? "").trim(),
          password: String(form.get("password") ?? ""),
          rememberMe: rememberSession
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
        birthDate: String(form.get("birthDate") ?? "").trim(),
        password: String(form.get("password") ?? "")
      };
      if (!isAtLeastSixteen(payload.birthDate)) {
        setErrorField("birthDate");
        throw new Error("Voce precisa ter pelo menos 16 anos para criar uma conta.");
      }
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
          birthDate: pendingRegistration.birthDate,
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
    requestAnimationFrame(() => {
      const card = authCardRef.current;
      card?.scrollIntoView({ behavior: "smooth", block: "center", inline: "nearest" });
      window.setTimeout(() => card?.querySelector<HTMLInputElement>('input[name="login"]')?.focus({ preventScroll: true }), 180);
    });
  }

  const form = (
    <form ref={authCardRef} className="auth-card auth-card-v2" onSubmit={submit} noValidate={false}>
      <div className="auth-heading">
        <h2>{mode === "login" ? twoFactorChallengeId ? "Confirme que e voce" : loginMethod === "two-factor" ? "Entrar com 2FA" : "Bem-vindo de volta" : registerStep === "code" ? "Confirme seu e-mail" : "Crie sua conta"}</h2>
        <p>{mode === "login" ? twoFactorChallengeId ? "Use o autenticador ou um codigo de recuperacao para concluir o acesso." : loginMethod === "two-factor" ? "Esqueceu a senha? Se o 2FA estiver ativo, voce pode entrar usando seu codigo do autenticador ou um codigo de recuperacao." : "Entre para continuar suas conversas exatamente de onde parou." : registerStep === "code" ? `Enviamos um codigo para ${pendingRegistration?.email ?? "seu e-mail"}.` : "Seu usuario, seu espaco e suas conversas em um so lugar."}</p>
      </div>

      {!online && <div className="auth-network-warning" role="status"><WifiOff size={17}/><div><strong>Sem conexao com a rede</strong><span>Seus dados preenchidos ficam nesta tela. Reconecte a internet e tente novamente.</span></div></div>}

      {mode === "register" && registerStep === "form" && (
        <>
          <label className={errorField === "displayName" ? "field-invalid" : ""}>Nome exibido<input name="displayName" required minLength={2} maxLength={32} placeholder="Como voce quer aparecer" autoComplete="name" /></label>
          <label className={errorField === "username" ? "field-invalid" : ""}>Nome de usuario<input name="username" required minLength={3} maxLength={24} placeholder="seu_usuario" autoComplete="username" /><small className="auth-field-hint">3 a 24 caracteres. Letras, numeros, ponto, traco e _.</small></label>
          <label className={errorField === "email" ? "field-invalid" : ""}>E-mail<input name="email" type="email" required maxLength={160} placeholder="voce@exemplo.com" autoComplete="email" /><small className="auth-field-hint">Use um e-mail real: voce precisara confirmar o codigo recebido.</small></label>
          <label className={errorField === "birthDate" ? "field-invalid" : ""}>Data de nascimento<span className="auth-birth-date-field"><CalendarDays size={16}/><input name="birthDate" type="date" required max={maximumRegistrationBirthDate()} autoComplete="bday" onChange={() => { if (errorField === "birthDate") setErrorField(""); }}/></span><small className="auth-field-hint">O Ginga e destinado a pessoas com 16 anos ou mais.</small></label>
        </>
      )}

      {mode === "login" && !twoFactorChallengeId && <label>Usuario ou e-mail<input name="login" required placeholder="seu usuario ou e-mail" autoComplete="username" autoFocus /></label>}

      {((mode === "login" && !twoFactorChallengeId && loginMethod === "password") || (mode === "register" && registerStep === "form")) && (
        <label className={errorField === "password" ? "field-invalid" : ""}>Senha<span className="password-field"><input name="password" type={showPassword ? "text" : "password"} required minLength={mode === "register" ? 8 : 1} maxLength={128} value={passwordValue} onChange={(event) => { setPasswordValue(event.target.value); if (errorField === "password") setErrorField(""); }} onKeyDown={(event) => setCapsLockOn(event.getModifierState("CapsLock"))} onKeyUp={(event) => setCapsLockOn(event.getModifierState("CapsLock"))} onBlur={() => setCapsLockOn(false)} placeholder="••••••••" autoComplete={mode === "login" ? "current-password" : "new-password"} /><button type="button" onClick={() => setShowPassword((value) => !value)} aria-label={showPassword ? "Ocultar senha" : "Mostrar senha"}>{showPassword ? <EyeOff size={18} /> : <Eye size={18} />}</button></span>{capsLockOn && <small className="auth-caps-warning">Caps Lock esta ativado.</small>}{mode === "register" && registerStep === "form" && <span className={`password-requirement ${passwordValue.length >= 8 ? "ok" : ""}`}><ShieldCheck size={14}/><span>{passwordValue.length >= 8 ? "A senha tambem e comparada com bases conhecidas de vazamentos." : `Minimo de 8 caracteres (${passwordValue.length}/8)`}</span></span>}</label>
      )}

      {mode === "login" && !twoFactorChallengeId && loginMethod === "password" && (
        <label className="auth-remember-session">
          <input type="checkbox" checked={rememberSession} onChange={(event) => {
            setRememberSession(event.target.checked);
            try { localStorage.setItem("ginga.remember-login", event.target.checked ? "1" : "0"); } catch { /* storage indisponivel */ }
          }} />
          <span><strong>Continuar conectado</strong><small>Mantem esta sessao neste dispositivo por ate 30 dias, com renovacao segura.</small></span>
        </label>
      )}

      {mode === "login" && !twoFactorChallengeId && loginMethod === "two-factor" && (
        <div className="verification-box two-factor-login-box two-factor-passwordless-box">
          <span className="two-factor-login-icon"><KeyRound size={20}/></span>
          <label>Codigo do autenticador ou recuperacao<input className="verification-code-input" value={twoFactorCode} onChange={(event) => setTwoFactorCode(event.target.value.replace(/\s+/g, "").slice(0, 32))} autoComplete="one-time-code" placeholder="000000 ou XXXX-XXXX-XXXX" required /></label>
          <label className="auth-remember-session compact">
            <input type="checkbox" checked={rememberSession} onChange={(event) => setRememberSession(event.target.checked)} />
            <span><strong>Continuar conectado</strong><small>Restaura sua sessao automaticamente neste dispositivo.</small></span>
          </label>
          <label className="auth-remember-device compact">
            <input type="checkbox" checked={rememberTwoFactorDevice} onChange={(event) => setRememberTwoFactorDevice(event.target.checked)} />
            <span><strong>Confiar neste dispositivo</strong><small>Nao pedir 2FA novamente por 30 dias quando voce usar sua senha.</small></span>
          </label>
          <div className="verification-hint warning"><ShieldCheck size={16}/><span>Este fluxo usa o 2FA como recuperacao de acesso. Use apenas em um dispositivo seu. Codigos de recuperacao sao descartados depois do uso.</span></div>
        </div>
      )}

      {mode === "login" && twoFactorChallengeId && (
        <div className="verification-box two-factor-login-box">
          <span className="two-factor-login-icon"><KeyRound size={20}/></span>
          <label>Codigo do autenticador ou recuperacao<input className="verification-code-input" value={twoFactorCode} onChange={(event) => setTwoFactorCode(event.target.value.replace(/\s+/g, "").slice(0, 32))} autoComplete="one-time-code" placeholder="000000 ou codigo de recuperacao" required autoFocus /></label>
          <label className="auth-remember-device">
            <input type="checkbox" checked={rememberTwoFactorDevice} onChange={(event) => setRememberTwoFactorDevice(event.target.checked)} />
            <span><strong>Confiar neste dispositivo</strong><small>Nao pedir o codigo 2FA novamente por 30 dias neste navegador.</small></span>
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

      {error && <div className="form-error" role="alert" aria-live="polite">{error}</div>}
      <button className="primary-button auth-submit" disabled={loading}>{loading ? "Aguarde..." : mode === "login" ? twoFactorChallengeId ? "Confirmar acesso" : loginMethod === "two-factor" ? "Entrar com 2FA" : "Entrar" : registerStep === "code" ? "Confirmar e criar conta" : registrationPolicy?.required === false ? "Criar conta" : "Enviar codigo por e-mail"}</button>

      {mode === "register" && registerStep === "code" && (
        <div className="verification-actions">
          <button type="button" className="auth-link-button" disabled={loading} onClick={() => void resendVerificationCode()}>Reenviar codigo</button>
          <button type="button" className="auth-link-button muted" onClick={resetRegistrationFlow}>Alterar dados</button>
        </div>
      )}

      {mode === "login" && twoFactorChallengeId && <div className="verification-actions"><button type="button" className="auth-link-button muted" onClick={() => { setTwoFactorChallengeId(""); setTwoFactorCode(""); setRememberTwoFactorDevice(false); setError(""); }}>Voltar para usuario e senha</button></div>}

      {mode === "login" && !twoFactorChallengeId && (
        <div className="auth-recovery-actions auth-aux-links">
          {loginMethod === "password" ? (
            <>
              <button type="button" className="auth-aux-link" onClick={() => changeLoginMethod("two-factor")}><KeyRound size={14}/><span>Entrar com 2FA</span></button>
              {isDesktop ? <button type="button" className="auth-aux-link" onClick={() => void desktop?.openExternalPath?.("/reset-password")}><ShieldCheck size={14}/><span>Redefinir senha</span></button> : <a className="auth-aux-link" href="/reset-password"><ShieldCheck size={14}/><span>Redefinir senha</span></a>}
            </>
          ) : (
            <button type="button" className="auth-aux-link auth-aux-link-wide" onClick={() => changeLoginMethod("password")}><KeyRound size={14}/><span>Usar usuario e senha</span></button>
          )}
        </div>
      )}

      {isDesktop ? (
        <div className="auth-links">
          <button type="button" className="auth-link-button" onClick={() => void desktop?.openExternalPath?.("/register")}>Criar conta no site</button>
        </div>
      ) : mode === "login" ? (
        <p className="auth-switch">Ainda nao tem conta? <button type="button" onClick={() => changeMode("register")}>Criar conta</button></p>
      ) : (
        <p className="auth-switch">Ja tem uma conta? <button type="button" onClick={() => changeMode("login")}>Entrar</button></p>
      )}

      <div className="auth-legal-links" aria-label="Informacoes legais">
        {mode === "register" && registerStep === "form" && <p>Ao criar a conta, voce confirma que tem pelo menos 16 anos e concorda com os documentos abaixo.</p>}
        <span>
          {isDesktop ? <button type="button" onClick={() => void desktop?.openExternalPath?.("/terms")}><FileText size={13}/> Termos de Uso</button> : <a href="/terms"><FileText size={13}/> Termos de Uso</a>}
          {isDesktop ? <button type="button" onClick={() => void desktop?.openExternalPath?.("/privacy")}><ShieldCheck size={13}/> Politica de Privacidade</button> : <a href="/privacy"><ShieldCheck size={13}/> Politica de Privacidade</a>}
        </span>
      </div>
    </form>
  );

  if (isDesktop) {
    return (
      <main className="auth-page auth-simple auth-desktop auth-v047-r2 auth-v047-r3 auth-v048-redesign">
        <div className="auth-desktop-brand" aria-label="Ginga"><img src="/ginga-mark.svg" alt=""/><strong>Ginga</strong></div>
        <section className="auth-panel">{form}</section>
      </main>
    );
  }

  return (
    <main className="auth-page auth-site auth-site-product auth-v047-r2 auth-v047-r3 auth-v048-redesign">
      <section className="auth-hero auth-product-side">
        <header className="auth-product-topbar">
          <div className="auth-brand-lockup"><img src="/ginga-mark.svg" alt=""/><strong>Ginga</strong></div>
          <nav className="auth-product-nav" aria-label="Links publicos">
            <a href="/knowledge"><BookOpen size={15}/> Ajuda</a>
            {githubRepositoryUrl && <a href={githubRepositoryUrl} target="_blank" rel="noreferrer"><Github size={15}/> GitHub</a>}
            {download ? <a href={download.href} title={`Windows ${download.version}`}><Download size={15}/> Windows</a> : downloadState === "loading" ? <span><Download size={15}/> Verificando</span> : <button type="button" onClick={retryDownload}><Download size={15}/> Atualizar</button>}
          </nav>
        </header>

        <div className="auth-product-content">
          <div className="auth-product-copy">
            <h1>Converse do seu jeito.</h1>
            <p>Texto, voz e compartilhamento de tela em um lugar simples de usar, sem tirar voce do que esta fazendo.</p>
          </div>

          <div className="auth-chat-mock" aria-label="Previa de uma conversa">
            <div className="auth-chat-mock-bar"><Headphones size={15}/><span>#estudio-geral</span><small>2 na chamada</small></div>
            <div className="auth-chat-mock-body">
              <div className="auth-chat-message">
                <span className="auth-chat-avatar violet">J</span>
                <div><strong>Jenifer</strong><p>bora subir a call, terminei os prints do layout</p></div>
              </div>
              <div className="auth-chat-message">
                <span className="auth-chat-avatar amber">B</span>
                <div><strong>Bosco</strong><p>entrando agora, vou compartilhar a tela</p></div>
              </div>
              <div className="auth-chat-typing"><span>Jenifer esta digitando</span><i/><i/><i/></div>
            </div>
          </div>
        </div>

        <div className="auth-capability-band" aria-label="Recursos principais">
          <div><MessageCircleMore size={18}/><span><strong>Mensagens diretas</strong><small>Historico sincronizado em qualquer dispositivo.</small></span></div>
          <div><Headphones size={18}/><span><strong>Canais de voz</strong><small>Entre e saia da conversa sem friccao.</small></span></div>
          <div><MonitorUp size={18}/><span><strong>Tela compartilhada</strong><small>Mostre o que importa sem plugin adicional.</small></span></div>
          <div><UsersRound size={18}/><span><strong>Comunidades</strong><small>Organize servidores, canais e pessoas.</small></span></div>
        </div>

        {(linuxDownloads.x64 || linuxDownloads.arm64) && (
          <div className="auth-linux-strip">
            {linuxDownloads.x64 && <span><strong>Linux x64</strong>{linuxDownloads.x64.files.map((file) => <a key={file.file} href={file.href}>{linuxFormatLabel(file.type)}</a>)}</span>}
            {linuxDownloads.arm64 && <span><strong>Linux ARM64</strong>{linuxDownloads.arm64.files.map((file) => <a key={file.file} href={file.href}>{linuxFormatLabel(file.type)}</a>)}</span>}
          </div>
        )}
      </section>

      <section className="auth-panel auth-site-panel auth-login-side">
        <div className="auth-mobile-brand" aria-label="Ginga"><span className="auth-mobile-brand-lockup"><img src="/ginga-mark.svg" alt=""/><strong>Ginga</strong></span></div>
        {form}
      </section>
    </main>
  );
}
