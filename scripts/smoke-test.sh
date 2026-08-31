#!/usr/bin/env sh
set -eu
BASE_URL=${1:-http://localhost:3090}

echo "Testando $BASE_URL/api/health"
curl -fsS "$BASE_URL/api/health"
echo
echo "API respondendo corretamente."
