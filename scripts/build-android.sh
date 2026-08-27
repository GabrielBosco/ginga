#!/usr/bin/env bash
set -Eeuo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SERVER_URL="${1:-${GINGA_SERVER_URL:-}}"

if [[ -z "$SERVER_URL" || "$SERVER_URL" != https://* ]]; then
  echo "Uso: ./scripts/build-android.sh https://seu-dominio" >&2
  echo "O Android exige HTTPS nesta configuracao." >&2
  exit 1
fi

command -v gradle >/dev/null 2>&1 || {
  echo "Gradle nao encontrado. Use Android Studio ou o workflow Gerar APK Android do GitHub Actions." >&2
  exit 1
}

cd "$ROOT/apps/android"
gradle --no-daemon clean assembleDebug -PGINGA_SERVER_URL="$SERVER_URL"

mkdir -p "$ROOT/dist/android"
cp -f app/build/outputs/apk/debug/app-debug.apk "$ROOT/dist/android/Ginga-0.2.0-debug.apk"

echo
echo "APK gerado:"
echo "$ROOT/dist/android/Ginga-0.2.0-debug.apk"
