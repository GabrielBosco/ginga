#!/usr/bin/env sh
set -eu

ROOT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
ENV_FILE="$ROOT_DIR/.env"
MODE="local"
APP_DOMAIN=""
LIVEKIT_DOMAIN=""

usage() {
  cat <<'HELP'
Uso:
  ./scripts/init.sh
  ./scripts/init.sh --production chat.example.com media.example.com

O script cria .env com segredos aleatorios. Ele nunca sobrescreve um .env existente.
HELP
}

if [ "${1:-}" = "--production" ]; then
  MODE="production"
  APP_DOMAIN=${2:-}
  LIVEKIT_DOMAIN=${3:-}
  if [ -z "$APP_DOMAIN" ] || [ -z "$LIVEKIT_DOMAIN" ]; then
    usage >&2
    exit 1
  fi
elif [ $# -gt 0 ]; then
  usage >&2
  exit 1
fi

if ! command -v openssl >/dev/null 2>&1; then
  echo "openssl nao encontrado. Instale openssl e rode novamente." >&2
  exit 1
fi

if [ -e "$ENV_FILE" ]; then
  echo ".env ja existe; nenhum valor foi sobrescrito."
  exit 0
fi

if [ "$MODE" = "production" ]; then
  cp "$ROOT_DIR/.env.production.example" "$ENV_FILE"
else
  cp "$ROOT_DIR/.env.example" "$ENV_FILE"
fi

random_hex() {
  openssl rand -hex "$1"
}

replace_value() {
  key=$1
  value=$2
  tmp="$ENV_FILE.tmp"
  awk -v key="$key" -v value="$value" 'BEGIN { FS=OFS="=" } $1==key {$0=key "=" value} {print}' "$ENV_FILE" > "$tmp"
  mv "$tmp" "$ENV_FILE"
}

replace_value POSTGRES_PASSWORD "$(random_hex 24)"
replace_value REDIS_PASSWORD "$(random_hex 24)"
replace_value JWT_SECRET "$(random_hex 48)"
replace_value MFA_ENCRYPTION_KEY "$(random_hex 32)"
replace_value LIVEKIT_API_KEY "lk_$(random_hex 8)"
replace_value LIVEKIT_API_SECRET "$(random_hex 32)"

if [ "$MODE" = "production" ]; then
  replace_value APP_DOMAIN "$APP_DOMAIN"
  replace_value LIVEKIT_DOMAIN "$LIVEKIT_DOMAIN"
  replace_value APP_ORIGINS "https://$APP_DOMAIN"
  replace_value GINGA_SERVER_URL "https://$APP_DOMAIN"
  replace_value PASSWORD_RESET_BASE_URL "https://$APP_DOMAIN"
  replace_value PUBLIC_LIVEKIT_URL "wss://$LIVEKIT_DOMAIN"
  replace_value LIVEKIT_USE_EXTERNAL_IP "true"
  replace_value LIVEKIT_NODE_IP ""
  replace_value LIVEKIT_TURN_ENABLED "true"
fi

chmod 600 "$ENV_FILE"

echo ""
echo "Ginga .env criado com sucesso."
if [ "$MODE" = "production" ]; then
  echo "Web:      https://$APP_DOMAIN"
  echo "LiveKit:  wss://$LIVEKIT_DOMAIN"
  echo "Suba com: docker compose -f docker-compose.production.yml up -d --build"
else
  echo "Web:      http://localhost"
  echo "LiveKit:  ws://localhost:7880"
  echo "Suba com: docker compose up -d --build"
fi
