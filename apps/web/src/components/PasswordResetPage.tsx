import { useMemo, useState, type FormEvent } from "react";
import { ArrowLeft, Eye, EyeOff, KeyRound, Mail, ShieldCheck } from "lucide-react";
import { api, setToken } from "../lib/api";

type RequestResponse = { ok: boolean; message: string };
type ConfirmResponse = { ok: boolean; message: string };

export function PasswordResetPage() {
  const token = useMemo(() => new URLSearchParams(window.location.search).get("token")?.trim() ?? "", []);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [completed, setCompleted] = useState(false);

  async function requestReset(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError("");
    setNotice("");
    const form = new FormData(event.currentTarget);
    try {
      const response = await api<RequestResponse>("/api/auth/password-reset/request", {
        method: "POST",
        body: JSON.stringify({ email: String(form.get("email") ?? "").trim() })
      });
      setNotice(response.message || "Se a conta existir, enviaremos um link de redefinicao.");
      event.currentTarget.reset();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Nao foi possivel solicitar a redefinicao agora.");
    } finally {
      setLoading(false);
    }
  }

  async function confirmReset(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError("");
    setNotice("");
    const form = new FormData(event.currentTarget);
    const newPassword = String(form.get("newPassword") ?? "");
    const confirmPassword = String(form.get("confirmPassword") ?? "");
    if (newPassword.length < 8) {
      setError("A nova senha precisa ter pelo menos 8 caracteres.");
      setLoading(false);
      return;
    }
    if (newPassword !== confirmPassword) {
      setError("A confirmacao da senha nao confere.");
      setLoading(false);
      return;
    }
    try {
      const response = await api<ConfirmResponse>("/api/auth/password-reset/confirm", {
        method: "POST",
        body: JSON.stringify({ token, newPassword })
      });
      setToken(null);
      window.history.replaceState({}, "", "/reset-password");
      setCompleted(true);
      setNotice(response.message || "Senha alterada. Entre novamente com a nova senha.");
      event.currentTarget.reset();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Nao foi possivel redefinir a senha.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="auth-page auth-simple password-reset-page">
      <section className="auth-panel">
        <form className="auth-card password-reset-card" onSubmit={token && !completed ? confirmReset : requestReset}>
          <img className="auth-app-icon-image" src="/ginga-mark.svg" alt="" />
          <div className="auth-heading">
            <h2>{completed ? "Senha alterada" : token ? "Crie uma nova senha" : "Redefinir senha"}</h2>
            <p>{completed ? "Todas as sessoes antigas foram encerradas por seguranca." : token ? "Este link funciona uma unica vez e expira em 30 minutos." : "Informe o e-mail da sua conta. Se ela existir, enviaremos um link seguro de redefinicao."}</p>
          </div>

          {!token && !completed && (
            <label>E-mail<span className="password-field"><input name="email" type="email" required maxLength={160} autoComplete="email" placeholder="voce@exemplo.com" /><Mail size={17} /></span></label>
          )}

          {token && !completed && (
            <>
              <label>Nova senha<span className="password-field"><input name="newPassword" type={showPassword ? "text" : "password"} minLength={8} maxLength={128} required autoComplete="new-password" placeholder="••••••••" /><button type="button" onClick={() => setShowPassword((value) => !value)} aria-label="Mostrar ou ocultar senha">{showPassword ? <EyeOff size={18}/> : <Eye size={18}/>}</button></span></label>
              <label>Confirmar nova senha<input name="confirmPassword" type={showPassword ? "text" : "password"} minLength={8} maxLength={128} required autoComplete="new-password" placeholder="••••••••" /></label>
              <div className="verification-hint"><ShieldCheck size={16}/><span>Senhas encontradas em vazamentos conhecidos sao recusadas. Ao concluir, o token e as sessoes antigas serao invalidados.</span></div>
            </>
          )}

          {error && <div className="form-error">{error}</div>}
          {notice && <div className="inline-alert info"><ShieldCheck size={17}/><div><strong>{completed ? "Tudo certo" : "Confira seu e-mail"}</strong><span>{notice}</span></div></div>}

          {!completed && <button className="primary-button auth-submit" disabled={loading}><KeyRound size={17}/>{loading ? "Aguarde..." : token ? "Alterar senha" : "Enviar link de redefinicao"}</button>}
          <a className="auth-link-button password-reset-back" href="/"><ArrowLeft size={15}/> Voltar para entrar</a>
        </form>
      </section>
    </main>
  );
}
