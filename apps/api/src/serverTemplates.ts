import type { ChannelType } from "@prisma/client";
import type { GuildCapability } from "./permissions.js";

export interface ServerTemplateCategory {
  key: string;
  name: string;
  position: number;
}

export interface ServerTemplateChannel {
  name: string;
  type: ChannelType;
  categoryKey?: string;
  topic?: string;
  position: number;
}

export interface ServerTemplateRole {
  name: string;
  color: string;
  icon?: string;
  description?: string;
  position: number;
  permissions: GuildCapability[];
  hoist?: boolean;
  mentionable?: boolean;
}

export interface ServerTemplate {
  id: string;
  name: string;
  description: string;
  icon: "basic" | "company" | "community" | "support" | "developer" | "study" | "gaming";
  accent: string;
  categories: ServerTemplateCategory[];
  channels: ServerTemplateChannel[];
  roles: ServerTemplateRole[];
}

const basic: ServerTemplate = {
  id: "basic",
  name: "Essencial",
  description: "Estrutura enxuta para comecar do zero.",
  icon: "basic",
  accent: "#6f7b88",
  categories: [
    { key: "chat", name: "Conversas", position: 0 },
    { key: "live", name: "Ao vivo", position: 1 }
  ],
  channels: [
    { name: "geral", type: "TEXT", categoryKey: "chat", position: 0 },
    { name: "Bate-papo", type: "VOICE", categoryKey: "live", position: 0 }
  ],
  roles: []
};

