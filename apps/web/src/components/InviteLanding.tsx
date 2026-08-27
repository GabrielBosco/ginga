import { useEffect, useState } from "react";
import { ArrowLeft, CheckCircle2, Users } from "lucide-react";
import { api } from "../lib/api";

interface InvitePreview {
  code: string;
  expiresAt: string | null;
  uses: number;
  maxUses: number | null;
  valid: boolean;
  guild: { id: string; name: string; iconColor: string; memberCount: number };
}

export function InviteLanding({ code, onDone, onExit }: { code: string; onDone: () => void; onExit: () => void }) {
  const [invite, setInvite] = useState<InvitePreview | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    api<{ invite: InvitePreview }>(`/api/invites/${encodeURIComponent(code)}`)
      .then((result) => { if (active) setInvite(result.invite); })
      .catch((caught) => { if (active) setError(caught instanceof Error ? caught.message : "Convite invalido"); });
    return () => { active = false; };
  }, [code]);

  async function join() {
    if (!invite?.valid) return;
    setBusy(true); setError("");
    try {
      await api(`/api/invites/${encodeURIComponent(code)}/join`, { method: "POST" });
      onDone();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Nao foi possivel entrar no espaco");
    } finally { setBusy(false); }
  }

  return <main className="oauth-shell invite-landing-shell">
    <section className="oauth-card invite-landing-card">
      <button className="portal-exit invite-back" onClick={onExit}><ArrowLeft size={16}/> Voltar</button>
      <div className="invite-brand"><img src="/ginga-mark.svg" alt=""/><strong>Ginga</strong></div>
      {invite ? <>
        <div className="invite-server-icon" style={{ background: invite.guild.iconColor }}>{invite.guild.name.slice(0, 1).toUpperCase()}</div>
        <span className="eyebrow">VOCE FOI CONVIDADO</span>
        <h1>{invite.guild.name}</h1>
        <div className="invite-preview-meta"><Users size={16}/><span>{invite.guild.memberCount} membro{invite.guild.memberCount === 1 ? "" : "s"}</span>{invite.valid && <><CheckCircle2 size={16}/><span>Convite valido</span></>}</div>
        {invite.expiresAt && <p className="muted-copy">Valido ate {new Date(invite.expiresAt).toLocaleString("pt-BR")}</p>}
        {!invite.valid && <div className="inline-alert danger">Este convite expirou ou atingiu o limite de usos.</div>}
        {error && <div className="inline-alert danger">{error}</div>}
        <button className="primary-button invite-join-button" disabled={busy || !invite.valid} onClick={() => void join()}>{busy ? "Entrando..." : `Entrar em ${invite.guild.name}`}</button>
      </> : error ? <><h1>Convite indisponivel</h1><div className="inline-alert danger">{error}</div></> : <><h1>Carregando convite...</h1><p className="muted-copy">Validando o link e o espaco.</p></>}
    </section>
  </main>;
}
