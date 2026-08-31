#!/usr/bin/env bash
set -Eeuo pipefail

SOURCE_INPUT="${1:-}"
SERVER_ROOT="${GINGA_SERVER_ROOT:-/opt/ginga}"
BUILD_ROOT="${GINGA_BUILD_ROOT:-/opt/ginga-build}"

fail() { echo "ERRO: $*" >&2; exit 1; }
info() { echo "[Ginga] $*"; }

json_version() {
  python3 - "$1" <<'PY'
import json
import sys
with open(sys.argv[1], "r", encoding="utf-8") as handle:
    print(json.load(handle).get("version", ""))
PY
}

[[ -n "$SOURCE_INPUT" ]] || fail "Informe a pasta extraida da release."
command -v realpath >/dev/null || fail "realpath nao encontrado"
command -v rsync >/dev/null || fail "rsync nao encontrado"
command -v python3 >/dev/null || fail "python3 nao encontrado"

SOURCE="$(realpath -e "$SOURCE_INPUT" 2>/dev/null || true)"
[[ -n "$SOURCE" && -d "$SOURCE" ]] || fail "Source invalido."
[[ "$SOURCE" != "/" ]] || fail "Source '/' recusado por seguranca."
[[ "$SERVER_ROOT" != "/" ]] || fail "SERVER_ROOT '/' recusado por seguranca."
[[ "$BUILD_ROOT" != "/" ]] || fail "BUILD_ROOT '/' recusado por seguranca."

[[ -f "$SOURCE/docker-compose.yml" ]] || fail "docker-compose.yml ausente."
[[ -f "$SOURCE/apps/api/package.json" ]] || fail "API ausente."
[[ -f "$SOURCE/apps/web/package.json" ]] || fail "WEB ausente."
[[ -f "$SOURCE/apps/desktop/package.json" ]] || fail "Desktop ausente."

VERSION="$(json_version "$SOURCE/apps/api/package.json")"
[[ -n "$VERSION" ]] || fail "Nao foi possivel identificar a versao."

mkdir -p "$SERVER_ROOT" "$BUILD_ROOT"
[[ -f "$SERVER_ROOT/.env" ]] || fail ".env ativo ausente em $SERVER_ROOT"

EX=(
  --exclude=.env
  --exclude=updates/
  --exclude=node_modules/
  --exclude=dist/
  --exclude=build/
  --exclude=release/
  --exclude=out/
  --exclude=secrets/
  --exclude=.git/
  --exclude='*.exe'
  --exclude='*.deb'
  --exclude='*.rpm'
  --exclude='*.AppImage'
  --exclude='*.zip'
  --exclude=private.pem
)

info "Origem: $SOURCE"
info "Destino servidor: $SERVER_ROOT"
info "Destino build: $BUILD_ROOT"
info "Sincronizando Ginga $VERSION"

rsync -a "${EX[@]}" "$SOURCE/" "$SERVER_ROOT/"
rsync -a "${EX[@]}" "$SOURCE/" "$BUILD_ROOT/"

chmod +x "$SERVER_ROOT"/*.sh "$SERVER_ROOT"/scripts/*.sh 2>/dev/null || true
chmod +x "$BUILD_ROOT"/*.sh "$BUILD_ROOT"/scripts/*.sh 2>/dev/null || true

SERVER_VERSION="$(json_version "$SERVER_ROOT/apps/api/package.json")"
DESKTOP_VERSION="$(json_version "$BUILD_ROOT/apps/desktop/package.json")"
[[ "$SERVER_VERSION" == "$VERSION" ]] || fail "Versao API inconsistente."
[[ "$DESKTOP_VERSION" == "$VERSION" ]] || fail "Versao Desktop inconsistente."

info "Versao API: $SERVER_VERSION"
info "Versao Desktop: $DESKTOP_VERSION"
info "Atualizacao aplicada com seguranca."
info "Proximo passo: cd $BUILD_ROOT && ./scripts/pre-release-check.sh $VERSION --all"
