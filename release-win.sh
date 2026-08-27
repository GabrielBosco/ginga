#!/usr/bin/env bash
set -Eeuo pipefail

# Build + publish do cliente Windows.
#
# Uso:
#   GINGA_PUBLIC_URL=https://chat.example.com ./release-win.sh 0.3.1
#
# Primeira cadeia de updater apenas:
#   GINGA_PUBLIC_URL=https://chat.example.com ./release-win.sh 0.3.1 --init-key
#
# O mesmo private.pem deve ser reutilizado em todas as releases seguintes.

VERSION="${1:-}"
INIT_KEY=0
[[ "${2:-}" == "--init-key" ]] && INIT_KEY=1

SCRIPT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SERVER_ROOT="${GINGA_SERVER_ROOT:-$SCRIPT_ROOT}"
BUILD_ROOT="${GINGA_BUILD_ROOT:-$SCRIPT_ROOT}"
COMPOSE_FILE="${GINGA_COMPOSE_FILE:-docker-compose.production.yml}"
PUBLIC_URL="${GINGA_PUBLIC_URL:-}"
BUILDER_IMAGE="${GINGA_BUILDER_IMAGE:-electronuserland/builder:wine}"
NODE_IMAGE="${GINGA_NODE_IMAGE:-node:22-alpine}"

DESKTOP_DIR="$BUILD_ROOT/apps/desktop"
SIGN_SCRIPT="$BUILD_ROOT/scripts/update-signing.cjs"
PRIVATE_KEY="$BUILD_ROOT/secrets/update-signing/private.pem"
UPDATE_DIR_SERVER="$SERVER_ROOT/updates/windows"
UPDATE_DIR_BUILD="$BUILD_ROOT/updates/windows"
LOCK_FILE="/tmp/ginga-release-win.lock"

log() { printf '\n[Ginga Release] %s\n' "$*"; }
ok() { printf '[OK] %s\n' "$*"; }
die() { printf '[ERRO] %s\n' "$*" >&2; exit 1; }

[[ -n "$VERSION" ]] || die "Informe a versao. Ex.: ./release-win.sh 0.3.1"
[[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+([.-][0-9A-Za-z]+([.-][0-9A-Za-z]+)*)?$ ]] || die "Versao invalida: $VERSION"

if [[ -z "$PUBLIC_URL" && -f "$SERVER_ROOT/.env" ]]; then
  PUBLIC_URL="$(awk -F= '/^GINGA_SERVER_URL=/{sub(/^[^=]*=/,""); print; exit}' "$SERVER_ROOT/.env" | tr -d '\r' || true)"
