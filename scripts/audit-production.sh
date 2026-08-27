#!/usr/bin/env sh
set -eu

ROOT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$ROOT_DIR"

PASS=0
WARN=0
FAIL=0
pass() { PASS=$((PASS+1)); printf '[OK]   %s\n' "$*"; }
warn() { WARN=$((WARN+1)); printf '[WARN] %s\n' "$*"; }
fail() { FAIL=$((FAIL+1)); printf '[FAIL] %s\n' "$*"; }

COMPOSE_FILE=${GINGA_COMPOSE_FILE:-docker-compose.production.yml}

if [ ! -f .env ]; then
  fail ".env nao encontrado"
  exit 2
fi

set -a
# shellcheck disable=SC1091
. ./.env
set +a

printf 'Ginga - auditoria de producao\n'
printf 'Compose: %s\n\n' "$COMPOSE_FILE"

for cmd in docker curl; do
  if command -v "$cmd" >/dev/null 2>&1; then pass "$cmd disponivel"; else fail "$cmd nao encontrado"; fi
done

if docker compose version >/dev/null 2>&1; then pass "docker compose disponivel"; else fail "docker compose indisponivel"; fi

RUNNING=$(docker compose -f "$COMPOSE_FILE" ps --status running --services 2>/dev/null || true)
for svc in postgres redis api web livekit; do
  if printf '%s\n' "$RUNNING" | grep -qx "$svc"; then pass "container $svc rodando"; else fail "container $svc nao esta rodando"; fi
done

if printf '%s\n' "$RUNNING" | grep -qx edge; then
  pass "edge HTTPS rodando"
else
  warn "servico edge nao encontrado; confirme se este host esta em modo production"
fi

EXPECTED_VERSION=${GINGA_RELEASE_VERSION:-}
PUBLIC_URL=${GINGA_SERVER_URL:-}
HEALTH=''
if [ -n "$PUBLIC_URL" ]; then
  HEALTH=$(curl -fsS --max-time 8 "$PUBLIC_URL/api/health" 2>/dev/null || true)
  if printf '%s' "$HEALTH" | grep -q '"status":"ok"'; then
    pass "API publica saudavel em $PUBLIC_URL"
  else
    fail "API publica nao respondeu corretamente em $PUBLIC_URL"
  fi
else
  warn "GINGA_SERVER_URL vazio; health publico ignorado"
fi

if [ -n "$EXPECTED_VERSION" ] && printf '%s' "$HEALTH" | grep -q "\"version\":\"$EXPECTED_VERSION\""; then
  pass "API anuncia a versao $EXPECTED_VERSION"
elif [ -n "$EXPECTED_VERSION" ]; then
  warn "API nao anunciou GINGA_RELEASE_VERSION=$EXPECTED_VERSION"
else
  warn "GINGA_RELEASE_VERSION nao definido"
fi

ENV_MODE=$(stat -c '%a' .env 2>/dev/null || stat -f '%Lp' .env 2>/dev/null || echo '?')
case "$ENV_MODE" in 600|400) pass ".env protegido (modo $ENV_MODE)";; *) warn ".env esta com modo $ENV_MODE; recomendado 600";; esac

if printf '%s' "${MFA_ENCRYPTION_KEY:-}" | grep -Eq '^[0-9a-fA-F]{64}$'; then
  pass "chave de criptografia 2FA valida"
else
  warn "MFA_ENCRYPTION_KEY ausente/invalida"
fi

if [ "${PWNED_PASSWORD_CHECK:-true}" = "true" ]; then pass "Pwned Passwords habilitado"; else warn "Pwned Passwords desabilitado"; fi
if [ "${EMAIL_VERIFICATION_REQUIRED:-false}" = "true" ]; then pass "verificacao de e-mail obrigatoria"; else warn "verificacao de e-mail desabilitada"; fi

PORTS=$(docker ps --format '{{.Names}} {{.Ports}}' 2>/dev/null || true)
if printf '%s\n' "$PORTS" | grep -Eq '0\.0\.0\.0:5432|:::5432|0\.0\.0\.0:6379|:::6379'; then
  fail "PostgreSQL ou Redis esta publicado externamente"
else
  pass "PostgreSQL/Redis nao estao publicados externamente"
fi

if printf '%s\n' "$PORTS" | grep -Eq '0\.0\.0\.0:7880|:::7880'; then
  warn "LiveKit 7880 esta publico; em production ele deve ficar atras do endpoint WSS"
else
  pass "LiveKit 7880 nao esta publicado diretamente"
fi

if command -v ss >/dev/null 2>&1; then
  if ss -lnt 2>/dev/null | grep -q ':443'; then pass "443/TCP ouvindo"; else warn "443/TCP nao encontrado"; fi
  if ss -lnt 2>/dev/null | grep -q ':7881'; then pass "7881/TCP ouvindo"; else warn "7881/TCP nao encontrado"; fi
  if ss -lnu 2>/dev/null | grep -q ':7882'; then pass "7882/UDP ouvindo"; else warn "7882/UDP nao encontrado"; fi
fi

UPLOAD_VOLUME=$(docker volume ls \
  --filter label=com.docker.compose.project=ginga \
  --filter label=com.docker.compose.volume=uploads_data \
  --format '{{.Name}}' 2>/dev/null | head -n 1 || true)
if [ -n "$UPLOAD_VOLUME" ]; then pass "volume de uploads encontrado: $UPLOAD_VOLUME"; else warn "volume uploads_data nao encontrado"; fi

if [ -n "$PUBLIC_URL" ]; then
  MANIFEST=$(curl -fsS --max-time 8 -H 'Cache-Control: no-cache' "$PUBLIC_URL/updates/windows/manifest.json?_audit=$(date +%s)" 2>/dev/null || true)
  if [ -n "$MANIFEST" ]; then
    pass "manifest Windows publicado"
    if [ -n "$EXPECTED_VERSION" ] && printf '%s' "$MANIFEST" | grep -q "\"version\":\"$EXPECTED_VERSION\""; then
      pass "updater anuncia $EXPECTED_VERSION"
    elif [ -n "$EXPECTED_VERSION" ]; then
      warn "updater e servidor anunciam versoes diferentes"
    fi
  else
    warn "manifest Windows nao publicado"
  fi
fi

printf '\nResumo: %s OK | %s avisos | %s falhas\n' "$PASS" "$WARN" "$FAIL"
[ "$FAIL" -eq 0 ] || exit 1
