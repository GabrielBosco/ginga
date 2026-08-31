#!/usr/bin/env sh
set -eu

ROOT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
ENV_FILE="$ROOT_DIR/.env"
EXAMPLE_FILE="$ROOT_DIR/.env.example"

if ! command -v openssl >/dev/null 2>&1; then
  echo "openssl nao encontrado. Instale o pacote openssl e rode novamente." >&2
  exit 1
fi

if [ -e "$ENV_FILE" ]; then
  echo ".env ja existe; nenhum segredo foi sobrescrito."
  exit 0
fi

cp "$EXAMPLE_FILE" "$ENV_FILE"

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

NODE_IP="127.0.0.1"

replace_value POSTGRES_PASSWORD "$(random_hex 24)"
replace_value REDIS_PASSWORD "$(random_hex 24)"
replace_value JWT_SECRET "$(random_hex 48)"
replace_value MFA_ENCRYPTION_KEY "$(random_hex 32)"
replace_value LIVEKIT_API_KEY "lk_$(random_hex 8)"
replace_value LIVEKIT_API_SECRET "$(random_hex 32)"
replace_value LIVEKIT_NODE_IP "$NODE_IP"
replace_value LIVEKIT_USE_EXTERNAL_IP "false"
replace_value LIVEKIT_TURN_ENABLED "false"

chmod 600 "$ENV_FILE"

echo "Arquivo .env criado com segredos aleatorios."
echo "LiveKit local configurado em: $NODE_IP"
echo "Para teste no proprio servidor: docker compose up -d --build"
echo "Para acesso pela LAN, ajuste WEB_BIND/APP_ORIGINS no .env e revise o perfil lan antes de publicar portas."
