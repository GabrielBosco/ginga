import { ApiError } from "./api";

export interface WebhookFriendlyError {
  message: string;
  field?: "guildId" | "channelId" | "name";
  hint?: string;
}

export function friendlyWebhookError(caught: unknown): WebhookFriendlyError {
  if (!(caught instanceof ApiError)) {
    return { message: caught instanceof Error && caught.message ? caught.message : "Nao foi possivel criar o webhook.", hint: "Tente novamente em alguns instantes." };
  }

  const field = caught.field === "guildId" || caught.field === "channelId" || caught.field === "name" ? caught.field : undefined;
  if (caught.status === 0) return { message: "Nao conseguimos falar com o servidor agora.", hint: "Confira sua conexao e tente novamente." };
  if (caught.status === 403) return { message: "Voce nao tem permissao para criar webhooks neste servidor.", hint: "Peça a um administrador a permissao Gerenciar webhooks." };
  if (caught.status === 404) return { message: "O servidor ou canal selecionado nao esta mais disponivel.", field: field ?? "channelId", hint: "Atualize a tela e escolha outro canal." };
  if (caught.status === 409) return { message: caught.message || "Nao foi possivel criar outro webhook neste servidor.", hint: "Revise os webhooks existentes e tente novamente." };
  if (caught.status === 429) return { message: "Muitas tentativas em pouco tempo.", hint: "Espere alguns segundos antes de tentar novamente." };
  if (caught.status >= 500) return { message: "O Ginga encontrou um problema ao criar o webhook.", hint: "Nada foi criado. Tente novamente em alguns instantes." };
  return { message: caught.message || "Revise os dados do webhook e tente novamente.", field, hint: field === "name" ? "Use um nome curto que identifique o sistema, como Deploy ou Alertas." : field === "channelId" ? "Escolha um canal de texto ou anuncios." : undefined };
}
