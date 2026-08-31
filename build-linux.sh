#!/usr/bin/env bash
set -Eeuo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ARCH="${1:-x64}"
case "$ARCH" in x64|arm64) ;; *) echo "Uso: $0 [x64|arm64]" >&2; exit 2;; esac
command -v docker >/dev/null || { echo "[ERRO] Docker nao encontrado" >&2; exit 1; }

IMAGE="${GINGA_LINUX_BUILDER_IMAGE:-electronuserland/builder:22}"
USER_ARGS=()
if command -v id >/dev/null 2>&1; then USER_ARGS=(--user "$(id -u):$(id -g)"); fi

echo "[Ginga] Build Linux $ARCH usando $IMAGE"
docker run --rm -t \
  "${USER_ARGS[@]}" \
  -e HOME=/tmp/ginga-home \
  -e npm_config_cache=/tmp/npm-cache \
  -v "$ROOT:/project" \
  -w /project/apps/desktop \
  "$IMAGE" \
  bash -lc "set -e; npm ci; npm run dist:linux:$ARCH"

echo "[Ginga] Artefatos: $ROOT/apps/desktop/dist"
find "$ROOT/apps/desktop/dist" -maxdepth 1 -type f -printf '%f\n' | sort
