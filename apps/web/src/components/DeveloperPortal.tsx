import { useCallback, useEffect, useMemo, useState, type CSSProperties, type FormEvent } from "react";
import {
  BookOpen, Bot, Check, Code2, Copy, ExternalLink, KeyRound, LayoutDashboard,
  Link2, Plus, RefreshCw, Server, ShieldCheck, TerminalSquare, Trash2, Webhook, X
} from "lucide-react";
import { api } from "../lib/api";
import { friendlyWebhookError } from "../lib/webhookErrors";
import type { DeveloperApplication, Guild, User, WebhookItem } from "../types";
import { Modal } from "./Modal";

const permissionOptions = [
  "VIEW_CHANNELS", "SEND_MESSAGES", "READ_HISTORY", "MANAGE_MESSAGES", "EMBED_LINKS",
  "ATTACH_FILES", "ADD_REACTIONS", "MANAGE_EVENTS", "MANAGE_FORUMS", "CONNECT", "SPEAK", "USE_VIDEO", "SHARE_SCREEN"
] as const;

const permissionLabels: Record<(typeof permissionOptions)[number], string> = {
  VIEW_CHANNELS: "Ver canais",
  SEND_MESSAGES: "Enviar mensagens",
  READ_HISTORY: "Ler historico",
  MANAGE_MESSAGES: "Gerenciar mensagens",
  EMBED_LINKS: "Incorporar links",
  ATTACH_FILES: "Anexar arquivos",
  ADD_REACTIONS: "Adicionar reacoes",
  MANAGE_EVENTS: "Gerenciar eventos",
  MANAGE_FORUMS: "Gerenciar foruns",
  CONNECT: "Entrar em voz",
  SPEAK: "Falar em voz",
  USE_VIDEO: "Usar video",
  SHARE_SCREEN: "Compartilhar tela"
};

const permissionDescriptions: Partial<Record<(typeof permissionOptions)[number], string>> = {
  VIEW_CHANNELS: "Permite enxergar canais liberados pela ACL.",
  SEND_MESSAGES: "Permite publicar mensagens nos canais autorizados.",
  READ_HISTORY: "Permite consultar o historico disponivel ao bot.",
  MANAGE_MESSAGES: "Permite moderar e remover mensagens.",
  EMBED_LINKS: "Permite gerar previews e cards de links.",
  ATTACH_FILES: "Permite enviar anexos pelas rotas de bot.",
  ADD_REACTIONS: "Permite reagir a mensagens.",
  MANAGE_EVENTS: "Permite criar e gerenciar eventos.",
  MANAGE_FORUMS: "Permite operar recursos de forum.",
  CONNECT: "Permite entrar em canais de voz.",
  SPEAK: "Permite transmitir audio em voz.",
  USE_VIDEO: "Permite publicar video quando suportado.",
  SHARE_SCREEN: "Permite compartilhar tela quando suportado."
};

const permissionPresets = {
  essential: ["VIEW_CHANNELS", "SEND_MESSAGES", "READ_HISTORY"],
  chat: ["VIEW_CHANNELS", "SEND_MESSAGES", "READ_HISTORY", "EMBED_LINKS", "ATTACH_FILES", "ADD_REACTIONS"],
  voice: ["VIEW_CHANNELS", "SEND_MESSAGES", "READ_HISTORY", "CONNECT", "SPEAK"]
} as const;

const highRiskPermissions = new Set(["MANAGE_MESSAGES", "MANAGE_EVENTS", "MANAGE_FORUMS", "USE_VIDEO", "SHARE_SCREEN"]);

type PortalSection = "overview" | "applications" | "webhooks" | "sdk" | "docs";
type DeveloperConfirmAction = { kind: "reset-token" | "remove-app" | "reset-webhook" | "remove-webhook"; webhook?: WebhookItem } | null;

function portalError(caught: unknown, fallback: string) {
  return caught instanceof Error && caught.message ? caught.message : fallback;
}

