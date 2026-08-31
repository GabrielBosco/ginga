#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

echo "Ocorrencias editoriais do nome atual fora dos arquivos de branding:"
grep -RIn --exclude-dir=node_modules --exclude-dir=.git --exclude='*.map' --exclude='BRANDING.md' --exclude='brand.ts' --exclude='brand.json' -E '\bGinga\b|ginga-mark|ginga-wordmark|favicon\.svg' apps/web 2>/dev/null || true
