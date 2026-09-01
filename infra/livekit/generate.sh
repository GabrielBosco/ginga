#!/bin/sh
set -eu

for key in LIVEKIT_API_KEY LIVEKIT_API_SECRET REDIS_PASSWORD; do
  eval "value=\${$key:-}"
  if [ -z "$value" ]; then
    echo "Variavel obrigatoria ausente: $key" >&2
    exit 1
  fi
done

use_external_ip="${LIVEKIT_USE_EXTERNAL_IP:-true}"
turn_enabled="${LIVEKIT_TURN_ENABLED:-true}"
turn_udp_port="${LIVEKIT_TURN_UDP_PORT:-3478}"
log_level="${LIVEKIT_LOG_LEVEL:-warn}"

case "$use_external_ip" in true|false) ;; *) echo "LIVEKIT_USE_EXTERNAL_IP deve ser true ou false" >&2; exit 1 ;; esac
case "$turn_enabled" in true|false) ;; *) echo "LIVEKIT_TURN_ENABLED deve ser true ou false" >&2; exit 1 ;; esac
case "$turn_udp_port" in ''|*[!0-9]*) echo "LIVEKIT_TURN_UDP_PORT invalida" >&2; exit 1 ;; esac
case "$log_level" in debug|info|warn|error) ;; *) echo "LIVEKIT_LOG_LEVEL deve ser debug, info, warn ou error" >&2; exit 1 ;; esac

node_ip_line=""
if [ "$use_external_ip" = "false" ]; then
  if [ -z "${LIVEKIT_NODE_IP:-}" ]; then
    echo "LIVEKIT_NODE_IP e obrigatorio quando LIVEKIT_USE_EXTERNAL_IP=false" >&2
    exit 1
  fi
  node_ip_line="  node_ip: ${LIVEKIT_NODE_IP}"
fi

redis_password_line=""
if [ -n "${REDIS_PASSWORD:-}" ]; then
  escaped_redis_password=$(printf '%s' "$REDIS_PASSWORD" | sed 's/\\/\\\\/g; s/"/\\"/g')
  redis_password_line="  password: \"${escaped_redis_password}\""
fi

cat > /out/livekit.yaml <<EOF_INNER
port: 7880
redis:
  address: redis:6379
${redis_password_line}
rtc:
  tcp_port: 7881
  udp_port: 7882
  use_external_ip: ${use_external_ip}
${node_ip_line}
turn:
  enabled: ${turn_enabled}
  udp_port: ${turn_udp_port}
keys:
  ${LIVEKIT_API_KEY}: ${LIVEKIT_API_SECRET}
room:
  auto_create: true
  empty_timeout: 300
  departure_timeout: 20
logging:
  level: ${log_level}
EOF_INNER

chmod 600 /out/livekit.yaml