fi
PUBLIC_URL="${PUBLIC_URL%/}"
[[ "$PUBLIC_URL" =~ ^https?:// ]] || die "Defina GINGA_PUBLIC_URL, por exemplo https://chat.example.com"

for cmd in docker curl python3 flock sha256sum; do
  command -v "$cmd" >/dev/null 2>&1 || die "Comando ausente: $cmd"
done
docker compose version >/dev/null 2>&1 || die "docker compose indisponivel"
[[ -f "$SERVER_ROOT/$COMPOSE_FILE" ]] || die "$COMPOSE_FILE nao encontrado em $SERVER_ROOT"
[[ -f "$SERVER_ROOT/.env" ]] || die ".env nao encontrado em $SERVER_ROOT"
[[ -f "$DESKTOP_DIR/package.json" ]] || die "Desktop nao encontrado em $DESKTOP_DIR"
[[ -f "$SIGN_SCRIPT" ]] || die "Signer nao encontrado: $SIGN_SCRIPT"

exec 9>"$LOCK_FILE"
flock -n 9 || die "Outra release Windows ja esta em execucao"

if [[ ! -f "$PRIVATE_KEY" && "$INIT_KEY" -ne 1 ]]; then
  die "private.pem ausente. Restaure a chave original ou use --init-key somente antes da primeira release distribuida."
fi
if [[ -f "$PRIVATE_KEY" && "$INIT_KEY" -eq 1 ]]; then
  INIT_KEY=0
  log "Chave existente encontrada; preservando a cadeia atual."
fi

BACKUP_DIR="$BUILD_ROOT/.release-backups/$(date +%Y%m%d-%H%M%S)-$VERSION"
mkdir -p "$BACKUP_DIR/server" "$BACKUP_DIR/desktop"
cp -a "$SERVER_ROOT/.env" "$BACKUP_DIR/server/.env"
cp -a "$DESKTOP_DIR/package.json" "$BACKUP_DIR/desktop/package.json"
cp -a "$DESKTOP_DIR/config.json" "$BACKUP_DIR/desktop/config.json"
[[ -f "$DESKTOP_DIR/package-lock.json" ]] && cp -a "$DESKTOP_DIR/package-lock.json" "$BACKUP_DIR/desktop/package-lock.json"

npm_bump() {
  local dir="$1"
  docker run --rm -v "$dir:/work" -w /work "$NODE_IMAGE" \
    npm version "$VERSION" --no-git-tag-version --allow-same-version >/dev/null
}

log "1/7 - Sincronizando versoes"
python3 - "$SERVER_ROOT/.env" "$VERSION" <<'PY'
import pathlib, re, sys
p = pathlib.Path(sys.argv[1]); version = sys.argv[2]
s = p.read_text(encoding='utf-8')
if re.search(r'(?m)^GINGA_RELEASE_VERSION=.*$', s):
    s = re.sub(r'(?m)^GINGA_RELEASE_VERSION=.*$', f'GINGA_RELEASE_VERSION={version}', s)
else:
    s = s.rstrip() + f'\nGINGA_RELEASE_VERSION={version}\n'
p.write_text(s, encoding='utf-8')
PY
npm_bump "$SERVER_ROOT/apps/api"
npm_bump "$SERVER_ROOT/apps/web"
npm_bump "$DESKTOP_DIR"
ok "API/Web/Desktop = $VERSION"

log "2/7 - Configurando Desktop para $PUBLIC_URL"
python3 - "$DESKTOP_DIR/package.json" "$DESKTOP_DIR/config.json" "$PUBLIC_URL" <<'PY'
import json, pathlib, sys
pkg_path = pathlib.Path(sys.argv[1]); cfg_path = pathlib.Path(sys.argv[2]); url = sys.argv[3].rstrip('/')
pkg = json.loads(pkg_path.read_text(encoding='utf-8'))
pkg.setdefault('build', {})['publish'] = [{'provider': 'generic', 'url': url + '/updates/windows'}]
pkg_path.write_text(json.dumps(pkg, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
cfg = json.loads(cfg_path.read_text(encoding='utf-8'))
cfg['serverUrl'] = url
cfg_path.write_text(json.dumps(cfg, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
PY

log "3/7 - Rebuild API/Web"
(
  cd "$SERVER_ROOT"
  docker compose -f "$COMPOSE_FILE" build api web
  docker compose -f "$COMPOSE_FILE" up -d --force-recreate api web
)

HEALTH=''
for _ in $(seq 1 30); do
  HEALTH="$(curl -fsS --max-time 5 "$PUBLIC_URL/api/health" 2>/dev/null || true)"
  [[ -n "$HEALTH" ]] && break
  sleep 2
done
python3 - "$VERSION" "$HEALTH" <<'PY'
import json, sys
expected = sys.argv[1]
try: data = json.loads(sys.argv[2])
except Exception as exc: raise SystemExit(f'health invalido: {exc}')
assert data.get('status') == 'ok', data
assert data.get('version') == expected, f"API={data.get('version')} esperado={expected}"
PY
ok "API publica saudavel em $VERSION"

log "4/7 - Validando chave do updater"
KEY_ARGS=()
if [[ "$INIT_KEY" -eq 1 ]]; then KEY_ARGS=(-e GINGA_ALLOW_NEW_UPDATE_KEY=1); fi
docker run --rm -t "${KEY_ARGS[@]}" -v "$BUILD_ROOT:/project" "$BUILDER_IMAGE" \
  bash -lc 'node /project/scripts/update-signing.cjs ensure /project'
[[ -f "$PRIVATE_KEY" ]] || die "private.pem nao foi criada/encontrada"
ok "Chave Ed25519 valida"

log "5/7 - Gerando instalador Windows"
rm -rf "$DESKTOP_DIR/dist"
docker run --rm -t \
  -v "$BUILD_ROOT:/project" \
  -v ginga-electron-cache:/root/.cache/electron \
  -v ginga-electron-builder-cache:/root/.cache/electron-builder \
  "$BUILDER_IMAGE" \
  bash -lc 'cd /project/apps/desktop && npm ci && npm run dist:win'

INSTALLER="$DESKTOP_DIR/dist/Ginga-Setup-$VERSION-x64.exe"
LATEST_YML="$DESKTOP_DIR/dist/latest.yml"
[[ -s "$INSTALLER" ]] || die "Instalador nao gerado"
[[ -s "$LATEST_YML" ]] || die "latest.yml nao gerado"
grep -Eq "^version:[[:space:]]*$VERSION[[:space:]]*$" "$LATEST_YML" || die "latest.yml com versao incorreta"
ok "Instalador gerado"

log "6/7 - Assinando e publicando feed"
mkdir -p "$UPDATE_DIR_BUILD" "$UPDATE_DIR_SERVER"
STAGING="$UPDATE_DIR_BUILD/.staging-$VERSION-$$"
trap 'rm -rf "${STAGING:-}" 2>/dev/null || true' EXIT
mkdir -p "$STAGING"
cp -f "$INSTALLER" "$STAGING/"
cp -f "$LATEST_YML" "$STAGING/latest.yml"
for f in "$DESKTOP_DIR/dist/"*.blockmap; do [[ -f "$f" ]] && cp -f "$f" "$STAGING/"; done

docker run --rm -t -v "$BUILD_ROOT:/project" "$BUILDER_IMAGE" \
  bash -lc "node /project/scripts/update-signing.cjs sign /project /project/apps/desktop/dist/Ginga-Setup-$VERSION-x64.exe '$VERSION' /project/updates/windows/$(basename "$STAGING")"

[[ -s "$STAGING/manifest.json" && -s "$STAGING/manifest.sig" ]] || die "Feed assinado incompleto"

publish_file() {
  local src="$1" dst="$2" tmp
  tmp="$dst/.release-$(basename "$src").$$.tmp"
  cp -f "$src" "$tmp"
  chmod 0644 "$tmp"
  mv -f "$tmp" "$dst/$(basename "$src")"
}

publish_file "$STAGING/Ginga-Setup-$VERSION-x64.exe" "$UPDATE_DIR_SERVER"
for f in "$STAGING/"*.blockmap; do [[ -f "$f" ]] && publish_file "$f" "$UPDATE_DIR_SERVER"; done
publish_file "$STAGING/latest.yml" "$UPDATE_DIR_SERVER"
publish_file "$STAGING/manifest.sig" "$UPDATE_DIR_SERVER"
publish_file "$STAGING/manifest.json" "$UPDATE_DIR_SERVER"

for f in "$STAGING"/*; do [[ -f "$f" ]] && cp -f "$f" "$UPDATE_DIR_BUILD/$(basename "$f")"; done
ok "Feed publicado em $UPDATE_DIR_SERVER"

log "7/7 - Validando publicacao"
REMOTE="$(curl -fsS --max-time 10 -H 'Cache-Control: no-cache' "$PUBLIC_URL/updates/windows/manifest.json?_release=$(date +%s)")"
python3 - "$VERSION" "$REMOTE" <<'PY'
import json, sys
m = json.loads(sys.argv[2]); v = sys.argv[1]
assert m.get('version') == v, m
assert m.get('file') == f'Ginga-Setup-{v}-x64.exe', m
PY
curl -fsSI --max-time 10 "$PUBLIC_URL/updates/windows/Ginga-Setup-$VERSION-x64.exe?_release=$(date +%s)" >/dev/null
SHA256="$(sha256sum "$UPDATE_DIR_SERVER/Ginga-Setup-$VERSION-x64.exe" | awk '{print $1}')"

printf '\nGinga %s publicado com sucesso\n' "$VERSION"
printf 'EXE:      %s/updates/windows/Ginga-Setup-%s-x64.exe\n' "$PUBLIC_URL" "$VERSION"
printf 'Manifest: %s/updates/windows/manifest.json\n' "$PUBLIC_URL"
printf 'SHA-256:  %s\n' "$SHA256"
printf 'Backup:   %s\n' "$BACKUP_DIR"
