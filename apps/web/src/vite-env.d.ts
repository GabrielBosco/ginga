/// <reference types="vite/client" />

declare const __GINGA_WEB_VERSION__: string;

interface ImportMetaEnv {
  readonly VITE_GITHUB_REPOSITORY_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
