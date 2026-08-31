# Ginga 0.4.0 - Validacao do pacote

## Validacoes executadas neste pacote

- `node --check` em `apps/desktop/src/main.cjs`, `preload.cjs` e `brand.cjs`: OK.
- Parser/transpilacao TypeScript dos modulos alterados de API e Web: OK.
- JSON dos `package.json`/`package-lock.json`: OK.
- Balanceamento estrutural do CSS: OK.
- Versoes root/API/Web/Desktop: `0.4.0`.

## Build de producao

O ambiente usado para preparar este pacote nao possuia todas as dependencias npm em cache e nao conseguiu buscar o pacote `zod` do registry. Por isso o `npm run build` completo nao foi declarado como concluido aqui.

Antes de publicar no servidor/gerar o instalador, rode na maquina de build com acesso ao registry:

```bash
cd /opt/ginga-build/apps/api
npm ci
npm run build

cd /opt/ginga-build/apps/web
npm ci
npm run build

cd /opt/ginga-build
node --check apps/desktop/src/main.cjs
node --check apps/desktop/src/preload.cjs
./release-win.sh 0.4.0
```

Nao substitua nem compartilhe a chave privada de update existente em `/opt/ginga-build/secrets/update-signing/private.pem`.
