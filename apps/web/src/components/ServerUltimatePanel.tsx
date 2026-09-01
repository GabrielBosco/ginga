import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  BadgePlus,
  Boxes,
  CirclePlus,
  DoorOpen,
  ImagePlus,
  Save,
  ShieldAlert,
  SmilePlus,
  Sparkles,
  Trash2,
  WandSparkles
} from "lucide-react";
import { api } from "../lib/api";
import { gingaConfirm, gingaPrompt } from "../lib/dialogs";
import type {
  DynamicVoiceTemplate,
  Guild,
  GuildBadgeV2,
  GuildCustomEmoji,
  GuildMember,
  GuildSecurityPolicyV2,
  GuildSpace,
  GuildSticker,
  GuildStructure,
  OnboardingQuestion
} from "../types";

type Tab = "spaces" | "assets" | "onboarding" | "voice" | "security" | "badges";
type PanelTab = { id: Tab; label: string; icon: ReactNode; allowed: boolean };

const basePolicy: GuildSecurityPolicyV2 = {
  antiRaidEnabled: false,
  joinWindowSeconds: 30,
  joinLimit: 8,
  quarantineEnabled: false,
  quarantineMinutes: 10,
  newAccountHours: 24,
  blockExternalLinks: false,
  blockInvites: false,
  maxMentions: 8,
  duplicateLimit: 5,
  requireModerationReason: false,
  autoTimeoutMinutes: 0,
  modLogChannelId: null
};

function errorText(caught: unknown, fallback: string) {
  return caught instanceof Error && caught.message ? caught.message : fallback;
}

