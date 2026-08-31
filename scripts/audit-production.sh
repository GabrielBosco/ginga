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

if [ ! -f .env ]; then
  fail ".env nao encontrado em $ROOT_DIR"
  exit 2
fi
set -a
# shellcheck disable=SC1091
. ./.env
set +a

printf 'Ginga - auditoria de producao\n'
printf 'Raiz: %s\n\n' "$ROOT_DIR"

for cmd in docker curl; do
  if command -v "$cmd" >/dev/null 2>&1; then pass "$cmd disponivel"; else fail "$cmd nao encontrado"; fi
done

if docker compose version >/dev/null 2>&1; then pass "docker compose disponivel"; else fail "docker compose indisponivel"; fi

RUNNING=$(docker compose ps --status running --services 2>/dev/null || true)
for svc in postgres redis api web livekit; do
  if printf '%s\n' "$RUNNING" | grep -qx "$svc"; then pass "container $svc rodando"; else fail "container $svc nao esta rodando"; fi
done

WEB_PORT=${WEB_PORT:-3090}
HEALTH=$(curl -fsS --max-time 5 "http://127.0.0.1:${WEB_PORT}/api/health" 2>/dev/null || true)
if printf '%s' "$HEALTH" | grep -q '"status":"ok"'; then
  pass "API local saudavel em 127.0.0.1:${WEB_PORT}"
else
  fail "API local nao respondeu corretamente em 127.0.0.1:${WEB_PORT}"
fi

EXPECTED_VERSION=${GINGA_RELEASE_VERSION:-}
if [ -n "$EXPECTED_VERSION" ] && printf '%s' "$HEALTH" | grep -q "\"version\":\"$EXPECTED_VERSION\""; then
  pass "API anuncia a versao $EXPECTED_VERSION"
elif [ -n "$EXPECTED_VERSION" ]; then
  warn "API nao anunciou GINGA_RELEASE_VERSION=$EXPECTED_VERSION (health=$HEALTH)"
else
  warn "GINGA_RELEASE_VERSION nao esta definido"
fi

ENV_MODE=$(stat -c '%a' .env 2>/dev/null || stat -f '%Lp' .env 2>/dev/null || echo '?')
case "$ENV_MODE" in 600|400) pass ".env protegido (modo $ENV_MODE)";; *) warn ".env esta com modo $ENV_MODE; recomendado 600";; esac

if printf '%s' "${MFA_ENCRYPTION_KEY:-}" | grep -Eq '^[0-9a-fA-F]{64}$'; then
  pass "chave de criptografia 2FA configurada"
else
  warn "MFA_ENCRYPTION_KEY ausente/invalida; 2FA ficara indisponivel"
fi

if [ "${EMAIL_VERIFICATION_REQUIRED:-false}" = "true" ]; then pass "verificacao de e-mail obrigatoria"; else warn "verificacao de e-mail nao esta obrigatoria"; fi
if [ "${PWNED_PASSWORD_CHECK:-true}" = "true" ]; then pass "Pwned Passwords habilitado"; else warn "Pwned Passwords desabilitado"; fi

PORTS=$(docker ps --format '{{.Names}} {{.Ports}}' 2>/dev/null || true)
if printf '%s\n' "$PORTS" | grep -Eq '0\.0\.0\.0:5432|:::5432|0\.0\.0\.0:6379|:::6379'; then
  fail "PostgreSQL ou Redis esta publicado para a rede"
else
  pass "PostgreSQL/Redis nao aparecem publicados em 0.0.0.0"
fi

if command -v ss >/dev/null 2>&1; then
  if ss -lnt 2>/dev/null | grep -q "127.0.0.1:${WEB_PORT}"; then pass "Web interna vinculada a localhost"; else warn "nao confirmei bind localhost da Web"; fi
  if ss -lnt 2>/dev/null | grep -q ':7881'; then pass "LiveKit RTC TCP 7881 ouvindo"; else warn "porta LiveKit TCP 7881 nao encontrada"; fi
  if ss -lnu 2>/dev/null | grep -q ':7882'; then pass "LiveKit RTC UDP 7882 ouvindo"; else warn "porta LiveKit UDP 7882 nao encontrada"; fi
fi

UPLOAD_VOLUME=$(docker volume ls \
  --filter label=com.docker.compose.project=ginga \
  --filter label=com.docker.compose.volume=uploads_data \
  --format '{{.Name}}' 2>/dev/null | head -n 1 || true)
if [ -n "$UPLOAD_VOLUME" ]; then pass "volume de uploads encontrado: $UPLOAD_VOLUME"; else warn "volume uploads_data do projeto ginga nao foi encontrado"; fi

PUBLIC_URL=${GINGA_SERVER_URL:-}
CURL_RESOLVE=''
if [ -n "${GINGA_AUDIT_RESOLVE:-}" ]; then
  CURL_RESOLVE="--resolve ${GINGA_AUDIT_RESOLVE}"
fi
if [ -n "$PUBLIC_URL" ]; then
  # GINGA_AUDIT_RESOLVE pode ser usado quando o host precisa testar o dominio publico contra um IP especifico.
  # shellcheck disable=SC2086
  PUBLIC_HEALTH=$(curl -fsS --max-time 8 $CURL_RESOLVE "$PUBLIC_URL/api/health" 2>/dev/null || true)
  if printf '%s' "$PUBLIC_HEALTH" | grep -q '"status":"ok"'; then pass "URL publica/proxy responde em $PUBLIC_URL"; else warn "nao consegui validar $PUBLIC_URL a partir deste host"; fi

  # shellcheck disable=SC2086
  MANIFEST=$(curl -fsS --max-time 8 $CURL_RESOLVE -H 'Cache-Control: no-cache' "$PUBLIC_URL/updates/windows/manifest.json?_audit=$(date +%s)" 2>/dev/null || true)
  if [ -n "$MANIFEST" ]; then
    pass "manifest.json de Windows publicado"
    if [ -n "$EXPECTED_VERSION" ] && printf '%s' "$MANIFEST" | grep -q "\"version\":\"$EXPECTED_VERSION\""; then
      pass "site anuncia a versao Windows $EXPECTED_VERSION"
    elif [ -n "$EXPECTED_VERSION" ]; then
      warn "site e servidor estao em versoes diferentes (servidor=$EXPECTED_VERSION)"
    fi
  else
    warn "manifest.json do Windows nao esta disponivel; site nao tera release para anunciar"
  fi
else
  warn "GINGA_SERVER_URL vazio; auditoria publica ignorada"
fi

printf '\nResumo: %s OK | %s avisos | %s falhas\n' "$PASS" "$WARN" "$FAIL"
[ "$FAIL" -eq 0 ] || exit 1
