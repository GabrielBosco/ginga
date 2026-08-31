# Auditoria GitHub — Ginga 0.4.5

Origem auditada: cópia sanitizada de `/opt/ginga` e `/opt/ginga-build`.

## Resultado estrutural

As duas árvores continham o mesmo source completo; não há motivo para publicar `server/` e `build/` como projetos duplicados.

O repositório final usa um único monorepo:

```text
apps/
branding/
docs/
examples/
infra/
scripts/
sdk/
updates/.gitkeep
```

## Removido do pacote público

- `.patch-backups/`;
- `.release-backups/`;
- `.security-backup/`;
- `.ginga-hotfix-backup/`;
- `*.tsbuildinfo`;
- `*.bak`;
- dados e artefatos de runtime/build;
- endpoints específicos da instalação de produção;
- duplicação `server/` + `build/`.

## Preservado intencionalmente

- `apps/desktop/update-public.pem`: chave pública do updater;
- histórico em `CHANGELOG.md` e `docs/`;
- scripts Windows/Linux;
- Android experimental;
- SDK Python/JavaScript;
- branding atual.

## Ajustes de higiene

- `.gitignore` ampliado;
- `.env.example` reconstruído com placeholders inválidos/seguros;
- README atualizado para `0.4.5`;
- documentação de instalação/configuração/arquitetura/Desktop/segurança adicionada;
- `docs/GITHUB.md` atualizado para `GabrielBosco/ginga`;
- `prepare-github.sh` reforçado para detectar segredos, backups, endpoints privados e regressão do electron-builder Linux;
- URL do Desktop removida do source público; o pipeline de release continua injetando a URL oficial no build;
- cache do Service Worker rotacionado para `ginga-shell-v045`.

## Validações executadas

- JSON: OK;
- YAML/Compose/workflows: sintaxe OK;
- CJS do Desktop: parser OK;
- scripts shell: parser OK;
- SDK Python: parser OK;
- versões Root/API/Web/Desktop: `0.4.5`;
- configuração Linux `deb/rpm packageName`: OK;
- links principais do README/docs: OK;
- chave privada: não encontrada;
- endpoints específicos de produção: não encontrados;
- `scripts/prepare-github.sh`: OK.

O build completo de API/Web não foi repetido nesta auditoria por não haver dependências `node_modules` no pacote de auditoria. O GitHub Actions executa `npm ci`, `prisma generate` e os builds em um ambiente limpo a cada push/PR.