export function DeveloperPortal({ user, onExit }: { user: User; onExit: () => void }) {
  const [section, setSection] = useState<PortalSection>("overview");
  const [apps, setApps] = useState<DeveloperApplication[]>([]);
  const [guilds, setGuilds] = useState<Guild[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [newToken, setNewToken] = useState("");
  const [invitePermissions, setInvitePermissions] = useState<string[]>(["VIEW_CHANNELS", "SEND_MESSAGES", "READ_HISTORY"]);
  const [webhookGuildId, setWebhookGuildId] = useState("");
  const [webhooks, setWebhooks] = useState<WebhookItem[]>([]);
  const [newWebhookSecret, setNewWebhookSecret] = useState<{ id: string; token: string } | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(true);
  const [showCreateApp, setShowCreateApp] = useState(false);
  const [createPreset, setCreatePreset] = useState<keyof typeof permissionPresets>("essential");
  const [confirmAction, setConfirmAction] = useState<DeveloperConfirmAction>(null);
  const [confirmBusy, setConfirmBusy] = useState(false);

  const selected = useMemo(() => apps.find((app) => app.id === selectedId) ?? apps[0] ?? null, [apps, selectedId]);
  const webhookGuild = guilds.find((guild) => guild.id === webhookGuildId) ?? null;
  const manageableGuilds = useMemo(() => guilds.filter((guild) => guild.permissions.canManageWebhooks), [guilds]);

  function clearFeedback() { setError(""); setNotice(""); }

  const load = useCallback(async () => {
    setLoading(true);
    const [applicationResult, guildResult] = await Promise.allSettled([
      api<{ applications: DeveloperApplication[] }>("/api/developers/applications"),
      api<{ guilds: Guild[] }>("/api/guilds")
    ]);

    if (applicationResult.status === "fulfilled") {
      setApps(applicationResult.value.applications);
      setSelectedId((current) => current && applicationResult.value.applications.some((app) => app.id === current)
        ? current
        : applicationResult.value.applications[0]?.id ?? "");
    } else {
      setApps([]);
      setError(portalError(applicationResult.reason, "Falha ao carregar suas aplicacoes"));
    }

    if (guildResult.status === "fulfilled") {
      setGuilds(guildResult.value.guilds);
      setWebhookGuildId((current) => current && guildResult.value.guilds.some((guild) => guild.id === current)
        ? current
        : guildResult.value.guilds.find((guild) => guild.permissions.canManageWebhooks)?.id ?? "");
    } else {
      setGuilds([]);
      setError((current) => current || portalError(guildResult.reason, "Falha ao carregar seus servidores"));
    }
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => { if (webhookGuildId) void loadWebhooks(webhookGuildId); else setWebhooks([]); }, [webhookGuildId]);

  async function copyText(value: string, success: string) {
    try {
      await navigator.clipboard.writeText(value);
      setNotice(success);
      setError("");
    } catch {
      setError("Nao foi possivel copiar automaticamente. Selecione o valor manualmente.");
    }
  }

  async function createApp(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    clearFeedback();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    try {
      const result = await api<{ application: DeveloperApplication; token: string }>("/api/developers/applications", {
        method: "POST",
        body: JSON.stringify({
          name: String(form.get("name") || ""),
          description: String(form.get("description") || ""),
          publicBot: Boolean(form.get("publicBot")),
          iconColor: String(form.get("iconColor") || "#7667f5")
        })
      });
      setNewToken(result.token);
      setInvitePermissions([...permissionPresets[createPreset]]);
      await load();
      setSelectedId(result.application.id);
      setSection("applications");
      setShowCreateApp(false);
      formElement.reset();
      setNotice("Aplicacao criada. Copie o token agora; ele nao sera exibido novamente.");
    } catch (caught) {
      setError(portalError(caught, "Falha ao criar aplicacao"));
    }
  }

  async function setMessageContentIntent(enabled: boolean) {
    if (!selected) return;
    clearFeedback();
    try {
      await api(`/api/developers/applications/${selected.id}`, {
        method: "PATCH",
        body: JSON.stringify({ messageContentIntent: enabled })
      });
      await load();
      setNotice(enabled
        ? "Intent de conteudo de mensagens habilitado para este bot."
        : "Intent de conteudo de mensagens desabilitado. O Gateway nao entregara texto ao bot.");
    } catch (caught) {
      setError(portalError(caught, "Falha ao atualizar o intent de mensagens"));
    }
  }

  async function resetToken() {
    if (!selected) return;
    clearFeedback();
    try {
      const result = await api<{ token: string }>(`/api/developers/applications/${selected.id}/token/reset`, { method: "POST" });
      setNewToken(result.token);
      await load();
      setNotice("Token rotacionado. Atualize o segredo do bot antes de reinicia-lo.");
    } catch (caught) { setError(portalError(caught, "Falha ao resetar token")); }
  }

  async function removeApp() {
    if (!selected) return;
    clearFeedback();
    try {
      await api(`/api/developers/applications/${selected.id}`, { method: "DELETE" });
      setNewToken("");
      await load();
      setNotice("Aplicacao excluida.");
    } catch (caught) { setError(portalError(caught, "Falha ao excluir aplicacao")); }
  }

  function inviteUrl(app: DeveloperApplication) {
    return `${location.origin}/oauth2/authorize?client_id=${encodeURIComponent(app.clientId)}&scope=bot&permissions=${encodeURIComponent(invitePermissions.join(","))}`;
  }

  async function loadWebhooks(guildId: string) {
    if (!guildId) { setWebhooks([]); return; }
    try {
      const result = await api<{ webhooks: WebhookItem[] }>(`/api/developers/guilds/${guildId}/webhooks`);
      setWebhooks(result.webhooks);
    } catch (caught) {
      setWebhooks([]);
      setError(portalError(caught, "Falha ao carregar webhooks"));
    }
  }

  async function createWebhook(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    clearFeedback();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const guildId = String(form.get("guildId") || "").trim();
    const channelId = String(form.get("channelId") || "").trim();
    const name = String(form.get("name") || "").trim();
    if (!guildId) return setError("Primeiro escolha o servidor onde o webhook sera criado.");
    if (!channelId) return setError("Escolha o canal que vai receber as mensagens do webhook.");
    if (name.length < 2) return setError("Digite um nome com pelo menos 2 caracteres para identificar o webhook.");
    try {
      const result = await api<{ webhook: WebhookItem; token: string }>("/api/developers/webhooks", {
        method: "POST",
        body: JSON.stringify({ guildId, channelId, name })
      });
      setNewWebhookSecret({ id: result.webhook.id, token: result.token });
      await loadWebhooks(result.webhook.guildId);
      formElement.reset();
      setNotice(`Webhook ${result.webhook.name} criado em #${result.webhook.channel?.name ?? "canal"}. Copie a credencial agora; ela nao sera mostrada novamente.`);
    } catch (caught) {
      const friendly = friendlyWebhookError(caught);
      setError([friendly.message, friendly.hint].filter(Boolean).join(" "));
      if (friendly.field) formElement.querySelector<HTMLElement>(`[name="${friendly.field}"]`)?.focus();
    }
  }

  async function resetWebhook(webhook: WebhookItem) {
    clearFeedback();
    try {
      const result = await api<{ token: string }>(`/api/developers/webhooks/${webhook.id}/token/reset`, { method: "POST" });
      setNewWebhookSecret({ id: webhook.id, token: result.token });
      setNotice("Segredo rotacionado.");
    } catch (caught) { setError(portalError(caught, "Falha ao resetar webhook")); }
  }

  async function removeWebhook(webhook: WebhookItem) {
    clearFeedback();
    try {
      await api(`/api/developers/webhooks/${webhook.id}`, { method: "DELETE" });
      if (newWebhookSecret?.id === webhook.id) setNewWebhookSecret(null);
      await loadWebhooks(webhook.guildId);
      setNotice("Webhook excluido.");
    } catch (caught) { setError(portalError(caught, "Falha ao excluir webhook")); }
  }


  async function confirmDeveloperAction() {
    if (!confirmAction || confirmBusy) return;
    const action = confirmAction;
    setConfirmBusy(true);
    try {
      if (action.kind === "reset-token") await resetToken();
      else if (action.kind === "remove-app") await removeApp();
      else if (action.kind === "reset-webhook" && action.webhook) await resetWebhook(action.webhook);
      else if (action.kind === "remove-webhook" && action.webhook) await removeWebhook(action.webhook);
      setConfirmAction(null);
    } finally {
      setConfirmBusy(false);
    }
  }

  const confirmCopy = confirmAction ? (() => {
    if (confirmAction.kind === "reset-token") return { title: "Rotacionar token do bot?", body: "O token atual para de funcionar imediatamente. Atualize o segredo no seu bot antes de reinicia-lo.", action: "Rotacionar token", danger: false };
    if (confirmAction.kind === "remove-app") return { title: `Excluir ${selected?.name ?? "este bot"}?`, body: "Instalacoes, comandos e a identidade do bot serao removidos. Essa acao nao pode ser desfeita.", action: "Excluir bot", danger: true };
    if (confirmAction.kind === "reset-webhook") return { title: `Rotacionar ${confirmAction.webhook?.name ?? "webhook"}?`, body: "O segredo atual para de funcionar assim que o novo for criado.", action: "Rotacionar segredo", danger: false };
    return { title: `Excluir ${confirmAction.webhook?.name ?? "webhook"}?`, body: "O endpoint deixa de aceitar novas chamadas imediatamente.", action: "Excluir webhook", danger: true };
  })() : null;

  const webhookEndpoint = newWebhookSecret ? `${location.origin}/api/webhooks/${newWebhookSecret.id}` : "";
  const pythonExample = `import os\nimport gingabot\n\nintents = gingabot.Intents.default()\nintents.message_content = True\n\nbot = gingabot.Bot(\n    command_prefix="!",\n    intents=intents,\n    server_url="${location.origin}",\n)\n\n@bot.event\nasync def on_ready():\n    print(f"Online como {bot.user}")\n\n@bot.command(description="Testa o bot")\nasync def ping(ctx):\n    await ctx.reply("Pong!")\n\nbot.run(os.environ["GINGA_BOT_TOKEN"])`;

  const pageTitle = section === "overview" ? "Developer Portal"
    : section === "applications" ? "Bots Python"
      : section === "webhooks" ? "Webhooks"
        : section === "sdk" ? "SDK e exemplos"
          : "Documentacao";
  const pageSubtitle = section === "overview" ? "Crie bots Python, gerencie credenciais, webhooks e integracoes do Ginga em um unico lugar."
    : section === "applications" ? "Bots Python, comandos sincronizados pelo SDK, permissoes e instalacao por servidor."
      : section === "webhooks" ? "Endpoints isolados para CI/CD, alertas e automacoes externas."
        : section === "sdk" ? "SDK Python oficial com uma API familiar para bots, eventos e comandos."
          : "Fluxo de desenvolvimento e boas praticas para colocar integracoes em producao.";

  return <main className="portal-shell developer-portal developer-portal-v2">
    <aside className="portal-sidebar developer-sidebar-v2">
      <div className="portal-brand developer-brand-v2"><Code2/><div><strong>Ginga Developer</strong><span>Integracoes e automacao</span></div></div>
      <button className="portal-exit" onClick={onExit}>← Voltar ao Ginga</button>

      <div className="portal-section-label">PORTAL</div>
      <button className={`portal-nav-row ${section === "overview" ? "active" : ""}`} onClick={() => setSection("overview")}><LayoutDashboard size={17}/><span>Visao geral</span></button>
      <button className={`portal-nav-row ${section === "applications" ? "active" : ""}`} onClick={() => setSection("applications")}><Bot size={17}/><span>Bots Python</span></button>
      <button className={`portal-nav-row ${section === "webhooks" ? "active" : ""}`} onClick={() => setSection("webhooks")}><Webhook size={17}/><span>Webhooks</span></button>
      <button className={`portal-nav-row ${section === "sdk" ? "active" : ""}`} onClick={() => setSection("sdk")}><TerminalSquare size={17}/><span>SDK e exemplos</span></button>
      <button className={`portal-nav-row ${section === "docs" ? "active" : ""}`} onClick={() => setSection("docs")}><BookOpen size={17}/><span>Documentacao</span></button>

      <div className="portal-section-label developer-projects-label">PROJETOS</div>
      <div className="developer-project-list">
        {apps.map((app) => <button key={app.id} className={`portal-app-row ${selected?.id === app.id && section === "applications" ? "active" : ""}`} onClick={() => { setSelectedId(app.id); setNewToken(""); setSection("applications"); }}>
          <span style={{ background: app.iconColor }}>{app.name.slice(0, 1).toUpperCase()}</span>
          <div><strong>{app.name}</strong><small>{app.installCount ?? 0} instalacao{Number(app.installCount ?? 0) === 1 ? "" : "es"}</small></div>
        </button>)}
        {!loading && apps.length === 0 && <div className="developer-sidebar-empty">Nenhuma aplicacao criada.</div>}
      </div>

      <button className="developer-sidebar-create" onClick={() => setShowCreateApp(true)}><Plus size={16}/> Novo bot Python</button>
    </aside>

    <section className="portal-main developer-main-v2">
      <header className="portal-topbar developer-topbar-v2">
        <div className="portal-title-block"><span className="eyebrow">GINGA DEVELOPER</span><h1>{pageTitle}</h1><p>{pageSubtitle}</p></div>
        <div className="developer-topbar-actions"><button className="secondary-button developer-new-app-button" onClick={() => setShowCreateApp(true)}><Plus size={16}/><span>Novo bot Python</span></button><span className="portal-user"><ShieldCheck size={15}/> {user.displayName}</span></div>
      </header>

      <div className="developer-feedback-slot">{error && <div className="inline-alert danger">{error}</div>}{notice && <div className="inline-success"><Check size={15}/> {notice}</div>}</div>

      {section === "overview" && <div className="developer-overview-page">
        <div className="developer-overview-strip developer-overview-strip-v2">
          <article><span className="developer-overview-icon"><Bot size={18}/></span><div><small>APLICACOES</small><strong>{apps.length}</strong><em>{apps.reduce((total, app) => total + Number(app.installCount ?? 0), 0)} instalacoes</em></div></article>
          <article><span className="developer-overview-icon"><Server size={18}/></span><div><small>SERVIDORES</small><strong>{guilds.length}</strong><em>{manageableGuilds.length} com webhooks gerenciaveis</em></div></article>
          <article><span className="developer-overview-icon"><Webhook size={18}/></span><div><small>WEBHOOKS</small><strong>{webhooks.length}</strong><em>{webhookGuild ? `em ${webhookGuild.name}` : "selecione um servidor"}</em></div></article>
        </div>

        <div className="developer-home-grid">
          <section className="portal-card developer-quickstart-card">
            <header><LayoutDashboard/><div><h2>Comece sem se perder</h2><p>O fluxo abaixo cobre o caminho normal de uma integracao no Ginga.</p></div></header>
            <ol className="developer-quickstart-list">
              <li><b>1</b><span><strong>Crie uma aplicacao</strong><small>Ela representa seu projeto e gera a identidade do bot.</small></span></li>
              <li><b>2</b><span><strong>Guarde o token</strong><small>O token aparece uma vez. Salve em variavel de ambiente ou cofre.</small></span></li>
              <li><b>3</b><span><strong>Escolha as permissoes</strong><small>Solicite apenas o necessario para cada servidor.</small></span></li>
              <li><b>4</b><span><strong>Instale e conecte</strong><small>Autorize o bot e rode o SDK oficial em Python.</small></span></li>
            </ol>
            <div className="portal-action-row"><button className="primary-button" onClick={() => setShowCreateApp(true)}><Plus size={16}/> Criar primeira aplicacao</button><button className="secondary-button" onClick={() => setSection("docs")}><BookOpen size={16}/> Ver documentacao</button></div>
          </section>

          <section className="portal-card developer-security-card">
            <header><ShieldCheck/><div><h2>Seguranca da integracao</h2><p>Credenciais separadas da conta humana e menor privilegio por instalacao.</p></div></header>
            <ul className="developer-capability-list compact"><li><strong>Token isolado</strong><span>Nunca reutilize a sessao do usuario.</span></li><li><strong>Rotacao imediata</strong><span>Troque o token se houver qualquer suspeita de vazamento.</span></li><li><strong>ACL continua valendo</strong><span>Permissao do bot nao ignora acesso do canal.</span></li><li><strong>HTTPS/WSS</strong><span>Em acesso externo, nao trafegue token em HTTP puro.</span></li></ul>
          </section>
        </div>
      </div>}

      {section === "applications" && <div className="developer-applications-page">
        {loading ? <div className="developer-loading-state">Carregando aplicacoes...</div> : !selected ? <section className="developer-empty-state"><Bot size={34}/><h2>Nenhuma aplicacao ainda</h2><p>Crie uma identidade para o seu bot e receba um token separado da sua conta.</p><button className="primary-button" onClick={() => setShowCreateApp(true)}><Plus size={16}/> Criar aplicacao</button></section> : <>
          <section className="developer-app-hero" style={{ "--developer-app-color": selected.iconColor } as CSSProperties}>
            <span className="developer-app-avatar">{selected.name.slice(0, 1).toUpperCase()}</span>
            <div><small>BOT PYTHON</small><h2>{selected.name}</h2><p>{selected.description || "Sem descricao."}</p></div>
            <div className="developer-app-hero-meta"><span>Python 3.10+</span><span>{selected.publicBot ? "Publico" : "Privado"}</span><span>{selected.installCount ?? 0} instalacoes</span></div>
          </section>

          {newToken && <div className="one-time-secret developer-token-reveal"><KeyRound/><div><strong>Token exibido uma unica vez</strong><code>{newToken}</code><small>Guarde agora em um cofre ou variavel de ambiente. O Ginga armazena apenas o hash.</small></div><button onClick={() => void copyText(newToken, "Token copiado")}><Copy/></button></div>}

          <div className="developer-app-grid">
            <section className="portal-card developer-identity-card"><header><KeyRound/><div><h2>Identidade e credenciais</h2><p>Dados usados pelo seu processo para identificar a aplicacao.</p></div></header>
              <dl className="secret-list developer-secret-list"><div><dt>Application ID</dt><dd><code>{selected.id}</code><button onClick={() => void copyText(selected.id, "Application ID copiado")}><Copy size={14}/></button></dd></div><div><dt>Client ID</dt><dd><code>{selected.clientId}</code><button onClick={() => void copyText(selected.clientId, "Client ID copiado")}><Copy size={14}/></button></dd></div><div><dt>Usuario do bot</dt><dd><code>{selected.botUser ? `@${selected.botUser.username}` : "Nao criado"}</code></dd></div><div><dt>Token atual</dt><dd><code>{selected.tokenPrefix ? `${selected.tokenPrefix}••••••••` : "Nao gerado"}</code><button className="developer-inline-action" onClick={() => setConfirmAction({ kind: "reset-token" })}><RefreshCw size={14}/> Rotacionar</button></dd></div></dl>
              <label className="switch-row developer-intent-switch"><input type="checkbox" checked={Boolean(selected.messageContentIntent)} onChange={(event) => void setMessageContentIntent(event.target.checked)}/><span><strong>Conteudo de mensagens</strong><small>Intent sensivel. Necessario para comandos por texto como !ping e !ytsearch.</small></span></label>
              <div className="developer-danger-row"><span><strong>Excluir aplicacao</strong><small>Remove comandos, instalacoes e a identidade do bot.</small></span><button className="danger-button" onClick={() => setConfirmAction({ kind: "remove-app" })}><Trash2 size={15}/> Excluir</button></div>
            </section>

            <section className="portal-card developer-install-card developer-install-card-v3"><header><Link2/><div><h2>Instalar o bot</h2><p>Monte uma instalacao clara, revise os acessos e depois autorize no servidor.</p></div></header>
              <div className="developer-install-flow-v3">
                <div className="developer-install-step-v3"><b>1</b><span><strong>Escolha um perfil de acesso</strong><small>Voce ainda pode ajustar permissoes individualmente.</small></span></div>
                <div className="developer-install-presets-v3">
                  <button type="button" onClick={() => setInvitePermissions([...permissionPresets.essential])}><ShieldCheck size={15}/><span><strong>Essencial</strong><small>Texto basico</small></span></button>
                  <button type="button" onClick={() => setInvitePermissions([...permissionPresets.chat])}><Bot size={15}/><span><strong>Chat</strong><small>Links, anexos e reacoes</small></span></button>
                  <button type="button" onClick={() => setInvitePermissions([...permissionPresets.voice])}><Server size={15}/><span><strong>Voz</strong><small>Chat + entrar e falar</small></span></button>
                </div>
              </div>
              <div className="permission-picker developer-permission-picker-v2 developer-permission-picker-v3"><div className="developer-permission-heading-v3"><span><b>2</b><strong>Revise as permissoes</strong></span><small>{invitePermissions.length} selecionada{invitePermissions.length === 1 ? "" : "s"}</small></div><div className="developer-permission-grid">{permissionOptions.map((permission) => <label className={highRiskPermissions.has(permission) ? "sensitive" : ""} key={permission}><input type="checkbox" checked={invitePermissions.includes(permission)} onChange={(event) => setInvitePermissions((current) => event.target.checked ? [...new Set([...current, permission])] : current.filter((item) => item !== permission))}/><span><strong>{permissionLabels[permission]}</strong><small>{permissionDescriptions[permission]}</small></span></label>)}</div></div>
              <div className="developer-install-summary-v3"><div><span><b>3</b><strong>Autorize no servidor</strong></span><small>O administrador ainda revisa servidor e permissoes antes de concluir.</small></div><dl><div><dt>Visibilidade</dt><dd>{selected.publicBot ? "Publico" : "Privado"}</dd></div><div><dt>Instalacoes</dt><dd>{selected.installCount ?? 0}</dd></div></dl></div>
              <div className="portal-action-row developer-install-actions developer-install-actions-v3"><a className="primary-button" href={inviteUrl(selected)}><ExternalLink size={16}/> Abrir tela de instalacao</a><button type="button" className="secondary-button" onClick={() => void copyText(inviteUrl(selected), "Link de instalacao copiado")}><Copy size={16}/> Copiar link</button></div>
            </section>
          </div>

          <section className="portal-card developer-commands-card"><header><TerminalSquare/><div><h2>Comandos sincronizados pelo Python</h2><p>Defina os comandos no codigo com <code>@bot.command</code>. Ao conectar, o SDK atualiza este catalogo automaticamente.</p></div></header>
            <div className="developer-command-list">{selected.commands?.length ? selected.commands.map((command) => <div className="command-row" key={command.id}><code>/{command.name}</code><span>{command.description}</span><small>Python</small></div>) : <div className="developer-inline-empty">Nenhum comando sincronizado ainda. Inicie o bot Python para registrar os decorators.</div>}</div>
          </section>
        </>}
      </div>}

      {section === "webhooks" && <div className="developer-webhooks-page">
        <div className="developer-webhook-toolbar"><label>Servidor<select value={webhookGuildId} onChange={(event) => setWebhookGuildId(event.target.value)}><option value="">Selecione...</option>{manageableGuilds.map((guild) => <option key={guild.id} value={guild.id}>{guild.name}</option>)}</select></label><span>{webhookGuild ? `${webhooks.length} webhook${webhooks.length === 1 ? "" : "s"} em ${webhookGuild.name}` : "Escolha um servidor que voce possa administrar."}</span></div>
        <div className="developer-webhook-grid">
          <section className="portal-card developer-webhook-create-card"><header><Webhook/><div><h2>Criar webhook</h2><p>O Ginga vai gerar um endpoint e uma credencial para outro sistema publicar mensagens automaticamente.</p></div></header>
            <div className="webhook-create-guide"><span><b>1</b><small>Escolha o canal</small></span><span><b>2</b><small>De um nome</small></span><span><b>3</b><small>Copie a credencial</small></span></div>
            <form className="stack-form developer-clean-form" onSubmit={createWebhook}><input type="hidden" name="guildId" value={webhookGuildId}/><label><span>1. Canal de destino</span><select name="channelId" required disabled={!webhookGuild}><option value="">Escolha onde as mensagens vao aparecer...</option>{webhookGuild?.channels.filter((channel) => ["TEXT", "ANNOUNCEMENT"].includes(channel.type)).map((channel) => <option key={channel.id} value={channel.id}>#{channel.name}</option>)}</select><small>Somente canais de texto e anuncios podem receber webhooks.</small></label><label><span>2. Nome do webhook</span><input name="name" required minLength={2} maxLength={64} placeholder="Ex.: Deploy, Zabbix, Alertas" disabled={!webhookGuild}/><small>Esse nome aparece como identidade das mensagens enviadas.</small></label><button className="primary-button" disabled={!webhookGuild}><Plus size={16}/> 3. Criar webhook e gerar credencial</button></form>
            <div className="webhook-create-note"><ShieldCheck size={16}/><span><strong>Depois de criar</strong><small>Copie o endpoint e o segredo para o sistema externo. O segredo aparece somente uma vez.</small></span></div>
            {newWebhookSecret && <div className="one-time-secret webhook-secret-safe developer-webhook-secret"><KeyRound/><div><strong>Copie o segredo agora</strong><code>{newWebhookSecret.token}</code><small>Endpoint: {webhookEndpoint}<br/>Use <code>Authorization: Bearer &lt;token&gt;</code>.</small></div><div className="webhook-secret-actions"><button onClick={() => void copyText(newWebhookSecret.token, "Segredo copiado")}><Copy/> Segredo</button><button onClick={() => void copyText(webhookEndpoint, "Endpoint copiado")}><Copy/> Endpoint</button></div></div>}
          </section>
          <section className="portal-card"><header><ShieldCheck/><div><h2>Webhooks ativos</h2><p>Segredos nao sao reexibidos. Voce pode rotacionar ou remover.</p></div></header><div className="webhook-list detailed developer-webhook-list">{!webhookGuild && <div className="settings-empty-state">Selecione um servidor.</div>}{webhookGuild && webhooks.length === 0 && <div className="settings-empty-state">Nenhum webhook neste servidor.</div>}{webhooks.map((webhook) => <article key={webhook.id}><div><Webhook size={15}/><span><strong>{webhook.name}</strong><small>#{webhook.channel?.name ?? "canal"} · {webhook.tokenPrefix}••••</small></span></div><div><button onClick={() => setConfirmAction({ kind: "reset-webhook", webhook })} aria-label="Rotacionar segredo"><RefreshCw size={15}/></button><button onClick={() => setConfirmAction({ kind: "remove-webhook", webhook })} aria-label="Excluir webhook"><Trash2 size={15}/></button></div></article>)}</div></section>
        </div>
      </div>}

      {section === "sdk" && <div className="developer-sdk-page">
        <section className="portal-card developer-docs-hero">
          <header><TerminalSquare/><div><h2>Ginga Bot SDK para Python</h2><p>SDK oficial publicado como <code>ginga-bot</code>. No codigo, use <code>import gingabot</code>. Requer Python 3.10+.</p></div></header>
          <div className="developer-docs-steps">
            <article><b>01</b><div><strong>Crie o bot</strong><p>Abra Bots Python, crie a identidade e copie o token exibido uma unica vez.</p></div></article>
            <article><b>02</b><div><strong>Instale no servidor</strong><p>Revise permissoes e conclua a autorizacao no servidor onde o bot vai operar.</p></div></article>
            <article><b>03</b><div><strong>Instale o SDK</strong><p><code>python -m pip install -U ginga-bot</code></p></div></article>
            <article><b>04</b><div><strong>Configure o ambiente</strong><p>Defina <code>GINGA_SERVER</code> e <code>GINGA_BOT_TOKEN</code>. Nunca salve token no codigo.</p></div></article>
            <article><b>05</b><div><strong>Execute e teste</strong><p>Rode <code>python bot.py</code> e teste <code>!ping</code> em um canal permitido.</p></div></article>
          </div>
          <div className="portal-action-row"><a className="secondary-button" href="https://pypi.org/project/ginga-bot/" target="_blank" rel="noreferrer"><ExternalLink size={16}/> Abrir ginga-bot no PyPI</a><a className="secondary-button" href="/knowledge?article=bot-python-install"><BookOpen size={16}/> Guia completo</a></div>
        </section>

        <div className="developer-sdk-grid">
          <section className="portal-card">
            <header><TerminalSquare/><div><h2>1. Instalar</h2><p>Use sempre o mesmo Python para instalar e executar o bot.</p></div></header>
            <div className="sdk-step"><strong>Instalacao padrao</strong><code>python -m pip install -U ginga-bot</code></div>
            <div className="sdk-step"><strong>Confirmar versao</strong><code>python -c "import gingabot; print(gingabot.__version__)"</code></div>
            <button className="secondary-button" onClick={() => void copyText('python -m pip install -U ginga-bot', 'Comando de instalacao copiado')}><Copy size={16}/> Copiar instalacao</button>
          </section>
          <section className="portal-card">
            <header><ShieldCheck/><div><h2>pip nao encontrou?</h2><p>Isso normalmente indica Python antigo, cache ou um indice/mirror configurado na maquina.</p></div></header>
            <div className="sdk-step"><strong>Confira o Python</strong><code>python --version</code></div>
            <div className="sdk-step"><strong>Forcar PyPI oficial</strong><code>python -m pip install --no-cache-dir --index-url https://pypi.org/simple ginga-bot</code></div>
            <button className="secondary-button" onClick={() => void copyText('python -m pip install --no-cache-dir --index-url https://pypi.org/simple ginga-bot', 'Comando de diagnostico copiado')}><Copy size={16}/> Copiar diagnostico</button>
          </section>
        </div>

        <div className="developer-sdk-grid">
          <section className="portal-card">
            <header><KeyRound/><div><h2>2. Credenciais</h2><p>O token do bot deve existir apenas no ambiente do processo.</p></div></header>
            <div className="sdk-step"><strong>Windows PowerShell</strong><code>$env:GINGA_SERVER="{location.origin}"{`\n`}$env:GINGA_BOT_TOKEN="seu_token"</code></div>
            <div className="sdk-step"><strong>Linux</strong><code>export GINGA_SERVER="{location.origin}"{`\n`}export GINGA_BOT_TOKEN="seu_token"</code></div>
            <div className="inline-alert info"><KeyRound size={16}/><div><strong>Nunca cole o token no codigo</strong><span>Se a credencial vazar, rotacione no Portal Developer antes de voltar o bot para producao.</span></div></div>
          </section>
          <section className="portal-card">
            <header><Code2/><div><h2>3. MESSAGE_CONTENT</h2><p>Comandos como <code>!ping</code> dependem do conteudo das mensagens.</p></div></header>
            <ul className="developer-capability-list"><li><strong>No Python</strong><span><code>intents.message_content = True</code></span></li><li><strong>No Ginga Developer</strong><span>Ative <b>Conteudo de mensagens</b> na configuracao do bot.</span></li><li><strong>No servidor</strong><span>O bot ainda precisa das permissoes e da ACL efetiva do canal.</span></li></ul>
          </section>
        </div>

        <div className="developer-sdk-grid">
          <section className="portal-card">
            <header><Bot/><div><h2>4. Primeiro bot</h2><p>Exemplo funcional com evento de ready e comando <code>!ping</code>.</p></div></header>
            <pre><code>{pythonExample}</code></pre>
            <button className="secondary-button" onClick={() => void copyText(pythonExample, "Exemplo Python copiado")}><Copy size={16}/> Copiar bot.py</button>
          </section>
          <section className="portal-card">
            <header><ExternalLink/><div><h2>Gateway, comandos e objetos</h2><p>REST para acoes e Socket.IO para eventos em tempo real.</p></div></header>
            <ul className="developer-capability-list"><li><strong>Intents</strong><span>GUILDS, GUILD_MESSAGES, MESSAGE_CONTENT e VOICE_STATES.</span></li><li><strong>Decorators</strong><span><code>@bot.event</code> e <code>@bot.command</code>.</span></li><li><strong>Objetos</strong><span>Bot, Context, Message, User, Member, Channel e Role.</span></li><li><strong>Argumentos</strong><span>Conversao automatica de <code>str</code>, <code>int</code>, <code>float</code> e <code>bool</code>.</span></li><li><strong>Rate limit</strong><span>Retry limitado respeitando <code>Retry-After</code>.</span></li><li><strong>Reconexao</strong><span>O cliente Socket.IO tenta recuperar a sessao automaticamente.</span></li><li><strong>ACL</strong><span>O SDK nao ignora permissoes do servidor nem do canal.</span></li></ul>
          </section>
        </div>
      </div>}

      {section === "docs" && <div className="developer-docs-page">
        <section className="portal-card developer-docs-hero">
          <header><BookOpen/><div><h2>Documentacao oficial do Ginga Developer</h2><p>Do primeiro <code>pip install</code> ate operacao 24/7, sem depender de tentativa e erro.</p></div></header>
          <div className="developer-docs-steps"><article><b>01</b><div><strong>Criar o bot</strong><p>Identidade, token e instalacao por servidor.</p></div></article><article><b>02</b><div><strong>Instalar o SDK</strong><p><code>python -m pip install -U ginga-bot</code> e <code>import gingabot</code>.</p></div></article><article><b>03</b><div><strong>Intents + permissoes</strong><p>Receber um evento nao significa ter permissao para executar a acao.</p></div></article><article><b>04</b><div><strong>Comandos + eventos</strong><p>Decorators, argumentos, Context, Message e Gateway.</p></div></article><article><b>05</b><div><strong>Producao</strong><p>Secrets, logs, rate limit, reconexao e restart controlado.</p></div></article></div>
          <div className="portal-action-row"><a className="secondary-button" href="/knowledge?article=dev-primeiros-passos"><BookOpen size={16}/> Comecar do zero</a><a className="secondary-button" href="/knowledge?article=bot-python-install"><TerminalSquare size={16}/> Instalar SDK</a><a className="secondary-button" href="https://pypi.org/project/ginga-bot/" target="_blank" rel="noreferrer"><ExternalLink size={16}/> PyPI</a></div>
        </section>
        <div className="developer-docs-grid">
          <section className="portal-card"><h3>Guias recomendados</h3><ul className="developer-capability-list"><li><strong>Primeiro bot</strong><span><a href="/knowledge?article=bot-python">Token, ambiente, bot.py e !ping.</a></span></li><li><strong>Comandos e eventos</strong><span><a href="/knowledge?article=bot-python-comandos">Decorators, argumentos tipados e handlers.</a></span></li><li><strong>IDs e objetos</strong><span><a href="/knowledge?article=dev-ids">Channel ID, Role ID, User ID e Guild ID.</a></span></li><li><strong>Intents e permissoes</strong><span><a href="/knowledge?article=dev-permissoes">ACL, menor privilegio e MESSAGE_CONTENT.</a></span></li><li><strong>Erros comuns</strong><span><a href="/knowledge?article=bot-python-erros">pip, 401, 403, WebSocket e bot sem responder.</a></span></li></ul></section>
          <section className="portal-card"><h3>Checklist de producao</h3><ul className="developer-doc-checklist"><li><Check size={15}/> Python 3.10+ e ambiente isolado.</li><li><Check size={15}/> HTTPS/WSS para acesso externo.</li><li><Check size={15}/> Token fora do Git, frontend e logs.</li><li><Check size={15}/> Intents e permissoes minimas.</li><li><Check size={15}/> Retry, timeout e rate limit tratados.</li><li><Check size={15}/> Restart controlado com systemd/container.</li><li><Check size={15}/> Rotacao imediata se a credencial vazar.</li></ul></section>
        </div>
        <div className="developer-docs-grid"><section className="portal-card"><h3>Bot ou webhook?</h3><p className="developer-doc-copy">Use <b>webhook</b> quando um sistema externo so precisa publicar mensagens, como CI/CD e monitoramento. Use <b>Ginga Bot SDK</b> quando voce precisa receber eventos, responder comandos, consultar recursos e manter uma conexao em tempo real.</p><div className="portal-action-row"><button className="secondary-button" onClick={() => setSection("webhooks")}><Webhook size={16}/> Webhooks</button><button className="secondary-button" onClick={() => setSection("sdk")}><Bot size={16}/> SDK Python</button></div></section><section className="portal-card"><h3>Publicacao do SDK</h3><p className="developer-doc-copy">A versao do SDK e independente da versao do servidor. Releases do PyPI sao imutaveis: codigo novo exige uma nova versao do pacote. O repositorio usa Trusted Publishing via GitHub Actions.</p><code>sdk/python/PUBLISHING.md</code></section></div>
      </div>}
    </section>


    {confirmAction && confirmCopy && <Modal title={confirmCopy.title} width="sm" onClose={() => { if (!confirmBusy) setConfirmAction(null); }}>
      <div className="developer-confirm-v2">
        <span className={confirmCopy.danger ? "danger" : "warning"}>{confirmCopy.danger ? <Trash2 size={22}/> : <ShieldCheck size={22}/>}</span>
        <p>{confirmCopy.body}</p>
        <div className="modal-actions"><button type="button" className="secondary-button" disabled={confirmBusy} onClick={() => setConfirmAction(null)}>Cancelar</button><button type="button" className={confirmCopy.danger ? "danger-button" : "primary-button"} disabled={confirmBusy} onClick={() => void confirmDeveloperAction()}>{confirmBusy ? "Aguarde..." : confirmCopy.action}</button></div>
      </div>
    </Modal>}

    {showCreateApp && <Modal title="Criar bot" width="md" onClose={() => setShowCreateApp(false)}>
      <form className="stack-form developer-create-modal developer-create-bot-v2" onSubmit={createApp}>
        <div className="developer-create-intro"><span><Bot size={22}/></span><div><strong>Novo bot do Ginga</strong><p>Crie a identidade agora. Permissoes do servidor sao escolhidas depois, na instalacao.</p></div></div>
        <div className="developer-create-fields-v2"><label>Nome do bot<input name="name" required minLength={2} maxLength={64} placeholder="Ex.: GingaOps" autoFocus/></label><label>Cor<input className="developer-color-input" name="iconColor" type="color" defaultValue="#7667f5"/></label><label className="full">O que esse bot faz?<textarea name="description" rows={3} maxLength={240} placeholder="Ex.: envia alertas de deploy e responde comandos da equipe"/></label></div>
        <fieldset className="developer-bot-purpose-v2"><legend>Uso inicial</legend><p>Isso so prepara a lista de permissoes sugeridas. Voce ainda revisa tudo antes de instalar.</p><div>
          <button type="button" className={createPreset==="essential"?"active":""} onClick={()=>setCreatePreset("essential")}><Bot size={17}/><span><strong>Comandos basicos</strong><small>Ler canais e responder mensagens.</small></span></button>
          <button type="button" className={createPreset==="chat"?"active":""} onClick={()=>setCreatePreset("chat")}><Code2 size={17}/><span><strong>Chat e anexos</strong><small>Mensagens, links, arquivos e reacoes.</small></span></button>
          <button type="button" className={createPreset==="voice"?"active":""} onClick={()=>setCreatePreset("voice")}><Server size={17}/><span><strong>Voz</strong><small>Entrar e falar em canais de voz.</small></span></button>
        </div></fieldset>
        <label className="switch-row developer-public-bot-toggle"><input type="checkbox" name="publicBot"/><span><strong>Permitir que outros servidores instalem este bot</strong><small>Deixe desligado para bots internos ou em desenvolvimento.</small></span></label>
        <div className="inline-alert info"><KeyRound size={16}/><div><strong>O token aparece uma vez</strong><span>Depois de criar, copie o token e guarde fora do codigo. O Ginga armazena somente o hash.</span></div></div>
        <div className="modal-actions"><button type="button" className="secondary-button" onClick={() => setShowCreateApp(false)}><X size={16}/> Cancelar</button><button className="primary-button"><Plus size={16}/> Criar bot</button></div>
      </form>
    </Modal>}
  </main>;
}

export function OAuthAuthorize({ onExit }: { onExit: () => void }) {
  const params = new URLSearchParams(location.search);
  const clientId = params.get("client_id") || "";
  const requested = (params.get("permissions") || "VIEW_CHANNELS,SEND_MESSAGES,READ_HISTORY").split(",").filter(Boolean);
  const [data, setData] = useState<{ application: DeveloperApplication; guilds: Guild[]; permissions: string[] } | null>(null);
  const [guildId, setGuildId] = useState("");
  const [permissions, setPermissions] = useState<string[]>(requested);
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    api<{ application: DeveloperApplication; guilds: Guild[]; permissions: string[] }>(`/api/oauth/applications/${encodeURIComponent(clientId)}`)
      .then((result) => {
        if (!active) return;
        setData(result);
        setGuildId(result.guilds[0]?.id ?? "");
        setPermissions((current) => current.filter((permission) => result.permissions.includes(permission)));
      })
      .catch((caught) => { if (active) setError(caught instanceof Error ? caught.message : "Aplicacao invalida"); });
    return () => { active = false; };
  }, [clientId]);

  async function authorize() {
    if (!data || !guildId || busy) return;
    setBusy(true); setError("");
    try {
      await api(`/api/oauth/applications/${encodeURIComponent(clientId)}/authorize`, {
        method: "POST",
        body: JSON.stringify({ guildId, permissions })
      });
      setDone(true);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Falha ao autorizar");
    } finally { setBusy(false); }
  }

  const selectedGuild = data?.guilds.find((guild) => guild.id === guildId) ?? null;
  const available = (data?.permissions ?? []).filter((permission): permission is (typeof permissionOptions)[number] => permissionOptions.includes(permission as (typeof permissionOptions)[number]));
  const regularPermissions = available.filter((permission) => !highRiskPermissions.has(permission));
  const sensitivePermissions = available.filter((permission) => highRiskPermissions.has(permission));

  if (done) return <main className="oauth-install-page"><section className="oauth-success-card-v3"><span><Check size={30}/></span><small>INSTALACAO CONCLUIDA</small><h1>{data?.application.name ?? "Bot"} esta pronto</h1><p>O bot foi adicionado em <strong>{selectedGuild?.name ?? "seu servidor"}</strong> com as permissoes aprovadas.</p><div><button className="primary-button" onClick={onExit}>Voltar ao Ginga</button></div></section></main>;

  return <main className="oauth-install-page">
    <div className="oauth-install-shell-v3">
      <aside className="oauth-install-aside-v3">
        <button className="oauth-install-back-v3" onClick={onExit}>← Voltar</button>
        <div className="oauth-install-brand-v3"><span>G</span><div><strong>Ginga</strong><small>Instalacao segura de aplicativo</small></div></div>
        <div className="oauth-install-app-v3" style={{ "--oauth-app-color": data?.application.iconColor ?? "#7867e8" } as CSSProperties}>
          <span>{data?.application.name?.slice(0, 1).toUpperCase() ?? "B"}</span>
          <div><small>BOT PYTHON</small><h1>{data?.application.name ?? "Carregando..."}</h1><p>{data?.application.description || "Aplicacao integrada ao Ginga."}</p></div>
        </div>
        <div className="oauth-install-trust-v3"><ShieldCheck size={18}/><div><strong>Voce continua no controle</strong><p>Servidor e permissoes sao aprovados antes da instalacao. ACL de canal continua valendo depois.</p></div></div>
      </aside>

      <section className="oauth-install-main-v3">
        <header><span>REVISAO DA INSTALACAO</span><h2>Adicionar ao servidor</h2><p>Confirme onde o bot vai entrar e exatamente o que ele podera fazer.</p></header>
        {error && <div className="inline-alert danger">{error}</div>}

        {!data && !error ? <div className="oauth-install-loading-v3"><RefreshCw className="spin" size={20}/> Carregando aplicacao...</div> : data && <>
          <label className="oauth-server-picker-v3"><span>1</span><div><strong>Servidor</strong><small>Somente servidores que voce pode administrar aparecem aqui.</small><select value={guildId} onChange={(event) => setGuildId(event.target.value)}><option value="">Selecione um servidor</option>{data.guilds.map((guild) => <option value={guild.id} key={guild.id}>{guild.name}</option>)}</select></div></label>

          <section className="oauth-permissions-v3">
            <div className="oauth-permissions-head-v3"><span>2</span><div><strong>Permissoes</strong><small>{permissions.length} acesso{permissions.length === 1 ? "" : "s"} selecionado{permissions.length === 1 ? "" : "s"}</small></div></div>
            {regularPermissions.length > 0 && <div className="oauth-permission-group-v3"><h3>Acesso padrao</h3>{regularPermissions.map((permission) => <label key={permission}><input type="checkbox" checked={permissions.includes(permission)} onChange={(event) => setPermissions((current) => event.target.checked ? [...new Set([...current, permission])] : current.filter((item) => item !== permission))}/><span><strong>{permissionLabels[permission]}</strong><small>{permissionDescriptions[permission]}</small></span></label>)}</div>}
            {sensitivePermissions.length > 0 && <div className="oauth-permission-group-v3 sensitive"><h3>Acesso avancado</h3>{sensitivePermissions.map((permission) => <label key={permission}><input type="checkbox" checked={permissions.includes(permission)} onChange={(event) => setPermissions((current) => event.target.checked ? [...new Set([...current, permission])] : current.filter((item) => item !== permission))}/><span><strong>{permissionLabels[permission]}</strong><small>{permissionDescriptions[permission]}</small></span></label>)}</div>}
          </section>

          <div className="oauth-install-summary-v3"><div><Server size={17}/><span><small>DESTINO</small><strong>{selectedGuild?.name ?? "Selecione um servidor"}</strong></span></div><div><ShieldCheck size={17}/><span><small>PERMISSOES</small><strong>{permissions.length} selecionadas</strong></span></div></div>

          <div className="oauth-install-actions-v3"><button className="secondary-button" onClick={onExit}><X size={16}/> Cancelar</button><button className="primary-button" disabled={!guildId || busy} onClick={() => void authorize()}>{busy ? <RefreshCw className="spin" size={16}/> : <Check size={16}/>} {busy ? "Instalando..." : "Autorizar e instalar"}</button></div>
          <p className="oauth-install-footnote-v3">Ao autorizar, o Ginga registra quem instalou a aplicacao e quais permissoes foram aprovadas.</p>
        </>}
      </section>
    </div>
  </main>;
}
