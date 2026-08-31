#!/usr/bin/env bash
set -Eeuo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VERSION="${1:-}"
LINUX_MODE="${2:---all}"

fail(){ echo "[ERRO] $*" >&2; exit 1; }
[[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+([.-][0-9A-Za-z]+([.-][0-9A-Za-z]+)*)?$ ]] || fail "Uso: $0 <versao> [--x64|--arm64|--all]"
case "$LINUX_MODE" in --x64|--arm64|--all) ;; *) fail "Modo Linux invalido: $LINUX_MODE" ;; esac

printf '\n[Ginga Release All] Validando Windows + Linux %s\n' "$VERSION"
"$ROOT/scripts/pre-release-check.sh" "$VERSION" --all

printf '\n[Ginga Release All] Publicando Windows %s\n' "$VERSION"
"$ROOT/release-win.sh" "$VERSION"

printf '\n[Ginga Release All] Publicando Linux %s (%s)\n' "$VERSION" "$LINUX_MODE"
"$ROOT/release-linux.sh" "$VERSION" "$LINUX_MODE"

printf '\n============================================================\n'
printf ' GINGA %s - WINDOWS + LINUX CONCLUIDOS\n' "$VERSION"
printf '============================================================\n'
