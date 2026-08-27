import { useEffect, useMemo, useState, type FormEvent } from "react";
import { ChevronRight, Copy, GripVertical, Plus, Save, Search, ShieldCheck, Trash2, Users } from "lucide-react";
import { api } from "../lib/api";
import { copyTextToClipboard } from "../lib/clipboard";
import { builtinGuildRoleId, DEVELOPER_MODE_EVENT, loadDeveloperPreferences } from "../lib/developerMode";
import type { CustomRole, GuildMember, GuildStructure, ManagedCategory, ManagedChannel, CustomRolePermissionOverride } from "../types";

import { gingaConfirm } from "../lib/dialogs";
type PermissionKey =
  | "manageServer" | "manageChannels" | "manageRoles" | "manageMessages" | "manageMembers" | "kickMembers" | "banMembers"
  | "viewAuditLog" | "createInvites" | "manageInvites" | "manageWebhooks" | "manageBots" | "manageEvents" | "manageForums"
  | "moveMembers" | "muteMembers" | "deafenMembers" | "manageNicknames" | "manageAutoMod" | "pinMessages" | "scheduleMessages"
  | "mentionEveryone" | "shareScreen" | "useVideo";

type OverrideKey = "canView" | "canSendMessages" | "canConnect";
type OverrideValue = boolean | null;

interface CustomRolesPanelProps {
  guildId: string;
  structure: GuildStructure;
  members: GuildMember[];
  busy: boolean;
  onBusy: (value: boolean) => void;
  onStructureRefresh: () => Promise<void>;
  onMembersRefresh: () => Promise<void>;
  onGuildsRefresh: () => Promise<void>;
  onNotice: (message: string) => void;
  onError: (message: string) => void;
}

const permissionGroups: Array<{ title: string; description: string; items: Array<{ key: PermissionKey; label: string; hint: string }> }> = [
  {
    title: "Administracao",
    description: "Controle estrutural e administrativo do servidor.",
    items: [
      { key: "manageServer", label: "Gerenciar servidor", hint: "Nome, descricao e configuracoes gerais." },
      { key: "manageChannels", label: "Gerenciar canais", hint: "Criar, editar, mover e excluir canais e categorias." },
      { key: "manageRoles", label: "Gerenciar cargos", hint: "Criar cargos, atribuir pessoas e alterar permissoes." },
      { key: "viewAuditLog", label: "Ver auditoria", hint: "Consultar a trilha administrativa do servidor." }
    ]
  },
  {
    title: "Moderacao",
    description: "Acoes sobre pessoas, mensagens e protecoes automaticas.",
    items: [
      { key: "manageMembers", label: "Gerenciar membros", hint: "Acoes administrativas gerais sobre membros." },
      { key: "kickMembers", label: "Expulsar membros", hint: "Remove membros permitidos pela hierarquia." },
      { key: "moveMembers", label: "Mover membros", hint: "Move membros entre salas de voz respeitando a hierarquia." },
      { key: "muteMembers", label: "Mutar membros", hint: "Forca o microfone de membros a ficar desativado na voz." },
      { key: "deafenMembers", label: "Ensurdecer membros", hint: "Impede o membro de transmitir e receber audio na voz." },
      { key: "manageNicknames", label: "Gerenciar apelidos", hint: "Altera ou remove apelidos de membros no servidor." },
      { key: "banMembers", label: "Banir membros", hint: "Banimentos temporarios e permanentes." },
      { key: "manageMessages", label: "Moderar mensagens", hint: "Moderar conteudo de terceiros." },
      { key: "manageAutoMod", label: "Gerenciar AutoMod", hint: "Criar e ajustar regras automaticas." }
    ]
  },
  {
    title: "Comunidade e integracoes",
    description: "Ferramentas de organizacao, automacao e comunicacao.",
    items: [
      { key: "createInvites", label: "Criar convites", hint: "Gerar novos links/codigos de entrada." },
      { key: "manageInvites", label: "Gerenciar convites", hint: "Listar e revogar convites existentes." },
      { key: "manageWebhooks", label: "Gerenciar webhooks", hint: "Criar e administrar webhooks do servidor." },
      { key: "manageBots", label: "Gerenciar bots", hint: "Instalar e remover aplicacoes autorizadas." },
      { key: "manageEvents", label: "Gerenciar eventos", hint: "Criar, editar e cancelar eventos." },
      { key: "manageForums", label: "Gerenciar foruns", hint: "Moderar topicos, tags e organizacao." },
      { key: "pinMessages", label: "Fixar mensagens", hint: "Fixar e desafixar conteudo importante." },
      { key: "scheduleMessages", label: "Agendar mensagens", hint: "Programar mensagens para envio futuro." },
      { key: "mentionEveryone", label: "Mencionar todos", hint: "Permite usar @todos para avisar todos que podem ver o canal." }
    ]
  },
  {
    title: "Voz e midia",
    description: "Recursos de chamada e compartilhamento.",
    items: [
      { key: "shareScreen", label: "Compartilhar tela", hint: "Transmitir tela ou janela nas chamadas." },
      { key: "useVideo", label: "Usar camera", hint: "Publicar video nas chamadas." }
    ]
  }
];

