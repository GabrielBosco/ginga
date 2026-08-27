#!/bin/sh
set -eu
cd "$(dirname "$0")"

if ! command -v docker >/dev/null 2>&1; then
  echo "ERRO: Docker nao encontrado."
  exit 1
fi

ENV_ARGS=""
if [ ! -f secrets/update-signing/private.pem ]; then
  echo "Primeiro build: uma nova chave Ed25519 do updater sera criada."
  ENV_ARGS="-e GINGA_ALLOW_NEW_UPDATE_KEY=1"
else
  echo "Usando a chave existente do updater."
fi

docker run --rm -t \
  $ENV_ARGS \
  -v "$PWD:/project" \
  -v ginga-electron-cache:/root/.cache/electron \
  -v ginga-electron-builder-cache:/root/.cache/electron-builder \
  electronuserland/builder:wine \
  bash -lc 'cd /project/apps/desktop && npm ci && npm run dist:win'

VERSION=$(node -p "require('./apps/desktop/package.json').version" 2>/dev/null || true)
if [ -z "$VERSION" ]; then
  VERSION=$(grep -m1 '"version"' apps/desktop/package.json | sed -E 's/.*"version"[[:space:]]*:[[:space:]]*"([^"]+)".*/\1/')
fi

echo
echo "Build finalizada. Instalador esperado:"
echo "$PWD/apps/desktop/dist/Ginga-Setup-${VERSION}-x64.exe"
echo
echo "IMPORTANTE: faca backup de:"
echo "$PWD/secrets/update-signing/private.pem"
