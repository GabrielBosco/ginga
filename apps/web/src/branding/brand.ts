/**
 * Identidade visual publica do produto.
 *
 * IMPORTANTE: nesta release o produto continua sendo Ginga. Este arquivo existe
 * para que um rebrand futuro nao exija trocar textos/assets em dezenas de pontos.
 * Namespaces tecnicos (ginga: IPC/eventos, tabelas e rotas) NAO fazem parte do
 * branding e devem permanecer estaveis para evitar quebra de compatibilidade.
 */
export const APP_BRAND = Object.freeze({
  name: "Ginga",
  shortName: "Ginga",
  desktopName: "Ginga Desktop",
  description: "Comunicacao auto-hospedada com texto, voz, video e compartilhamento de tela.",
  updateProduct: "Ginga",
  windowsInstallerPrefix: "Ginga-Setup",
  assets: Object.freeze({
    mark: "/brand/mark.svg",
    wordmark: "/brand/wordmark.svg",
    favicon: "/brand/favicon.svg"
  }),
  colors: Object.freeze({
    accent: "#7867e8",
    accentSecondary: "#4f9eff"
  })
});

export function applyDocumentBrand() {
  if (typeof document === "undefined") return;
  document.title = APP_BRAND.name;
  const description = document.querySelector('meta[name="description"]');
  if (description) description.setAttribute("content", `${APP_BRAND.name} - ${APP_BRAND.description}`);
  const favicon = document.querySelector<HTMLLinkElement>('link[rel~="icon"]');
  if (favicon) favicon.href = APP_BRAND.assets.favicon;
  document.documentElement.style.setProperty("--brand-accent", APP_BRAND.colors.accent);
  document.documentElement.style.setProperty("--brand-accent-secondary", APP_BRAND.colors.accentSecondary);
}
