#!/usr/bin/env sh
set -eu
BASE_URL=${1:-http://localhost}
printf 'Health: '
curl -fsS "$BASE_URL/api/health"
printf '\n'
