#!/usr/bin/env bash
set -Eeuo pipefail

# Ginga Windows Release Pipeline
#
# Uso normal:
#   ./release-win.sh 0.4.5
#
# Primeira release de uma cadeia NOVA de updater, apenas se voce AINDA nao tiver
# clientes publicados/chave de updater:
#   ./release-win.sh 0.4.5 --init-key
#
# Variaveis opcionais:
#   GINGA_SERVER_ROOT=/opt/ginga
#   GINGA_BUILD_ROOT=/opt/ginga-build
#   GINGA_PUBLIC_URL=https://ginga.example.com:3090
#   GINGA_BUILDER_IMAGE=electronuserland/builder:wine

VERSION="${1:-}"
INIT_KEY=0
[[ "${2:-}" == "--init-key" ]] && INIT_KEY=1

SERVER_ROOT="${GINGA_SERVER_ROOT:-/opt/ginga}"
BUILD_ROOT="${GINGA_BUILD_ROOT:-/opt/ginga-build}"
PUBLIC_URL="${GINGA_PUBLIC_URL:-}"
if [[ -z "$PUBLIC_URL" && -f "$SERVER_ROOT/.env" ]]; then
  PUBLIC_URL="$(awk -F= '/^GINGA_SERVER_URL=/{sub(/^[^=]*=/,""); gsub(/^['"']|['"']$/,""); print; exit}' "$SERVER_ROOT/.env")"
fi
BUILDER_IMAGE="${GINGA_BUILDER_IMAGE:-electronuserland/builder:wine}"
NODE_IMAGE="${GINGA_NODE_IMAGE:-node:22-alpine}"
UPDATE_DIR_SERVER="$SERVER_ROOT/updates/windows"
UPDATE_DIR_BUILD="$BUILD_ROOT/updates/windows"
DESKTOP_DIR="$BUILD_ROOT/apps/desktop"
SIGN_SCRIPT="$BUILD_ROOT/scripts/update-signing.cjs"
PRIVATE_KEY="$BUILD_ROOT/secrets/update-signing/private.pem"
LOCK_FILE="/tmp/ginga-release-win.lock"

log() { printf '\n\033[1;35m[Ginga Release]\033[0m %s\n' "$*"; }
ok()  { printf '\033[1;32m[OK]\033[0m %s\n' "$*"; }

RELEASE_PUBLISHED=0
METADATA_MUTATED=0
SERVER_RUNTIME_MUTATED=0
IN_FAILURE_HANDLER=0

cleanup() {
  if [[ -n "${STAGING:-}" && -d "${STAGING:-}" ]]; then
    rm -rf "$STAGING" || true
  fi
}

restore_release_metadata() {
  [[ "${METADATA_MUTATED:-0}" -eq 1 ]] || return 0
  [[ -n "${BACKUP_DIR:-}" && -d "${BACKUP_DIR:-}" ]] || return 0

  log "Falha antes da publicacao - restaurando metadados da release anterior"
  [[ -f "$BACKUP_DIR/server/.env" ]] && cp -a "$BACKUP_DIR/server/.env" "$SERVER_ROOT/.env"
  [[ -f "$BACKUP_DIR/server/api-package.json" ]] && cp -a "$BACKUP_DIR/server/api-package.json" "$SERVER_ROOT/apps/api/package.json"
  [[ -f "$BACKUP_DIR/server/api-package-lock.json" ]] && cp -a "$BACKUP_DIR/server/api-package-lock.json" "$SERVER_ROOT/apps/api/package-lock.json"
  [[ -f "$BACKUP_DIR/server/web-package.json" ]] && cp -a "$BACKUP_DIR/server/web-package.json" "$SERVER_ROOT/apps/web/package.json"
  [[ -f "$BACKUP_DIR/server/web-package-lock.json" ]] && cp -a "$BACKUP_DIR/server/web-package-lock.json" "$SERVER_ROOT/apps/web/package-lock.json"
  [[ -f "$BACKUP_DIR/desktop/package.json" ]] && cp -a "$BACKUP_DIR/desktop/package.json" "$DESKTOP_DIR/package.json"
  [[ -f "$BACKUP_DIR/desktop/package-lock.json" ]] && cp -a "$BACKUP_DIR/desktop/package-lock.json" "$DESKTOP_DIR/package-lock.json"
  [[ -f "$BACKUP_DIR/desktop/config.json" ]] && cp -a "$BACKUP_DIR/desktop/config.json" "$DESKTOP_DIR/config.json"

  # Se a falha ocorreu no meio da publicacao arquivo-a-arquivo, latest.yml e
  # manifest.sig podem ja ter sido trocados enquanto manifest.json ainda aponta
  # para a release anterior. Restaura o trio anterior para nunca deixar o feed
  # permanentemente inconsistente.
  if [[ -d "$BACKUP_DIR/update-feed" ]]; then
    for metadata in latest.yml manifest.sig manifest.json; do
      if [[ -f "$BACKUP_DIR/update-feed/$metadata" ]]; then
        cp -a "$BACKUP_DIR/update-feed/$metadata" "$UPDATE_DIR_SERVER/$metadata"
      elif [[ -f "$BACKUP_DIR/update-feed/.missing-$metadata" ]]; then
        rm -f "$UPDATE_DIR_SERVER/$metadata"
      fi
    done
    rm -f "$UPDATE_DIR_SERVER/Ginga-Setup-$VERSION-x64.exe"           "$UPDATE_DIR_SERVER/Ginga-Setup-$VERSION-x64.exe.blockmap"
  fi

  if [[ "${SERVER_RUNTIME_MUTATED:-0}" -eq 1 ]]; then
    log "Restaurando API/Web executados para a release anterior"
    if (cd "$SERVER_ROOT" && docker compose build api web && docker compose up -d --force-recreate api web); then
      ok "API/Web restaurados"
    else
      printf '\033[1;33m[WARN]\033[0m Metadados restaurados, mas o rebuild automatico de API/Web falhou. Use o backup: %s\n' "$BACKUP_DIR" >&2
    fi
  fi
  METADATA_MUTATED=0
}

