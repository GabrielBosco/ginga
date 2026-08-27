#!/usr/bin/env bash
set -Eeuo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
RUN_BUILD=0
[[ "${1:-}" == "--build" ]] && RUN_BUILD=1

ok() { printf '[OK] %s\n' "$*"; }
fail() { printf '[FAIL] %s\n' "$*" >&2; exit 1; }
warn() { printf '[WARN] %s\n' "$*" >&2; }

tracked_files() {
  if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    git ls-files -z
  else
    find . -type f \
      ! -path './.git/*' \
      ! -path './node_modules/*' \
      ! -path './apps/desktop/node_modules/*' \
      -print0
  fi
}

TMP_LIST=$(mktemp)
trap 'rm -f "$TMP_LIST"' EXIT
tracked_files > "$TMP_LIST"

# Files that must never be published.
while IFS= read -r -d '' file; do
  clean=${file#./}
  case "$clean" in
    .env|*/.env|secrets/*|*/secrets/*|*private.pem|*.key|*.p12|*.pfx)
      fail "arquivo sensivel encontrado no conjunto publicado: $clean"
      ;;
    */node_modules/*|node_modules/*|*/dist/*|dist/*)
      fail "artefato gerado/dependencia vendorizada encontrada: $clean"
      ;;
  esac
done < "$TMP_LIST"

ok "nenhum .env, chave privada, node_modules ou dist publicado"

# Known private deployment markers and obsolete public web port.
OLD_PORT='30'
OLD_PORT="${OLD_PORT}90"
PATTERN="ginga\\.opik\\.net|ginga\\.serveirc\\.com|100\\.64\\.[0-9]+\\.[0-9]+|:${OLD_PORT}|WEB_PORT=${OLD_PORT}|localhost:${OLD_PORT}|127\\.0\\.0\\.1:${OLD_PORT}"
MATCHES=$(xargs -0 grep -nEI -- "$PATTERN" < "$TMP_LIST" 2>/dev/null || true)
if [[ -n "$MATCHES" ]]; then
  printf '%s\n' "$MATCHES" >&2
  fail "endpoint privado ou porta web legada encontrada"
fi
ok "nenhum endpoint privado/porta web legada encontrado"

# Obvious credential assignments. Placeholders and empty values are allowed.
SECRET_MATCHES=$(xargs -0 grep -nEI -- '(SMTP_PASSWORD|POSTGRES_PASSWORD|REDIS_PASSWORD|JWT_SECRET|LIVEKIT_API_SECRET)[[:space:]]*=[[:space:]]*[^[:space:]#]+' < "$TMP_LIST" 2>/dev/null \
  | grep -Ev 'CHANGE_ME|troque|example\.com|senha-de|=senha$|process\.env|\$\{|os\.getenv' || true)
if [[ -n "$SECRET_MATCHES" ]]; then
  printf '%s\n' "$SECRET_MATCHES" >&2
  fail "possivel segredo hardcoded encontrado"
fi
ok "nenhum segredo obvio hardcoded encontrado"

API_VERSION=$(node -p "require('./apps/api/package.json').version")
WEB_VERSION=$(node -p "require('./apps/web/package.json').version")
DESKTOP_VERSION=$(node -p "require('./apps/desktop/package.json').version")
[[ "$API_VERSION" == "$WEB_VERSION" && "$WEB_VERSION" == "$DESKTOP_VERSION" ]] \
  || fail "versoes divergentes: api=$API_VERSION web=$WEB_VERSION desktop=$DESKTOP_VERSION"
ok "versoes sincronizadas em $API_VERSION"

for f in apps/desktop/src/*.cjs scripts/*.cjs; do
  [[ -f "$f" ]] || continue
  node --check "$f" >/dev/null
 done
ok "JavaScript/CJS passou no parser"

for f in scripts/*.sh build-win.sh release-win.sh; do
  [[ -f "$f" ]] || continue
  bash -n "$f"
done
ok "scripts shell passaram no parser"

if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
  docker compose --env-file .env.example -f docker-compose.yml config >/dev/null
  docker compose --env-file .env.production.example -f docker-compose.production.yml config >/dev/null
  ok "Docker Compose local e production validos"
else
  warn "Docker Compose nao encontrado; validacao dos compose files foi ignorada"
fi

if (( RUN_BUILD == 1 )); then
  command -v docker >/dev/null 2>&1 || fail "--build requer Docker"
  docker build -q -t ginga-preflight-api ./apps/api >/dev/null
  docker build -q -t ginga-preflight-web ./apps/web >/dev/null
  ok "imagens API e Web compiladas"
fi

printf '\nRepositorio pronto para publicacao.\n'