const roleColorOptions = [
  "#99aab5", "#1abc9c", "#2ecc71", "#3498db", "#9b59b6", "#e91e63",
  "#f1c40f", "#e67e22", "#e74c3c", "#95a5a6", "#607d8b", "#5865f2",
  "#11806a", "#1f8b4c", "#206694", "#71368a", "#ad1457", "#c27c0e"
];

const rolePresets: Array<{ id: string; label: string; permissions: PermissionKey[] }> = [
  { id: "observer", label: "Observador", permissions: [] },
  { id: "member", label: "Colaborador", permissions: ["createInvites", "shareScreen", "useVideo"] },
  { id: "moderation", label: "Moderacao", permissions: ["manageMessages", "manageMembers", "kickMembers", "moveMembers", "muteMembers", "deafenMembers", "manageNicknames", "banMembers", "viewAuditLog", "manageForums", "pinMessages"] },
  { id: "management", label: "Gestao", permissions: ["manageChannels", "manageRoles", "manageMessages", "manageMembers", "kickMembers", "moveMembers", "muteMembers", "deafenMembers", "manageNicknames", "banMembers", "viewAuditLog", "createInvites", "manageInvites", "manageEvents", "manageForums", "manageAutoMod", "pinMessages", "scheduleMessages", "shareScreen", "useVideo"] },
  { id: "integrations", label: "Integracoes", permissions: ["manageWebhooks", "manageBots", "viewAuditLog"] }
];

const overrideOptions: Array<{ value: "inherit" | "allow" | "deny"; label: string }> = [
  { value: "inherit", label: "Herdar" },
  { value: "allow", label: "Permitir" },
  { value: "deny", label: "Negar" }
];

function overrideToSelect(value: OverrideValue) {
  return value === null ? "inherit" : value ? "allow" : "deny";
}

function selectToOverride(value: string): OverrideValue {
  return value === "allow" ? true : value === "deny" ? false : null;
}

function findOverride(items: CustomRolePermissionOverride[] | undefined, roleId: string): CustomRolePermissionOverride {
  return items?.find((item) => item.roleId === roleId) ?? { roleId, canView: null, canSendMessages: null, canConnect: null };
}