abort_release() {
  local rc="${1:-1}"
  shift || true
  local message="$*"
  if [[ "${IN_FAILURE_HANDLER:-0}" -eq 0 ]]; then
    IN_FAILURE_HANDLER=1
    trap - ERR
    set +e
    if [[ "${RELEASE_PUBLISHED:-0}" -eq 0 ]]; then
      restore_release_metadata
    fi
    cleanup
  fi
  printf '\033[1;31m[ERRO]\033[0m %s\n' "$message" >&2
  exit "$rc"
}

die() { abort_release 1 "$*"; }
on_error() {
  local rc=$?
  local line="${1:-desconhecida}"
  abort_release "$rc" "Release interrompida na linha $line. Verifique o erro acima e o backup informado."
}

trap cleanup EXIT
trap 'on_error "$LINENO"' ERR

[[ -n "$VERSION" ]] || die "Informe a versao. Exemplo: ./release-win.sh 0.4.5"
[[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+([.-][0-9A-Za-z]+([.-][0-9A-Za-z]+)*)?$ ]] || die "Versao invalida: $VERSION. Use SemVer, por exemplo 0.4.5 ou 0.4.4-beta.1"
[[ -n "$PUBLIC_URL" ]] || die "GINGA_PUBLIC_URL nao definido e GINGA_SERVER_URL nao encontrado em $SERVER_ROOT/.env"

for cmd in docker curl python3 flock; do
  command -v "$cmd" >/dev/null 2>&1 || die "Comando obrigatorio ausente: $cmd"
done

docker compose version >/dev/null 2>&1 || die "docker compose nao esta disponivel"
[[ -d "$SERVER_ROOT" ]] || die "Servidor Ginga nao encontrado em $SERVER_ROOT"
[[ -f "$SERVER_ROOT/docker-compose.yml" ]] || die "docker-compose.yml nao encontrado em $SERVER_ROOT"
[[ -f "$SERVER_ROOT/.env" ]] || die ".env nao encontrado em $SERVER_ROOT"
[[ -d "$DESKTOP_DIR" ]] || die "Desktop nao encontrado em $DESKTOP_DIR"
[[ -f "$DESKTOP_DIR/package.json" ]] || die "package.json do Desktop nao encontrado"
[[ -f "$DESKTOP_DIR/config.json" ]] || die "config.json do Desktop nao encontrado"
[[ -f "$SIGN_SCRIPT" ]] || die "update-signing.cjs nao encontrado em $SIGN_SCRIPT"

exec 9>"$LOCK_FILE"
flock -n 9 || die "Ja existe outra release do Ginga em execucao."

if [[ ! -f "$PRIVATE_KEY" && "$INIT_KEY" -ne 1 ]]; then
  die "Chave privada do updater ausente: $PRIVATE_KEY. Restaure a private.pem original. NAO gere outra chave para clientes existentes."