export const serverTemplates: ServerTemplate[] = [
  basic,
  {
    id: "company",
    name: "Empresa",
    description: "Comunicacao interna, departamentos, anuncios e reunioes.",
    icon: "company",
    accent: "#5d7f72",
    categories: [
      { key: "company", name: "Empresa", position: 0 },
      { key: "teams", name: "Equipes", position: 1 },
      { key: "meetings", name: "Reunioes", position: 2 }
    ],
    channels: [
      { name: "anuncios", type: "ANNOUNCEMENT", categoryKey: "company", topic: "Comunicados oficiais", position: 0 },
      { name: "geral", type: "TEXT", categoryKey: "company", position: 1 },
      { name: "suporte-interno", type: "FORUM", categoryKey: "teams", topic: "Solicitacoes e acompanhamento interno", position: 0 },
      { name: "projetos", type: "TEXT", categoryKey: "teams", position: 1 },
      { name: "agenda", type: "EVENT", categoryKey: "meetings", position: 0 },
      { name: "Sala de reuniao", type: "VOICE", categoryKey: "meetings", position: 1 }
    ],
    roles: [
      { name: "Gestao", color: "#b38a55", icon: "◆", description: "Coordenacao e administracao da equipe.", position: 30, permissions: ["manageChannels", "manageMessages", "manageMembers", "moveMembers", "muteMembers", "deafenMembers", "manageNicknames", "createInvites", "manageEvents", "manageForums", "pinMessages", "scheduleMessages"], hoist: true },
      { name: "Suporte", color: "#5d7f72", icon: "●", description: "Atendimento e operacao.", position: 20, permissions: ["manageMessages", "createInvites", "manageForums", "pinMessages"], hoist: true },
      { name: "Colaborador", color: "#7b8490", description: "Cargo padrao para equipes internas.", position: 10, permissions: [], mentionable: true }
    ]
  },
  {
    id: "community",
    name: "Comunidade",
    description: "Boas-vindas, conteudo, forum, eventos e salas sociais.",
    icon: "community",
    accent: "#8a6f58",
    categories: [
      { key: "start", name: "Comece aqui", position: 0 },
      { key: "community", name: "Comunidade", position: 1 },
      { key: "live", name: "Ao vivo", position: 2 }
    ],
    channels: [
      { name: "boas-vindas", type: "ANNOUNCEMENT", categoryKey: "start", position: 0 },
      { name: "regras", type: "TEXT", categoryKey: "start", position: 1 },
      { name: "geral", type: "TEXT", categoryKey: "community", position: 0 },
      { name: "forum", type: "FORUM", categoryKey: "community", position: 1 },
      { name: "eventos", type: "EVENT", categoryKey: "community", position: 2 },
      { name: "Resenha", type: "VOICE", categoryKey: "live", position: 0 }
    ],
    roles: [
      { name: "Equipe", color: "#8a6f58", icon: "◆", description: "Equipe responsavel pela comunidade.", position: 30, permissions: ["manageMessages", "manageMembers", "kickMembers", "moveMembers", "muteMembers", "deafenMembers", "manageNicknames", "banMembers", "viewAuditLog", "manageEvents", "manageForums", "pinMessages"], hoist: true },
      { name: "Veterano", color: "#66778a", description: "Membros reconhecidos pela comunidade.", position: 20, permissions: ["createInvites"], hoist: true, mentionable: true },
      { name: "Membro", color: "#727983", position: 10, permissions: [], mentionable: true }
    ]
  },
  {
    id: "support",
    name: "Suporte",
    description: "Central de atendimento, triagem, incidentes e voz.",
    icon: "support",
    accent: "#607c8b",
    categories: [
      { key: "desk", name: "Central", position: 0 },
      { key: "ops", name: "Operacao", position: 1 }
    ],
    channels: [
      { name: "avisos", type: "ANNOUNCEMENT", categoryKey: "desk", position: 0 },
      { name: "chamados", type: "FORUM", categoryKey: "desk", topic: "Abra e acompanhe solicitacoes", position: 1 },
      { name: "triagem", type: "TEXT", categoryKey: "ops", position: 0 },
      { name: "incidentes", type: "TEXT", categoryKey: "ops", position: 1 },
      { name: "Atendimento", type: "VOICE", categoryKey: "ops", position: 2 }
    ],
    roles: [
      { name: "Coordenacao", color: "#9a7653", icon: "◆", position: 30, permissions: ["manageMessages", "manageMembers", "manageChannels", "moveMembers", "muteMembers", "deafenMembers", "manageNicknames", "kickMembers", "banMembers", "viewAuditLog", "manageForums", "pinMessages"], hoist: true },
      { name: "Analista", color: "#607c8b", icon: "●", position: 20, permissions: ["manageMessages", "manageForums", "pinMessages"], hoist: true },
      { name: "Solicitante", color: "#727983", position: 10, permissions: [] }
    ]
  },
  {
    id: "developer",
    name: "Desenvolvimento",
    description: "Projetos, releases, incidentes, webhooks e reunioes tecnicas.",
    icon: "developer",
    accent: "#6a708c",
    categories: [
      { key: "product", name: "Produto", position: 0 },
      { key: "engineering", name: "Engenharia", position: 1 },
      { key: "release", name: "Entrega", position: 2 }
    ],
    channels: [
      { name: "produto", type: "TEXT", categoryKey: "product", position: 0 },
      { name: "roadmap", type: "FORUM", categoryKey: "product", position: 1 },
      { name: "dev", type: "TEXT", categoryKey: "engineering", position: 0 },
      { name: "bugs", type: "FORUM", categoryKey: "engineering", position: 1 },
      { name: "releases", type: "ANNOUNCEMENT", categoryKey: "release", position: 0 },
      { name: "sprints", type: "EVENT", categoryKey: "release", position: 1 },
      { name: "Pairing", type: "VOICE", categoryKey: "engineering", position: 2 }
    ],
    roles: [
      { name: "Tech Lead", color: "#8a6f58", icon: "◆", position: 30, permissions: ["manageChannels", "manageMessages", "manageMembers", "moveMembers", "muteMembers", "deafenMembers", "manageNicknames", "manageWebhooks", "manageBots", "manageEvents", "manageForums", "pinMessages", "scheduleMessages"], hoist: true },
      { name: "Dev", color: "#6a708c", icon: "●", position: 20, permissions: ["manageWebhooks", "manageBots", "manageForums", "scheduleMessages"], hoist: true, mentionable: true },
      { name: "QA", color: "#6f7f72", position: 15, permissions: ["manageForums"], hoist: true }
    ]
  },
  {
    id: "study",
    name: "Estudos",
    description: "Materias, duvidas, agenda e salas de estudo.",
    icon: "study",
    accent: "#7a735b",
    categories: [
      { key: "class", name: "Turma", position: 0 },
      { key: "subjects", name: "Materias", position: 1 },
      { key: "live", name: "Estudo ao vivo", position: 2 }
    ],
    channels: [
      { name: "avisos", type: "ANNOUNCEMENT", categoryKey: "class", position: 0 },
      { name: "geral", type: "TEXT", categoryKey: "class", position: 1 },
      { name: "duvidas", type: "FORUM", categoryKey: "subjects", position: 0 },
      { name: "provas-e-entregas", type: "EVENT", categoryKey: "subjects", position: 1 },
      { name: "Sala de estudo", type: "VOICE", categoryKey: "live", position: 0 }
    ],
    roles: [
      { name: "Professor", color: "#8a6f58", icon: "◆", position: 30, permissions: ["manageMessages", "manageMembers", "moveMembers", "muteMembers", "deafenMembers", "manageNicknames", "manageEvents", "manageForums", "pinMessages", "scheduleMessages"], hoist: true },
      { name: "Monitor", color: "#6f7f72", position: 20, permissions: ["manageMessages", "manageForums", "pinMessages"], hoist: true },
      { name: "Aluno", color: "#727983", position: 10, permissions: [] }
    ]
  },
  {
    id: "gaming",
    name: "Gaming",
    description: "Esquadrao, matchmaking, eventos e salas de voz.",
    icon: "gaming",
    accent: "#7c665f",
    categories: [
      { key: "hub", name: "Hub", position: 0 },
      { key: "game", name: "Jogo", position: 1 },
      { key: "voice", name: "Salas", position: 2 }
    ],
    channels: [
      { name: "anuncios", type: "ANNOUNCEMENT", categoryKey: "hub", position: 0 },
      { name: "geral", type: "TEXT", categoryKey: "hub", position: 1 },
      { name: "procurando-grupo", type: "FORUM", categoryKey: "game", position: 0 },
      { name: "campeonatos", type: "EVENT", categoryKey: "game", position: 1 },
      { name: "Lobby", type: "VOICE", categoryKey: "voice", position: 0 },
      { name: "Squad 1", type: "VOICE", categoryKey: "voice", position: 1 },
      { name: "Squad 2", type: "VOICE", categoryKey: "voice", position: 2 }
    ],
    roles: [
      { name: "Staff", color: "#8a6f58", icon: "◆", position: 30, permissions: ["manageMessages", "manageMembers", "kickMembers", "moveMembers", "muteMembers", "deafenMembers", "manageNicknames", "banMembers", "manageEvents", "manageForums", "pinMessages"], hoist: true },
      { name: "Capitao", color: "#7c665f", position: 20, permissions: ["createInvites"], hoist: true, mentionable: true },
      { name: "Jogador", color: "#727983", position: 10, permissions: [] }
    ]
  }
];

export function getServerTemplate(id?: string | null) {
  return serverTemplates.find((template) => template.id === id) ?? basic;
}

export function publicServerTemplates() {
  return serverTemplates.map(({ categories, channels, roles, ...template }) => ({
    ...template,
    categoryCount: categories.length,
    channelCount: channels.length,
    roleCount: roles.length
  }));
}