export function ServerUltimatePanel({
  guild,
  members,
  onRefresh
}: {
  guild: Guild;
  members: GuildMember[];
  onRefresh?: () => void | Promise<void>;
}) {
  const [tab, setTab] = useState<Tab>("spaces");
  const [spaces, setSpaces] = useState<GuildSpace[]>([]);
  const [emojis, setEmojis] = useState<GuildCustomEmoji[]>([]);
  const [stickers, setStickers] = useState<GuildSticker[]>([]);
  const [questions, setQuestions] = useState<OnboardingQuestion[]>([]);
  const [templates, setTemplates] = useState<DynamicVoiceTemplate[]>([]);
  const [badges, setBadges] = useState<GuildBadgeV2[]>([]);
  const [structure, setStructure] = useState<GuildStructure | null>(null);
  const [policy, setPolicy] = useState<GuildSecurityPolicyV2>(basePolicy);
  const [assetName, setAssetName] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const tabs = useMemo<PanelTab[]>(() => {
    const items: PanelTab[] = [
      { id: "spaces", label: "Areas", icon: <Boxes size={15} />, allowed: Boolean(guild.permissions.canManageChannels) },
      { id: "assets", label: "Emojis e stickers", icon: <SmilePlus size={15} />, allowed: Boolean(guild.permissions.canManageServer) },
      { id: "onboarding", label: "Onboarding", icon: <WandSparkles size={15} />, allowed: Boolean(guild.permissions.canManageServer) },
      { id: "voice", label: "Salas dinamicas", icon: <DoorOpen size={15} />, allowed: Boolean(guild.permissions.canManageChannels) },
      { id: "security", label: "Protecao", icon: <ShieldAlert size={15} />, allowed: Boolean(guild.permissions.canManageAutoMod) },
      { id: "badges", label: "Badges", icon: <BadgePlus size={15} />, allowed: Boolean(guild.permissions.canManageRoles) }
    ];
    return items.filter((item) => item.allowed);
  }, [guild.permissions]);

  useEffect(() => {
    if (!tabs.some((item) => item.id === tab) && tabs[0]) setTab(tabs[0].id);
  }, [tab, tabs]);

  async function load() {
    setLoading(true);
    setError("");
    const jobs: Array<{ label: string; run: () => Promise<void> }> = [
      { label: "areas", run: () => api<{ spaces: GuildSpace[] }>(`/api/guilds/${guild.id}/spaces`).then((result) => setSpaces(result.spaces)) },
      { label: "emojis", run: () => api<{ emojis: GuildCustomEmoji[] }>(`/api/guilds/${guild.id}/emojis`).then((result) => setEmojis(result.emojis)) },
      { label: "stickers", run: () => api<{ stickers: GuildSticker[] }>(`/api/guilds/${guild.id}/stickers`).then((result) => setStickers(result.stickers)) },
      { label: "onboarding", run: () => api<{ questions: OnboardingQuestion[] }>(`/api/guilds/${guild.id}/onboarding`).then((result) => setQuestions(result.questions)) },
      { label: "salas dinamicas", run: () => api<{ templates: DynamicVoiceTemplate[] }>(`/api/guilds/${guild.id}/dynamic-voice/templates`).then((result) => setTemplates(result.templates)) },
      { label: "badges", run: () => api<{ badges: GuildBadgeV2[] }>(`/api/guilds/${guild.id}/badges`).then((result) => setBadges(result.badges)) }
    ];

    if (guild.permissions.canManageServer) {
      jobs.push({ label: "estrutura", run: () => api<GuildStructure>(`/api/guilds/${guild.id}/structure`).then(setStructure) });
    }
    if (guild.permissions.canManageAutoMod) {
      jobs.push({ label: "protecao", run: () => api<{ policy: GuildSecurityPolicyV2 }>(`/api/guilds/${guild.id}/security-policy`).then((result) => setPolicy(result.policy)) });
    }

    const results = await Promise.allSettled(jobs.map((job) => job.run()));
    const failed = results
      .map((result, index) => result.status === "rejected" ? jobs[index].label : "")
      .filter(Boolean);
    if (failed.length) setError(`Nao foi possivel carregar: ${failed.join(", ")}. Os outros recursos continuam disponiveis.`);
    setLoading(false);
  }

  useEffect(() => {
    void load();
  }, [guild.id]);

  async function run(action: () => Promise<void>, success: string, options: { refreshWorkspace?: boolean } = {}) {
    if (busy) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await action();
      setNotice(success);
      await load();
      if (options.refreshWorkspace !== false) await onRefresh?.();
    } catch (caught) {
      setError(errorText(caught, "Falha na operacao"));
    } finally {
      setBusy(false);
    }
  }

  async function ask(message: string, title: string, placeholder = "") {
    const value = await gingaPrompt(message, "", { title, placeholder, confirmLabel: "Criar" });
    return value?.trim() || "";
  }

  async function upload(kind: "emoji" | "sticker", file: File | null) {
    if (!file || busy) return;
    const name = assetName.trim();
    if (!name) {
      setError("Informe um nome antes de selecionar a imagem.");
      return;
    }
    if (kind === "emoji" && !/^[A-Za-z0-9_]{2,32}$/.test(name)) {
      setError("O nome do emoji deve ter 2 a 32 caracteres e usar apenas letras, numeros e _.");
      return;
    }
    await run(async () => {
      await api(`/api/guilds/${guild.id}/${kind === "emoji" ? "emojis" : "stickers"}?name=${encodeURIComponent(name)}`, {
        method: "POST",
        headers: { "Content-Type": file.type },
        body: file
      });
      setAssetName("");
    }, kind === "emoji" ? "Emoji adicionado." : "Sticker adicionado.", { refreshWorkspace: false });
  }

  async function createSpace() {
    const name = await ask("Escolha um nome para a nova area.", "Nova area", "Ex.: Games");
    if (!name) return;
    await run(() => api(`/api/guilds/${guild.id}/spaces`, {
      method: "POST",
      body: JSON.stringify({ name, description: "", icon: "", color: guild.iconColor, position: spaces.length })
    }).then(() => undefined), "Area criada.");
  }

  async function removeSpace(space: GuildSpace) {
    if (!await gingaConfirm(`Remover a area "${space.name}"? Os canais nao serao apagados.`, { title: "Remover area", tone: "danger", confirmLabel: "Remover" })) return;
    await run(() => api(`/api/spaces/${space.id}`, { method: "DELETE" }).then(() => undefined), "Area removida.");
  }

  async function createQuestion() {
    const title = await ask("Digite a pergunta que os novos membros devem responder.", "Nova pergunta", "Ex.: O que voce procura aqui?");
    if (!title) return;
    await run(() => api(`/api/guilds/${guild.id}/onboarding/questions`, {
      method: "POST",
      body: JSON.stringify({ title, description: "", multiple: false, required: true, enabled: true, position: questions.length })
    }).then(() => undefined), "Pergunta criada.", { refreshWorkspace: false });
  }

  async function createQuestionOption(question: OnboardingQuestion) {
    const label = await ask(`Nova opcao para "${question.title}".`, "Nova opcao", "Ex.: Games");
    if (!label) return;
    await run(() => api(`/api/onboarding/questions/${question.id}/options`, {
      method: "POST",
      body: JSON.stringify({ label, description: "", emoji: "", roleId: null, channelIds: [], position: question.options.length })
    }).then(() => undefined), "Opcao criada.", { refreshWorkspace: false });
  }

  async function removeQuestion(question: OnboardingQuestion) {
    if (!await gingaConfirm(`Excluir a pergunta "${question.title}" e todas as opcoes dela?`, { title: "Excluir pergunta", tone: "danger", confirmLabel: "Excluir" })) return;
    await run(() => api(`/api/onboarding/questions/${question.id}`, { method: "DELETE" }).then(() => undefined), "Pergunta removida.", { refreshWorkspace: false });
  }

  async function removeQuestionOption(questionId: string, optionId: string, label: string) {
    if (!await gingaConfirm(`Excluir a opcao "${label}"?`, { title: "Excluir opcao", tone: "danger", confirmLabel: "Excluir" })) return;
    await run(() => api(`/api/onboarding/questions/${questionId}/options/${optionId}`, { method: "DELETE" }).then(() => undefined), "Opcao removida.", { refreshWorkspace: false });
  }

  async function createTemplate() {
    const name = await ask("Nome do modelo de sala temporaria.", "Novo modelo", "Ex.: Sala temporaria");
    if (!name) return;
    await run(() => api(`/api/guilds/${guild.id}/dynamic-voice/templates`, {
      method: "POST",
      body: JSON.stringify({ name, namePattern: "Sala de {user}", categoryId: null, userLimit: 0, ownerControls: true, autoDelete: true, enabled: true, position: templates.length })
    }).then(() => undefined), "Modelo criado.");
  }

  async function removeTemplate(template: DynamicVoiceTemplate) {
    if (!await gingaConfirm(`Excluir o modelo "${template.name}"?`, { title: "Excluir modelo", tone: "danger", confirmLabel: "Excluir" })) return;
    await run(() => api(`/api/guilds/${guild.id}/dynamic-voice/templates/${template.id}`, { method: "DELETE" }).then(() => undefined), "Modelo removido.");
  }

  async function createBadge() {
    const name = await ask("Nome da nova badge do servidor.", "Nova badge", "Ex.: Fundador");
    if (!name) return;
    await run(() => api(`/api/guilds/${guild.id}/badges`, {
      method: "POST",
      body: JSON.stringify({ name, icon: "✦", color: guild.iconColor, description: "" })
    }).then(() => undefined), "Badge criada.");
  }

  async function removeBadge(badge: GuildBadgeV2) {
    if (!await gingaConfirm(`Excluir a badge "${badge.name}"? Ela sera removida de todos os membros.`, { title: "Excluir badge", tone: "danger", confirmLabel: "Excluir" })) return;
    await run(() => api(`/api/guilds/${guild.id}/badges/${badge.id}`, { method: "DELETE" }).then(() => undefined), "Badge removida.");
  }

  async function toggleBadgeMember(badge: GuildBadgeV2, userId: string) {
    const assigned = badge.userIds.includes(userId);
    await run(() => api(`/api/guilds/${guild.id}/badges/${badge.id}/members/${userId}`, { method: assigned ? "DELETE" : "PUT" }).then(() => undefined), assigned ? "Badge removida do membro." : "Badge atribuida.", { refreshWorkspace: false });
  }

  const categories = structure?.categories ?? guild.categories ?? [];

  return (
    <section className="ultimate-panel settings-page-section" aria-busy={loading || busy}>
      <div className="ultimate-hero">
        <div>
          <span className="eyebrow">GINGA 0.4.8</span>
          <h1>Personalizacao do servidor</h1>
          <p>Organize areas, assets, onboarding, salas dinamicas, badges e protecao sem sair deste painel.</p>
        </div>
        <span className="ultimate-hero-icon"><Sparkles size={28} /></span>
      </div>

      <nav className="ultimate-tabs" aria-label="Personalizacao do servidor">
        {tabs.map((item) => (
          <button type="button" key={item.id} className={tab === item.id ? "active" : ""} onClick={() => setTab(item.id)}>
            {item.icon}<span>{item.label}</span>
          </button>
        ))}
      </nav>

      {loading && <div className="ultimate-loading">Carregando configuracoes...</div>}
      {error && <div className="inline-error">{error}</div>}
      {notice && <div className="inline-success">{notice}</div>}

      {tab === "spaces" && (
        <section className="ultimate-section">
          <div className="section-heading">
            <div><h3>Areas do servidor</h3><p>Agrupe categorias em contextos como Comunidade, Games, Staff ou Projetos.</p></div>
            <button type="button" className="ultimate-primary" disabled={busy} onClick={() => void createSpace()}><CirclePlus size={15}/>Nova area</button>
          </div>
          {spaces.length === 0 ? <div className="ultimate-empty"><Boxes size={22}/><strong>Nenhuma area criada</strong><span>Crie a primeira area para organizar suas categorias.</span></div> : (
            <div className="ultimate-grid">
              {spaces.map((space) => (
                <article className="ultimate-card" key={space.id} style={{ borderTopColor: space.color }}>
                  <header><strong>{space.icon || "◈"} {space.name}</strong><button type="button" className="icon-btn danger" title="Remover area" onClick={() => void removeSpace(space)}><Trash2 size={14}/></button></header>
                  <p className="ultimate-card-help">Categorias visiveis nesta area</p>
                  <div className="check-list">
                    {categories.length === 0 && <span>Nenhuma categoria disponivel.</span>}
                    {categories.map((category) => (
                      <label key={category.id}>
                        <input type="checkbox" checked={space.categoryIds.includes(category.id)} onChange={() => void run(async () => {
                          const categoryIds = space.categoryIds.includes(category.id) ? space.categoryIds.filter((id) => id !== category.id) : [...space.categoryIds, category.id];
                          await api(`/api/spaces/${space.id}/content`, { method: "PUT", body: JSON.stringify({ categoryIds, channelIds: space.channelIds }) });
                        }, "Area atualizada.")}/>
                        <span>{category.name}</span>
                      </label>
                    ))}
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      )}

      {tab === "assets" && (
        <section className="ultimate-section">
          <div className="section-heading"><div><h3>Emojis e stickers</h3><p>Use um nome curto e envie PNG, WebP ou GIF.</p></div></div>
          <label className="asset-name-field">Nome do asset<input value={assetName} maxLength={40} onChange={(event) => setAssetName(event.target.value)} placeholder="Ex.: ginga_party"/></label>
          <div className="asset-columns">
            <article className="asset-column">
              <div className="asset-column-heading"><div><strong>Emojis</strong><span>{emojis.length} cadastrado{emojis.length === 1 ? "" : "s"}</span></div><label className={`file-chip ${busy ? "disabled" : ""}`}><ImagePlus size={15}/>Enviar<input disabled={busy} hidden type="file" accept="image/png,image/webp,image/gif" onChange={(event) => { const file = event.target.files?.[0] ?? null; event.currentTarget.value = ""; void upload("emoji", file); }}/></label></div>
              <div className="asset-gallery">{emojis.map((emoji) => <div className="asset-tile" key={emoji.id}><img src={emoji.url} alt=""/><span>:{emoji.name}:</span><button type="button" className="asset-remove" title="Excluir emoji" onClick={() => void run(() => api(`/api/guilds/${guild.id}/emojis/${emoji.id}`, { method: "DELETE" }).then(() => undefined), "Emoji removido.", { refreshWorkspace: false })}><Trash2 size={12}/></button></div>)}{emojis.length === 0 && <div className="asset-empty">Nenhum emoji personalizado.</div>}</div>
            </article>
            <article className="asset-column">
              <div className="asset-column-heading"><div><strong>Stickers</strong><span>{stickers.length} cadastrado{stickers.length === 1 ? "" : "s"}</span></div><label className={`file-chip ${busy ? "disabled" : ""}`}><ImagePlus size={15}/>Enviar<input disabled={busy} hidden type="file" accept="image/png,image/webp,image/gif" onChange={(event) => { const file = event.target.files?.[0] ?? null; event.currentTarget.value = ""; void upload("sticker", file); }}/></label></div>
              <div className="asset-gallery">{stickers.map((sticker) => <div className="asset-tile sticker" key={sticker.id}><img src={sticker.url} alt=""/><span>{sticker.name}</span><button type="button" className="asset-remove" title="Excluir sticker" onClick={() => void run(() => api(`/api/guilds/${guild.id}/stickers/${sticker.id}`, { method: "DELETE" }).then(() => undefined), "Sticker removido.", { refreshWorkspace: false })}><Trash2 size={12}/></button></div>)}{stickers.length === 0 && <div className="asset-empty">Nenhum sticker personalizado.</div>}</div>
            </article>
          </div>
        </section>
      )}

      {tab === "onboarding" && (
        <section className="ultimate-section">
          <div className="section-heading"><div><h3>Onboarding</h3><p>Perguntas podem atribuir cargos e preparar a experiencia de entrada.</p></div><button type="button" className="ultimate-primary" disabled={busy} onClick={() => void createQuestion()}><CirclePlus size={15}/>Pergunta</button></div>
          {questions.length === 0 ? <div className="ultimate-empty"><WandSparkles size={22}/><strong>Nenhuma pergunta</strong><span>Crie uma pergunta para iniciar o onboarding.</span></div> : <div className="ultimate-stack">{questions.map((question) => <article className="ultimate-card" key={question.id}><header><div><strong>{question.title}</strong><small>{question.required ? "Obrigatoria" : "Opcional"}{question.multiple ? " · multipla escolha" : ""}</small></div><div className="card-actions"><button type="button" onClick={() => void createQuestionOption(question)}><CirclePlus size={14}/>Opcao</button><button type="button" className="icon-btn danger" title="Excluir pergunta" onClick={() => void removeQuestion(question)}><Trash2 size={14}/></button></div></header><div className="onboarding-options">{question.options.map((option) => <div className="onboarding-option" key={option.id}><span>{option.emoji || "•"} {option.label}</span><button type="button" title="Excluir opcao" onClick={() => void removeQuestionOption(question.id, option.id, option.label)}><Trash2 size={12}/></button></div>)}{question.options.length === 0 && <span className="muted-line">Nenhuma opcao nesta pergunta.</span>}</div></article>)}</div>}
        </section>
      )}

      {tab === "voice" && (
        <section className="ultimate-section">
          <div className="section-heading"><div><h3>Salas dinamicas</h3><p>Modelos criam salas temporarias e podem remove-las quando esvaziam.</p></div><button type="button" className="ultimate-primary" disabled={busy} onClick={() => void createTemplate()}><CirclePlus size={15}/>Modelo</button></div>
          {templates.length === 0 ? <div className="ultimate-empty"><DoorOpen size={22}/><strong>Nenhum modelo</strong><span>Crie um modelo para disponibilizar salas temporarias.</span></div> : <div className="ultimate-grid">{templates.map((template) => <article className="ultimate-card" key={template.id}><header><div><strong>{template.name}</strong><small>{template.autoDelete ? "Remove ao esvaziar" : "Permanente"}</small></div><button type="button" className="icon-btn danger" title="Excluir modelo" onClick={() => void removeTemplate(template)}><Trash2 size={14}/></button></header><code className="template-pattern">{template.namePattern}</code><button type="button" className="ultimate-card-action" onClick={() => void run(() => api(`/api/guilds/${guild.id}/dynamic-voice/${template.id}/create`, { method: "POST" }).then(() => undefined), "Sala criada.")}><DoorOpen size={14}/>Criar sala agora</button></article>)}</div>}
        </section>
      )}

      {tab === "security" && (
        <section className="ultimate-section">
          <div className="section-heading"><div><h3>Protecao do servidor</h3><p>Recursos sao opt-in: nada e ativado sem voce salvar.</p></div><button type="button" className="ultimate-primary" disabled={busy} onClick={() => void run(() => api(`/api/guilds/${guild.id}/security-policy`, { method: "PUT", body: JSON.stringify(policy) }).then(() => undefined), "Politica salva.", { refreshWorkspace: false })}><Save size={15}/>Salvar</button></div>
          <div className="security-v9-grid">
            {([[
              "antiRaidEnabled", "Anti-raid", "Detecta entradas em massa em uma janela curta."
            ], [
              "quarantineEnabled", "Quarentena", "Restringe temporariamente contas novas conforme a politica."
            ], [
              "blockExternalLinks", "Bloquear links externos", "Impede links externos quando a protecao estiver ativa."
            ], [
              "blockInvites", "Bloquear convites", "Bloqueia convites de outros servidores."
            ], [
              "requireModerationReason", "Motivo obrigatorio", "Exige motivo em acoes de moderacao compativeis."
            ]] as const).map(([key, label, description]) => <label className="toggle-card" key={key}><span><strong>{label}</strong><small>{description}</small></span><input type="checkbox" checked={Boolean(policy[key])} onChange={(event) => setPolicy({ ...policy, [key]: event.target.checked })}/></label>)}
            <label className="numeric-card"><span>Janela anti-raid (s)<small>10 a 600 segundos</small></span><input type="number" min={10} max={600} value={policy.joinWindowSeconds} onChange={(event) => setPolicy({ ...policy, joinWindowSeconds: Math.max(10, Number(event.target.value) || 10) })}/></label>
            <label className="numeric-card"><span>Limite de entradas<small>2 a 100 usuarios</small></span><input type="number" min={2} max={100} value={policy.joinLimit} onChange={(event) => setPolicy({ ...policy, joinLimit: Math.max(2, Number(event.target.value) || 2) })}/></label>
            <label className="numeric-card"><span>Quarentena (min)<small>Tempo de restricao</small></span><input type="number" min={1} max={1440} value={policy.quarantineMinutes} onChange={(event) => setPolicy({ ...policy, quarantineMinutes: Math.max(1, Number(event.target.value) || 1) })}/></label>
            <label className="numeric-card"><span>Conta nova (h)<small>Idade considerada nova</small></span><input type="number" min={0} max={8760} value={policy.newAccountHours} onChange={(event) => setPolicy({ ...policy, newAccountHours: Math.max(0, Number(event.target.value) || 0) })}/></label>
            <label className="numeric-card"><span>Maximo de mencoes<small>Por mensagem</small></span><input type="number" min={1} max={100} value={policy.maxMentions} onChange={(event) => setPolicy({ ...policy, maxMentions: Math.max(1, Number(event.target.value) || 1) })}/></label>
            <label className="numeric-card"><span>Mensagens duplicadas<small>Limite antes da acao</small></span><input type="number" min={2} max={20} value={policy.duplicateLimit} onChange={(event) => setPolicy({ ...policy, duplicateLimit: Math.max(2, Number(event.target.value) || 2) })}/></label>
            <label className="numeric-card"><span>Auto-timeout (min)<small>0 desativa o timeout automatico</small></span><input type="number" min={0} max={10080} value={policy.autoTimeoutMinutes} onChange={(event) => setPolicy({ ...policy, autoTimeoutMinutes: Math.max(0, Number(event.target.value) || 0) })}/></label>
          </div>
        </section>
      )}

      {tab === "badges" && (
        <section className="ultimate-section">
          <div className="section-heading"><div><h3>Badges do servidor</h3><p>Selos visuais independentes dos cargos tradicionais.</p></div><button type="button" className="ultimate-primary" disabled={busy} onClick={() => void createBadge()}><BadgePlus size={15}/>Criar</button></div>
          {badges.length === 0 ? <div className="ultimate-empty"><BadgePlus size={22}/><strong>Nenhuma badge</strong><span>Crie badges para destacar membros da comunidade.</span></div> : <div className="ultimate-grid">{badges.map((badge) => <article className="ultimate-card badge-card" key={badge.id} style={{ borderTopColor: badge.color }}><header><strong><span className="badge-icon" style={{ color: badge.color }}>{badge.icon || "✦"}</span> {badge.name}</strong><button type="button" className="icon-btn danger" title="Excluir badge" onClick={() => void removeBadge(badge)}><Trash2 size={14}/></button></header><p className="ultimate-card-help">Clique em um membro para atribuir ou remover.</p><div className="member-badge-list">{members.slice(0, 80).map((member) => { const assigned = badge.userIds.includes(member.user.id); return <button type="button" key={member.user.id} className={assigned ? "active" : ""} onClick={() => void toggleBadgeMember(badge, member.user.id)}><span>{member.nickname || member.user.displayName}</span>{assigned && <small>✓</small>}</button>; })}</div></article>)}</div>}
        </section>
      )}
    </section>
  );
}