fi

if [[ -f "$PRIVATE_KEY" && "$INIT_KEY" -eq 1 ]]; then
  log "A chave do updater ja existe; --init-key sera ignorado e a chave atual sera preservada."
  INIT_KEY=0
fi

# Nunca reutilize uma versao ja publicada. O electron-updater compara SemVer;
# republicar 0.4.5 por cima de outro 0.4.5 deixa clientes com caches/artefatos
# diferentes e dificulta rollback. Override existe apenas para recuperacao manual.
if [[ -f "$UPDATE_DIR_SERVER/manifest.json" ]]; then
  PUBLISHED_VERSION="$(python3 - "$UPDATE_DIR_SERVER/manifest.json" <<'PYVERSION'
import json,sys
try:
    print(str(json.load(open(sys.argv[1], encoding='utf-8')).get('version','')).strip())
except Exception:
    print('')
PYVERSION
)"
  if [[ -n "$PUBLISHED_VERSION" ]]; then
    VERSION_ORDER="$(python3 - "$PUBLISHED_VERSION" "$VERSION" <<'PYVERSION'
import re,sys

def parse(value):
    m=re.fullmatch(r'(\d+)\.(\d+)\.(\d+)(?:-(.+))?', value or '')
    if not m: raise SystemExit(f'Versao publicada/alvo invalida: {value}')
    core=tuple(map(int,m.group(1,2,3)))
    pre=m.group(4)
    if pre is None: return core, 1, ()
    parts=[]
    for token in re.split(r'[.-]',pre.lower()):
        for item in re.findall(r'\d+|[a-z]+|[^a-z\d]+',token):
            parts.append((0,int(item)) if item.isdigit() else (1,item))
    return core, 0, tuple(parts)

current,target=sys.argv[1:3]
a,b=parse(current),parse(target)
print('gt' if b>a else 'eq' if b==a else 'lt')
PYVERSION
)"
    if [[ "$VERSION_ORDER" != "gt" && "${GINGA_ALLOW_REPUBLISH:-0}" != "1" ]]; then
      die "Feed atual ja publica $PUBLISHED_VERSION; a nova release $VERSION precisa ser maior. Se isto for uma recuperacao excepcional, use GINGA_ALLOW_REPUBLISH=1 conscientemente."
    fi
    if [[ "$VERSION_ORDER" != "gt" ]]; then
      printf '\033[1;33m[WARN]\033[0m GINGA_ALLOW_REPUBLISH=1 ativo: republicando/downgrade de %s para %s.\n' "$PUBLISHED_VERSION" "$VERSION" >&2
    else
      ok "Ordem de versao valida: $PUBLISHED_VERSION -> $VERSION"
    fi
  fi
fi

log "Release Windows $VERSION"
printf 'Servidor : %s\nBuild    : %s\nPublico  : %s\n' "$SERVER_ROOT" "$BUILD_ROOT" "$PUBLIC_URL"

# Faz backup pequeno dos metadados que serao alterados.
BACKUP_DIR="$BUILD_ROOT/.release-backups/$(date +%Y%m%d-%H%M%S)-$VERSION"
mkdir -p "$BACKUP_DIR/server" "$BACKUP_DIR/desktop" "$BACKUP_DIR/update-feed"
cp -a "$SERVER_ROOT/.env" "$BACKUP_DIR/server/.env"
for metadata in latest.yml manifest.sig manifest.json; do
  if [[ -f "$UPDATE_DIR_SERVER/$metadata" ]]; then
    cp -a "$UPDATE_DIR_SERVER/$metadata" "$BACKUP_DIR/update-feed/$metadata"
  else
    : > "$BACKUP_DIR/update-feed/.missing-$metadata"
  fi
done
for f in "$SERVER_ROOT/apps/api/package.json" "$SERVER_ROOT/apps/api/package-lock.json" \
         "$SERVER_ROOT/apps/web/package.json" "$SERVER_ROOT/apps/web/package-lock.json"; do
  [[ -f "$f" ]] && cp -a "$f" "$BACKUP_DIR/server/$(basename "$(dirname "$f")")-$(basename "$f")"
done
cp -a "$DESKTOP_DIR/package.json" "$BACKUP_DIR/desktop/package.json"
[[ -f "$DESKTOP_DIR/package-lock.json" ]] && cp -a "$DESKTOP_DIR/package-lock.json" "$BACKUP_DIR/desktop/package-lock.json"
cp -a "$DESKTOP_DIR/config.json" "$BACKUP_DIR/desktop/config.json"
ok "Backup de metadados: $BACKUP_DIR"

