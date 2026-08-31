# Publicando o Ginga no GitHub

Repositório oficial:

```text
https://github.com/GabrielBosco/ginga
```

## Gate antes do push

```bash
./scripts/prepare-github.sh
```

Para também compilar API e Web com Docker:

```bash
./scripts/prepare-github.sh --build
```

O comando deve terminar com:

```text
Repositorio pronto para publicacao no GitHub.
```

## Atualizar um clone existente

Entre no clone que contém `.git` e confirme o remote:

```bash
git remote -v
git branch --show-current
git status
```

O remote esperado é:

```text
https://github.com/GabrielBosco/ginga.git
```

Se precisar corrigir:

```bash
git remote set-url origin https://github.com/GabrielBosco/ginga.git
```

Sincronize o histórico antes de copiar uma árvore nova:

```bash
git pull --rebase origin main
```

Depois substitua o conteúdo do clone pela árvore limpa, preservando somente `.git/`:

```bash
rsync -av --delete \
  --exclude='.git/' \
  /caminho/Ginga-v0.4.5-GITHUB-READY/ \
  /caminho/do/clone/ginga/
```

Revise:

```bash
cd /caminho/do/clone/ginga
./scripts/prepare-github.sh
git status
git diff --stat
git diff
```

Commit e push:

```bash
git add -A
git commit -m "release: Ginga v0.4.5"
git push origin main
```

## Tag 0.4.5

Crie a tag somente depois que o commit correto estiver em `main`:

```bash
git tag -a v0.4.5 -m "Ginga v0.4.5"
git push origin v0.4.5
```

Se `v0.4.5` já existir, não sobrescreva uma tag pública sem revisar o histórico.

## O que não entra no Git

- `.env`;
- `secrets/`;
- chave privada do updater;
- `node_modules/`;
- `dist/` e `out/`;
- uploads/banco/backups;
- `.patch-backups/`, `.release-backups/`, `.security-backup/` e `.ginga-hotfix-backup/`;
- binários gerados em `updates/`.

A chave **pública** `apps/desktop/update-public.pem` pode e deve acompanhar o cliente que valida a cadeia existente.

## GitHub Releases

Não versione instaladores no histórico do Git. Publique-os em **Releases** e/ou no feed `/updates/` do servidor.

Para a `0.4.5`, os artefatos Desktop esperados são:

```text
Ginga-Setup-0.4.5-x64.exe
Ginga-0.4.5-linux-x64.AppImage
Ginga-0.4.5-linux-x64.deb
Ginga-0.4.5-linux-x64.rpm
Ginga-0.4.5-linux-arm64.AppImage
Ginga-0.4.5-linux-arm64.deb
```

## Configurações recomendadas no GitHub

Ative quando disponíveis:

- Issues;
- Discussions;
- Private vulnerability reporting;
- Dependabot alerts;
- secret scanning/push protection;
- proteção da branch `main` quando houver mais contribuidores.

Tópicos sugeridos:

```text
ginga
brasil
open-source
self-hosted
chat
webrtc
voice-chat
community
react
typescript
nodejs
postgresql
redis
livekit
electron
docker
```

Descrição curta sugerida:

> Plataforma brasileira, open source e auto-hospedada para comunidades, com chat em tempo real, voz, vídeo, moderação, bots e clientes Desktop/Web.

## Ginga Bot SDK

O SDK Python tem versão independente. Exemplo para `0.1.0`:

```bash
git tag -a sdk-python-v0.1.0 -m "Ginga Bot SDK 0.1.0"
git push origin sdk-python-v0.1.0
```

A publicação é feita pelo workflow `.github/workflows/python-sdk-publish.yml` usando PyPI Trusted Publishing.