export function CustomRolesPanel({ guildId, structure, members, busy, onBusy, onStructureRefresh, onMembersRefresh, onGuildsRefresh, onNotice, onError }: CustomRolesPanelProps) {
  const orderedRoles = useMemo(() => [...structure.customRoles].sort((a, b) => b.position - a.position), [structure.customRoles]);
  const [selectedRoleId, setSelectedRoleId] = useState("");
  const [draggedRoleId, setDraggedRoleId] = useState("");
  const selectedRole = orderedRoles.find((role) => role.id === selectedRoleId) ?? orderedRoles[0] ?? null;
  const [draftName, setDraftName] = useState("");
  const [draftColor, setDraftColor] = useState("#8b93a7");
  const [draftIcon, setDraftIcon] = useState("");
  const [draftDescription, setDraftDescription] = useState("");
  const [draftHoist, setDraftHoist] = useState(false);
  const [draftMentionable, setDraftMentionable] = useState(false);
  const [editorSection, setEditorSection] = useState<"identity" | "permissions" | "members" | "access">("identity");
  const [memberQuery, setMemberQuery] = useState("");
  const [roleQuery, setRoleQuery] = useState("");
  const [permissionQuery, setPermissionQuery] = useState("");
  const [creatingRole, setCreatingRole] = useState(false);
  const [developerMode, setDeveloperMode] = useState(() => loadDeveloperPreferences().enabled);

  useEffect(() => {
    const syncDeveloperMode = () => setDeveloperMode(loadDeveloperPreferences().enabled);
    window.addEventListener(DEVELOPER_MODE_EVENT, syncDeveloperMode);
    window.addEventListener("storage", syncDeveloperMode);
    return () => {
      window.removeEventListener(DEVELOPER_MODE_EVENT, syncDeveloperMode);
      window.removeEventListener("storage", syncDeveloperMode);
    };
  }, []);

  useEffect(() => {
    if (!selectedRole && orderedRoles[0]) setSelectedRoleId(orderedRoles[0].id);
    if (selectedRoleId && !orderedRoles.some((role) => role.id === selectedRoleId)) setSelectedRoleId(orderedRoles[0]?.id ?? "");
  }, [orderedRoles, selectedRole, selectedRoleId]);

  useEffect(() => {
    if (!selectedRole) return;
    setDraftName(selectedRole.name);
    setDraftColor(selectedRole.color);
    setDraftIcon(selectedRole.icon ?? "");
    setDraftDescription(selectedRole.description ?? "");
    setDraftHoist(selectedRole.hoist);
    setDraftMentionable(selectedRole.mentionable);
  }, [selectedRole?.id, selectedRole?.name, selectedRole?.color, selectedRole?.icon, selectedRole?.description, selectedRole?.hoist, selectedRole?.mentionable]);

  function fail(caught: unknown, fallback: string) {
    onError(caught instanceof Error ? caught.message : fallback);
  }

  async function createRole(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    onBusy(true); onError("");
    try {
      const result = await api<{ role: CustomRole }>(`/api/guilds/${guildId}/custom-roles`, {
        method: "POST",
        body: JSON.stringify({
          name: String(form.get("name") ?? "").trim(),
          color: String(form.get("color") ?? "#8b93a7"),
          icon: String(form.get("icon") ?? "").trim(),
          description: "",
          hoist: Boolean(form.get("hoist")),
          mentionable: Boolean(form.get("mentionable")),
          permissions: []
        })
      });
      await onStructureRefresh();
      setSelectedRoleId(result.role.id);
      setEditorSection("identity");
      setCreatingRole(false);
      event.currentTarget.reset();
      onNotice("Cargo criado");
    } catch (caught) { fail(caught, "Nao foi possivel criar o cargo"); }
    finally { onBusy(false); }
  }

  async function saveRoleIdentity() {
    if (!selectedRole || selectedRole.managed) return;
    onBusy(true); onError("");
    try {
      await api(`/api/guilds/${guildId}/custom-roles/${selectedRole.id}`, {
        method: "PATCH",
        body: JSON.stringify({ name: draftName.trim(), color: draftColor, icon: draftIcon.trim(), description: draftDescription.trim(), hoist: draftHoist, mentionable: draftMentionable })
      });
      await Promise.all([onStructureRefresh(), onMembersRefresh(), onGuildsRefresh()]);
      onNotice("Cargo atualizado");
    } catch (caught) { fail(caught, "Nao foi possivel salvar o cargo"); }
    finally { onBusy(false); }
  }

  async function deleteRole(role: CustomRole) {
    if (role.managed || !(await gingaConfirm(`As atribuicoes do cargo ${role.name} serao removidas.`, { title: `Excluir ${role.name}?`, confirmLabel: "Excluir cargo", tone: "danger" }))) return;
    onBusy(true); onError("");
    try {
      await api(`/api/guilds/${guildId}/custom-roles/${role.id}`, { method: "DELETE" });
      await Promise.all([onStructureRefresh(), onMembersRefresh(), onGuildsRefresh()]);
      onNotice("Cargo removido");
    } catch (caught) { fail(caught, "Nao foi possivel excluir o cargo"); }
    finally { onBusy(false); }
  }

  async function applyPermissionPreset(role: CustomRole, preset: (typeof rolePresets)[number]) {
    if (role.managed) return;
    onBusy(true); onError("");
    try {
      await api(`/api/guilds/${guildId}/custom-roles/${role.id}`, { method: "PATCH", body: JSON.stringify({ permissions: preset.permissions }) });
      await Promise.all([onStructureRefresh(), onGuildsRefresh()]);
      onNotice(`Preset ${preset.label} aplicado`);
    } catch (caught) { fail(caught, "Nao foi possivel aplicar o preset"); await onStructureRefresh().catch(() => undefined); }
    finally { onBusy(false); }
  }

  async function togglePermission(role: CustomRole, key: PermissionKey) {
    if (role.managed) return;
    const permissions = role.permissions.includes(key) ? role.permissions.filter((item) => item !== key) : [...role.permissions, key];
    try {
      await api(`/api/guilds/${guildId}/custom-roles/${role.id}`, { method: "PATCH", body: JSON.stringify({ permissions }) });
      await Promise.all([onStructureRefresh(), onGuildsRefresh()]);
    } catch (caught) { fail(caught, "Nao foi possivel alterar a permissao"); await onStructureRefresh().catch(() => undefined); }
  }

  async function assignRole(member: GuildMember, roleId: string, enabled: boolean) {
    const current = (member.customRoles ?? []).map((role) => role.id);
    const roleIds = enabled ? [...new Set([...current, roleId])] : current.filter((id) => id !== roleId);
    onBusy(true); onError("");
    try {
      await api(`/api/guilds/${guildId}/members/${member.user.id}/custom-roles`, { method: "PUT", body: JSON.stringify({ roleIds }) });
      await Promise.all([onMembersRefresh(), onGuildsRefresh()]);
      onNotice(`Cargos de ${member.user.displayName} atualizados`);
    } catch (caught) { fail(caught, "Nao foi possivel atribuir o cargo"); }
    finally { onBusy(false); }
  }

  async function reorderRoleBefore(sourceId: string, targetId: string) {
    if (!sourceId || sourceId === targetId) return;
    const list = [...orderedRoles];
    const from = list.findIndex((role) => role.id === sourceId);
    const to = list.findIndex((role) => role.id === targetId);
    if (from < 0 || to < 0) return;
    const [moved] = list.splice(from, 1);
    list.splice(to, 0, moved);
    onBusy(true); onError("");
    try {
      await api(`/api/guilds/${guildId}/custom-roles/reorder`, {
        method: "PUT",
        body: JSON.stringify({ items: list.map((role, index) => ({ id: role.id, position: list.length - index })) })
      });
      await Promise.all([onStructureRefresh(), onMembersRefresh(), onGuildsRefresh()]);
      onNotice("Hierarquia de cargos atualizada");
    } catch (caught) { fail(caught, "Nao foi possivel reordenar os cargos"); }
    finally { setDraggedRoleId(""); onBusy(false); }
  }

  async function saveOverride(target: ManagedCategory | ManagedChannel, kind: "category" | "channel", key: OverrideKey, value: OverrideValue) {
    if (!selectedRole) return;
    const existing = findOverride(target.customRolePermissions, selectedRole.id);
    const next = { canView: existing.canView, canSendMessages: existing.canSendMessages, canConnect: existing.canConnect, [key]: value };
    try {
      const path = kind === "category"
        ? `/api/categories/${target.id}/custom-role-permissions/${selectedRole.id}`
        : `/api/channels/${target.id}/custom-role-permissions/${selectedRole.id}`;
      await api(path, { method: "PUT", body: JSON.stringify(next) });
      await Promise.all([onStructureRefresh(), onGuildsRefresh()]);
    } catch (caught) { fail(caught, "Nao foi possivel salvar o override"); await onStructureRefresh().catch(() => undefined); }
  }

  async function setChannelSync(channel: ManagedChannel, sync: boolean) {
    try {
      await api(`/api/channels/${channel.id}`, { method: "PATCH", body: JSON.stringify({ syncPermissionsWithCategory: sync }) });
      await Promise.all([onStructureRefresh(), onGuildsRefresh()]);
      onNotice(sync ? "Canal sincronizado com a categoria" : "Canal agora possui permissoes proprias");
    } catch (caught) { fail(caught, "Nao foi possivel alterar a heranca do canal"); }
  }

  const assignedCount = selectedRole ? members.filter((member) => (member.customRoles ?? []).some((role) => role.id === selectedRole.id)).length : 0;
  const filteredMembers = useMemo(() => {
    const query = memberQuery.trim().toLocaleLowerCase();
    if (!query) return members;
    return members.filter((member) => `${member.user.displayName} ${member.user.username}`.toLocaleLowerCase().includes(query));
  }, [memberQuery, members]);
  const filteredRoles = useMemo(() => {
    const query = roleQuery.trim().toLocaleLowerCase();
    if (!query) return orderedRoles;
    return orderedRoles.filter((role) => `${role.name} ${role.description ?? ""}`.toLocaleLowerCase().includes(query));
  }, [orderedRoles, roleQuery]);
  const visiblePermissionGroups = useMemo(() => {
    const query = permissionQuery.trim().toLocaleLowerCase();
    if (!query) return permissionGroups;
    return permissionGroups.map((group) => ({
      ...group,
      items: group.items.filter((item) => `${item.label} ${item.hint} ${group.title}`.toLocaleLowerCase().includes(query))
    })).filter((group) => group.items.length > 0);
  }, [permissionQuery]);

  return <div className="roles-console role-workbench">
    <aside className="roles-sidebar">
      <div className="roles-sidebar-head discord-role-head">
        <div><strong>Cargos</strong><span>{orderedRoles.length} cargo{orderedRoles.length === 1 ? "" : "s"} personalizado{orderedRoles.length === 1 ? "" : "s"}</span></div>
        <button type="button" className="role-create-trigger" onClick={() => setCreatingRole((value) => !value)}><Plus size={16}/><span>Criar cargo</span></button>
      </div>
      <label className="role-search-box"><Search size={15}/><input value={roleQuery} onChange={(event) => setRoleQuery(event.target.value)} placeholder="Buscar cargos" /></label>
      {creatingRole && <form className="role-quick-create role-quick-create-pro discord-role-create" onSubmit={createRole}>
        <div className="role-create-title"><strong>Novo cargo</strong><span>Defina o basico. Permissoes e membros entram na proxima tela.</span></div>
        <div className="role-create-fields"><input name="name" required maxLength={48} placeholder="Nome do cargo" autoFocus/><input name="icon" maxLength={16} placeholder="🛡️" aria-label="Emoji ou simbolo do cargo" /><input name="color" type="color" defaultValue="#8b93a7" aria-label="Cor inicial" /></div>
        <div className="role-create-flags"><label><input name="hoist" type="checkbox" /> Exibir membros separadamente</label><label><input name="mentionable" type="checkbox" /> Permitir @cargo</label></div>
        <div className="role-create-actions"><button type="button" className="secondary-button" onClick={() => setCreatingRole(false)}>Cancelar</button><button className="primary-button" disabled={busy}>Criar cargo</button></div>
      </form>}
      <div className="role-order-list">
        <div className="role-default-item"><span className="role-default-shield"><Users size={15}/></span><div><strong>Permissoes padrao</strong><small>@everyone · vale para todos os membros</small></div>{developerMode && <button type="button" className="role-copy-id-button" title="Copiar ID fixo do cargo @everyone" onClick={() => void copyTextToClipboard(builtinGuildRoleId(guildId, "MEMBER")).then(() => onNotice("ID do cargo @everyone copiado")).catch(() => onError("Nao foi possivel copiar o ID do cargo"))}><Copy size={14}/></button>}</div>
        <div className="role-list-caption"><span>CARGOS — {filteredRoles.length}</span><small>Arraste para reordenar</small></div>
        {filteredRoles.length === 0 && <div className="settings-empty-state">Nenhum cargo corresponde a busca.</div>}
        {filteredRoles.map((role) => { const count = members.filter((member) => (member.customRoles ?? []).some((item) => item.id === role.id)).length; return <button type="button" key={role.id} className={`role-order-item ${selectedRole?.id === role.id ? "active" : ""}`} draggable={!role.managed} onDragStart={(event) => { setDraggedRoleId(role.id); event.dataTransfer.effectAllowed = "move"; }} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); void reorderRoleBefore(draggedRoleId, role.id); }} onClick={() => setSelectedRoleId(role.id)}>
          <GripVertical size={16} className="role-drag-handle"/><i style={{ background: role.color }}/><span><strong>{role.icon ? `${role.icon} ` : ""}{role.name}</strong><small>{role.managed ? "Gerenciado por integracao" : `${count} membro${count === 1 ? "" : "s"}`}</small></span><b>{count}</b><ChevronRight size={15} className="role-row-chevron"/>
        </button>; })}
      </div>
    </aside>

    <section className="role-editor-pane">
      {!selectedRole ? <div className="settings-empty-state">Selecione ou crie um cargo.</div> : <>
        <div className="role-editor-hero" style={{ borderColor: `${selectedRole.color}66` }}>
          <div className="role-editor-title"><span className="custom-role-dot large" style={{ background: selectedRole.color }}/><div><span className="eyebrow">CARGO SELECIONADO</span><h2>{selectedRole.icon ? `${selectedRole.icon} ` : ""}{selectedRole.name}</h2><p>{assignedCount} membro{assignedCount === 1 ? "" : "s"} · posicao {selectedRole.position}{selectedRole.managed ? " · gerenciado por integracao" : ""}</p>{developerMode && <code className="role-developer-id">ID {selectedRole.id}</code>}</div></div>
          <div className="role-editor-hero-actions">{developerMode && <button type="button" className="secondary-button compact-button" onClick={() => void copyTextToClipboard(selectedRole.id).then(() => onNotice("ID do cargo copiado")).catch(() => onError("Nao foi possivel copiar o ID do cargo"))}><Copy size={14}/> Copiar ID</button>}{!selectedRole.managed && <button className="danger-icon-button" aria-label="Excluir cargo" onClick={() => void deleteRole(selectedRole)}><Trash2 size={17}/></button>}</div>
        </div>

        <nav className="role-editor-nav discord-role-tabs" aria-label="Secoes do cargo">
          <button type="button" className={editorSection === "identity" ? "active" : ""} onClick={() => setEditorSection("identity")}><strong>Exibicao</strong></button>
          <button type="button" className={editorSection === "permissions" ? "active" : ""} onClick={() => setEditorSection("permissions")}><strong>Permissoes</strong></button>
          <button type="button" className={editorSection === "members" ? "active" : ""} onClick={() => setEditorSection("members")}><strong>Gerenciar membros <em>{assignedCount}</em></strong></button>
          <button type="button" className={editorSection === "access" ? "active" : ""} onClick={() => setEditorSection("access")}><strong>Acesso a canais</strong></button>
        </nav>

        {editorSection === "identity" && <section className="role-editor-section">
          <div className="role-editor-tabs-copy"><strong>Identidade e exibicao</strong><span>Defina como o cargo aparece no Ginga. Alteracoes so entram depois de salvar.</span></div>
          <div className="role-identity-grid role-identity-grid-pro">
            <label>Nome<input value={draftName} maxLength={48} disabled={selectedRole.managed} onChange={(event) => setDraftName(event.target.value)} /></label>
            <label>Cor personalizada<input type="color" value={draftColor} disabled={selectedRole.managed} onChange={(event) => setDraftColor(event.target.value)} /></label>
            <label>Icone / emoji<input value={draftIcon} maxLength={16} placeholder="🛡️" disabled={selectedRole.managed} onChange={(event) => setDraftIcon(event.target.value)} /></label>
            <label className="role-description-field">Descricao<textarea value={draftDescription} maxLength={160} rows={3} placeholder="Explique a funcao deste cargo..." disabled={selectedRole.managed} onChange={(event) => setDraftDescription(event.target.value)} /></label>
            <div className="role-color-palette"><span>CORES RAPIDAS</span><div>{roleColorOptions.map((color) => <button type="button" key={color} title={color} disabled={selectedRole.managed} className={draftColor.toLowerCase() === color.toLowerCase() ? "active" : ""} style={{ background: color }} onClick={() => setDraftColor(color)} aria-label={`Usar cor ${color}`}/>)}</div></div>
            <div className="role-live-preview"><span>PREVIA DO CARGO</span><strong style={{ color: draftColor }}>{draftIcon ? `${draftIcon} ` : ""}{draftName || "Novo cargo"}</strong><small>Assim o nome aparecera na lista de membros.</small></div>
            <label className="role-switch-card"><input type="checkbox" checked={draftHoist} disabled={selectedRole.managed} onChange={(event) => setDraftHoist(event.target.checked)} /><span><strong>Exibir membros separadamente</strong><small>Quando ativo, membros online com este cargo aparecem em uma secao propria na lista lateral. Offline continua no fim.</small></span></label>
            <label className="role-switch-card"><input type="checkbox" checked={draftMentionable} disabled={selectedRole.managed} onChange={(event) => setDraftMentionable(event.target.checked)} /><span><strong>Permitir @cargo</strong><small>Usuarios autorizados podem mencionar este grupo.</small></span></label>
          </div>
          {!selectedRole.managed && <div className="role-editor-actionbar"><span>Revise as alteracoes antes de salvar.</span><button className="primary-button" disabled={busy || !draftName.trim()} onClick={() => void saveRoleIdentity()}><Save size={16}/> Salvar alteracoes</button></div>}
        </section>}

        {editorSection === "permissions" && <section className="role-editor-section">
          <div className="role-editor-tabs-copy"><strong>Permissoes do servidor</strong><span>Ative apenas o necessario. Permissoes administrativas aparecem separadas das permissoes de canal.</span></div>
          <label className="role-permission-search"><Search size={16}/><input value={permissionQuery} onChange={(event) => setPermissionQuery(event.target.value)} placeholder="Buscar permissoes" /></label>
          {!selectedRole.managed && <div className="role-presets"><span>PERFIS RAPIDOS</span>{rolePresets.map((preset) => <button type="button" key={preset.id} disabled={busy} onClick={() => void applyPermissionPreset(selectedRole, preset)}>{preset.label}</button>)}</div>}
          <div className="role-permission-groups">
            {visiblePermissionGroups.map((group) => <section key={group.title} className="role-permission-group"><header><ShieldCheck size={17}/><div><strong>{group.title}</strong><span>{group.description}</span></div></header><div>{group.items.map((item) => <label className="settings-toggle-row" key={item.key}><div><strong>{item.label}</strong><span>{item.hint}</span></div><input type="checkbox" disabled={selectedRole.managed} checked={selectedRole.permissions.includes(item.key)} onChange={() => void togglePermission(selectedRole, item.key)} /></label>)}</div></section>)}
          </div>
          {visiblePermissionGroups.length === 0 && <div className="settings-empty-state">Nenhuma permissao corresponde a busca.</div>}
        </section>}

        {editorSection === "members" && <section className="role-editor-section">
          <div className="role-editor-section-head"><div className="role-editor-tabs-copy"><strong>Membros com este cargo</strong><span>Atribua ou remova o cargo sem abrir outra tela.</span></div><input className="role-member-search" value={memberQuery} onChange={(event) => setMemberQuery(event.target.value)} placeholder="Buscar membro..." /></div>
          <div className="role-member-assignment-list">
            {filteredMembers.map((member) => <label key={member.user.id} className="role-member-assignment-row"><span className="role-member-avatar" style={{ background: member.user.avatarColor }}>{member.user.displayName.slice(0, 1).toUpperCase()}</span><span><strong>{member.user.displayName}</strong><small>@{member.user.username} · {member.role}</small></span><input type="checkbox" disabled={busy || selectedRole.managed} checked={(member.customRoles ?? []).some((role) => role.id === selectedRole.id)} onChange={(event) => void assignRole(member, selectedRole.id, event.target.checked)} /></label>)}
            {filteredMembers.length === 0 && <div className="settings-empty-state">Nenhum membro corresponde a busca.</div>}
          </div>
        </section>}

        {editorSection === "access" && <section className="role-editor-section">
          <div className="role-editor-tabs-copy"><strong>Acesso por categoria e canal</strong><span>Herdar e o padrao seguro. Crie excecoes apenas quando um canal precisar se comportar diferente.</span></div>
          <div className="role-access-caption"><strong>Categorias</strong><span>Definem a base de acesso para os canais sincronizados.</span></div>
          <div className="role-access-list">
            {structure.categories.map((category) => { const override = findOverride(category.customRolePermissions, selectedRole.id); return <div className="role-access-row" key={category.id}><div><strong>{category.name}</strong><span>Categoria</span></div>{(["canView", "canSendMessages", "canConnect"] as OverrideKey[]).map((key) => <label key={key}><span>{key === "canView" ? "Ver" : key === "canSendMessages" ? "Enviar" : "Entrar"}</span><select value={overrideToSelect(override[key])} onChange={(event) => void saveOverride(category, "category", key, selectToOverride(event.target.value))}>{overrideOptions.map((option) => <option value={option.value} key={option.value}>{option.label}</option>)}</select></label>)}</div>; })}
          </div>
          <div className="role-access-caption"><strong>Excecoes por canal</strong><span>Canais sincronizados usam a categoria automaticamente.</span></div>
          <div className="role-access-list">
            {structure.channels.map((channel) => { const override = findOverride(channel.customRolePermissions, selectedRole.id); const category = structure.categories.find((item) => item.id === channel.categoryId); const synced = Boolean(channel.categoryId && channel.syncPermissionsWithCategory); return <div className={`role-access-row channel ${synced ? "synced" : ""}`} key={channel.id}><div><strong>{channel.name}</strong><span>{category ? `${category.name} · ` : ""}{synced ? "herdando categoria" : "permissoes proprias"}</span></div>{synced ? <button className="secondary-button compact-button" onClick={() => void setChannelSync(channel, false)}>Criar excecao</button> : <>{(["canView", "canSendMessages", "canConnect"] as OverrideKey[]).map((key) => <label key={key}><span>{key === "canView" ? "Ver" : key === "canSendMessages" ? "Enviar" : "Entrar"}</span><select value={overrideToSelect(override[key])} onChange={(event) => void saveOverride(channel, "channel", key, selectToOverride(event.target.value))}>{overrideOptions.map((option) => <option value={option.value} key={option.value}>{option.label}</option>)}</select></label>)}{channel.categoryId && <button className="secondary-button compact-button" onClick={() => void setChannelSync(channel, true)}>Herdar categoria</button>}</>}</div>; })}
          </div>
        </section>}
      </>}
    </section>
  </div>;
}