log "1/8 - Ajustando versao do servidor"
METADATA_MUTATED=1
python3 - "$SERVER_ROOT/.env" "$VERSION" <<'PY'
import pathlib, re, sys
p = pathlib.Path(sys.argv[1])
v = sys.argv[2]
s = p.read_text(encoding='utf-8')
if re.search(r'(?m)^GINGA_RELEASE_VERSION=.*$', s):
    s = re.sub(r'(?m)^GINGA_RELEASE_VERSION=.*$', f'GINGA_RELEASE_VERSION={v}', s)
else:
    s = s.rstrip() + f'\nGINGA_RELEASE_VERSION={v}\n'
p.write_text(s, encoding='utf-8')
PY

npm_bump() {
  local dir="$1"
  [[ -f "$dir/package.json" ]] || return 0
  docker run --rm \
    -v "$dir:/work" \
    -w /work \
    "$NODE_IMAGE" \
    npm version "$VERSION" --no-git-tag-version --allow-same-version >/dev/null
}

npm_bump "$SERVER_ROOT/apps/api"
npm_bump "$SERVER_ROOT/apps/web"
ok "Servidor/API/Web marcados como $VERSION"

log "2/8 - Ajustando Desktop para $VERSION e HTTPS oficial"
npm_bump "$DESKTOP_DIR"
python3 - "$DESKTOP_DIR/package.json" "$DESKTOP_DIR/config.json" "$PUBLIC_URL" <<'PY'
import json, pathlib, sys
pkg_path = pathlib.Path(sys.argv[1])
config_path = pathlib.Path(sys.argv[2])
public_url = sys.argv[3].rstrip('/')

pkg = json.loads(pkg_path.read_text(encoding='utf-8'))
build = pkg.setdefault('build', {})
publish = build.get('publish')
entry = {'provider': 'generic', 'url': public_url + '/updates/windows'}
if not isinstance(publish, list) or not publish:
    build['publish'] = [entry]
else:
    publish[0].update(entry)
pkg_path.write_text(json.dumps(pkg, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')

cfg = json.loads(config_path.read_text(encoding='utf-8'))
cfg['serverUrl'] = public_url
config_path.write_text(json.dumps(cfg, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
PY

python3 - "$DESKTOP_DIR/package.json" "$DESKTOP_DIR/config.json" "$VERSION" "$PUBLIC_URL" <<'PY'
import json, sys
pkg=json.load(open(sys.argv[1], encoding='utf-8'))
cfg=json.load(open(sys.argv[2], encoding='utf-8'))
v=sys.argv[3]; url=sys.argv[4].rstrip('/')
assert pkg['version'] == v, (pkg['version'], v)
assert cfg['serverUrl'] == url, cfg
assert pkg['build']['publish'][0]['url'] == url + '/updates/windows', pkg['build']['publish']
print(f'Desktop {v} -> {url}')
PY
ok "Desktop configurado para $PUBLIC_URL"

log "3/8 - Rebuildando API e Web atuais"
SERVER_RUNTIME_MUTATED=1
(
  cd "$SERVER_ROOT"
  docker compose build api web
  docker compose up -d --force-recreate api web
)

WEB_PORT="$(awk -F= '/^WEB_PORT=/{print $2; exit}' "$SERVER_ROOT/.env" | tr -d '\r' || true)"
WEB_PORT="${WEB_PORT:-3090}"
log "Validando API local em 127.0.0.1:$WEB_PORT"
HEALTH_OK=0
HEALTH_JSON=''
for _ in $(seq 1 30); do
  HEALTH_JSON="$(curl -fsS --max-time 3 "http://127.0.0.1:${WEB_PORT}/api/health" 2>/dev/null || true)"
  if [[ -n "$HEALTH_JSON" ]]; then
    HEALTH_OK=1
    break
  fi
  sleep 2
done
[[ "$HEALTH_OK" -eq 1 ]] || die "API/Web nao ficaram saudaveis depois do rebuild. Release abortada antes de publicar o EXE."
python3 - "$VERSION" "$HEALTH_JSON" <<'PYHEALTH'
import json, sys
expected=sys.argv[1]
data=json.loads(sys.argv[2])
assert data.get('status') == 'ok', data
assert data.get('version') == expected, f"API anunciou {data.get('version')}, esperado {expected}"
print('Health:', data.get('service'), data.get('version'))
PYHEALTH
ok "Web/API saudaveis e executando $VERSION"

log "4/8 - Validando chave criptografica do updater"
DOCKER_KEY_ARGS=()
if [[ "$INIT_KEY" -eq 1 ]]; then
  DOCKER_KEY_ARGS=(-e GINGA_ALLOW_NEW_UPDATE_KEY=1)
  log "ATENCAO: inicializando uma NOVA cadeia Ed25519 de updater."
fi

docker run --rm -t \
  "${DOCKER_KEY_ARGS[@]}" \
  -v "$BUILD_ROOT:/project" \
  "$BUILDER_IMAGE" \
  bash -lc 'node /project/scripts/update-signing.cjs ensure /project'
[[ -f "$PRIVATE_KEY" ]] || die "A chave privada do updater nao foi criada/encontrada."
ok "Chave do updater validada"

log "5/8 - Gerando Ginga-Setup-$VERSION-x64.exe"
rm -rf "$DESKTOP_DIR/dist"
docker run --rm -t \
  -v "$BUILD_ROOT:/project" \
  -v ginga-electron-cache:/root/.cache/electron \
  -v ginga-electron-builder-cache:/root/.cache/electron-builder \
  "$BUILDER_IMAGE" \
  bash -lc 'cd /project/apps/desktop && npm ci && npm run dist:win'

INSTALLER="$DESKTOP_DIR/dist/Ginga-Setup-$VERSION-x64.exe"
LATEST_YML="$DESKTOP_DIR/dist/latest.yml"
[[ -s "$INSTALLER" ]] || die "Instalador nao foi gerado: $INSTALLER"
[[ -s "$LATEST_YML" ]] || die "latest.yml nao foi gerado; publicar assim quebraria o electron-updater."
grep -Eq "^version:[[:space:]]*$VERSION[[:space:]]*$" "$LATEST_YML" || die "latest.yml nao aponta para $VERSION"
ok "Instalador gerado: $(du -h "$INSTALLER" | awk '{print $1}')"

log "6/8 - Gerando feed assinado"
mkdir -p "$UPDATE_DIR_BUILD" "$UPDATE_DIR_SERVER"
STAGING="$UPDATE_DIR_BUILD/.staging-$VERSION-$$"
mkdir -p "$STAGING"
cp -f "$INSTALLER" "$STAGING/"
cp -f "$LATEST_YML" "$STAGING/latest.yml"
for f in "$DESKTOP_DIR/dist/"*.blockmap; do
  [[ -f "$f" ]] && cp -f "$f" "$STAGING/"
done

# O signer cria manifest.json e manifest.sig e verifica a assinatura Ed25519.
docker run --rm -t \
  -v "$BUILD_ROOT:/project" \
  "$BUILDER_IMAGE" \
  bash -lc "node /project/scripts/update-signing.cjs sign /project /project/apps/desktop/dist/Ginga-Setup-$VERSION-x64.exe '$VERSION' /project/updates/windows/$(basename "$STAGING")"

[[ -s "$STAGING/manifest.json" ]] || die "manifest.json nao foi gerado"
[[ -s "$STAGING/manifest.sig" ]] || die "manifest.sig nao foi gerado"
python3 - "$STAGING/manifest.json" "$VERSION" <<'PY'
import json, sys
m=json.load(open(sys.argv[1], encoding='utf-8'))
assert m.get('version') == sys.argv[2], m
assert m.get('file') == f'Ginga-Setup-{sys.argv[2]}-x64.exe', m
assert m.get('sha512'), m
print('Manifest:', m['version'], m['file'], m['size'])
PY
ok "Feed assinado e coerente"

log "7/8 - Publicando atomically no repositorio do site"
# Primeiro payload; depois latest.yml; assinatura; manifest.json POR ULTIMO.
# Assim o site nunca anuncia a nova versao antes de o EXE existir.
publish_file() {
  local src="$1" dst="$2" tmp
  tmp="$dst/.release-$(basename "$src").$$.tmp"
  cp -f "$src" "$tmp"
  chmod 0644 "$tmp"
  mv -f "$tmp" "$dst/$(basename "$src")"
}

publish_file "$STAGING/Ginga-Setup-$VERSION-x64.exe" "$UPDATE_DIR_SERVER"
for f in "$STAGING/"*.blockmap; do
  [[ -f "$f" ]] && publish_file "$f" "$UPDATE_DIR_SERVER"
done
publish_file "$STAGING/latest.yml" "$UPDATE_DIR_SERVER"
publish_file "$STAGING/manifest.sig" "$UPDATE_DIR_SERVER"
publish_file "$STAGING/manifest.json" "$UPDATE_DIR_SERVER"
RELEASE_PUBLISHED=1

# Mantem uma copia limpa do feed atual no repo de build tambem.
for f in "$STAGING"/*; do
  [[ -f "$f" ]] && cp -f "$f" "$UPDATE_DIR_BUILD/$(basename "$f")"
done
chmod 0644 "$UPDATE_DIR_BUILD"/* 2>/dev/null || true
ok "Release publicada em $UPDATE_DIR_SERVER"

log "8/8 - Validando o que o site esta entregando"
PUBLIC_HOST="$(python3 - "$PUBLIC_URL" <<'PY'
from urllib.parse import urlparse
import sys
u=urlparse(sys.argv[1])
print(u.hostname or '')
PY
)"
PUBLIC_PORT="$(python3 - "$PUBLIC_URL" <<'PY'
from urllib.parse import urlparse
import sys
u=urlparse(sys.argv[1])
print(u.port or (443 if u.scheme == 'https' else 80))
PY
)"

CURL_RESOLVE=()
APP_DOMAIN_VALUE=""
if [[ -f "$SERVER_ROOT/.env" ]]; then
  APP_DOMAIN_VALUE="$(awk -F= '/^APP_DOMAIN=/{sub(/^[^=]*=/,""); gsub(/^['"']|['"']$/,""); print; exit}' "$SERVER_ROOT/.env")"
fi
if [[ -n "$APP_DOMAIN_VALUE" && "$PUBLIC_HOST" == "$APP_DOMAIN_VALUE" ]]; then
  CURL_RESOLVE=(--resolve "${PUBLIC_HOST}:${PUBLIC_PORT}:127.0.0.1")
fi

REMOTE_MANIFEST="$(curl -fsS --max-time 10 -H 'Cache-Control: no-cache' "${CURL_RESOLVE[@]}" "$PUBLIC_URL/updates/windows/manifest.json?_ginga_release=$(date +%s)")"
python3 - "$VERSION" "$REMOTE_MANIFEST" <<'PY'
import json, sys
v=sys.argv[1]
m=json.loads(sys.argv[2])
assert m.get('version') == v, m
assert m.get('file') == f'Ginga-Setup-{v}-x64.exe', m
print('Site manifest OK:', m['version'], m['file'])
PY

curl -fsSI --max-time 10 -H 'Cache-Control: no-cache' "${CURL_RESOLVE[@]}" "$PUBLIC_URL/updates/windows/Ginga-Setup-$VERSION-x64.exe?_ginga_release=$(date +%s)" >/dev/null
curl -fsS --max-time 10 -H 'Cache-Control: no-cache' "${CURL_RESOLVE[@]}" "$PUBLIC_URL/updates/windows/latest.yml?_ginga_release=$(date +%s)" | grep -Eq "^version:[[:space:]]*$VERSION[[:space:]]*$" || die "Site nao esta entregando latest.yml da versao $VERSION"
ok "Site ja reconhece e entrega a release $VERSION"

SHA256="$(sha256sum "$UPDATE_DIR_SERVER/Ginga-Setup-$VERSION-x64.exe" | awk '{print $1}')"

printf '\n\033[1;32m============================================================\033[0m\n'
printf '\033[1;32m  GINGA %s PUBLICADO COM SUCESSO\033[0m\n' "$VERSION"
printf '\033[1;32m============================================================\033[0m\n'
printf 'EXE      : %s/updates/windows/Ginga-Setup-%s-x64.exe\n' "$PUBLIC_URL" "$VERSION"
printf 'Manifest : %s/updates/windows/manifest.json\n' "$PUBLIC_URL"
printf 'SHA-256  : %s\n' "$SHA256"
printf 'Backup   : %s\n' "$BACKUP_DIR"
NEXT_VERSION="$(python3 - "$VERSION" <<'PY'
import re, sys
value = sys.argv[1]
match = re.fullmatch(r'(\d+)\.(\d+)\.(\d+)', value)
if match:
    major, minor, patch = map(int, match.groups())
    print(f'{major}.{minor}.{patch + 1}')
else:
    print('<proxima-versao-semver>')
PY
)"
printf '\nPara a proxima versao, basta:\n  %s %s\n\n' "$0" "$NEXT_VERSION"
