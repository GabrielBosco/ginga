#!/usr/bin/env bash
set -Eeuo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VERSION="${1:-}"
MODE="${2:---x64}"
SERVER_ROOT="${GINGA_SERVER_ROOT:-/opt/ginga}"
DESKTOP="$ROOT/apps/desktop"
OUT="$DESKTOP/dist"

fail(){ echo "[ERRO] $*" >&2; exit 1; }
[[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+([.-][0-9A-Za-z.-]+)?$ ]] || fail "Uso: $0 <versao> [--x64|--arm64|--all]"
case "$MODE" in --x64|--arm64|--all) ;; *) fail "Modo invalido: $MODE";; esac
command -v docker >/dev/null || fail "Docker nao encontrado"
command -v python3 >/dev/null || fail "python3 nao encontrado"

current="$(python3 - "$DESKTOP/package.json" <<'PY'
import json,sys
print(json.load(open(sys.argv[1]))['version'])
PY
)"
[[ "$current" == "$VERSION" ]] || fail "Desktop esta em $current, esperado $VERSION. Aplique o source correto antes do release."

rm -rf "$OUT"
mkdir -p "$OUT"

first_existing(){
  local candidate
  for candidate in "$@"; do
    [[ -f "$candidate" ]] && { printf '%s\n' "$candidate"; return 0; }
  done
  return 1
}

publish_x64(){
  local dest="$1"
  local appimage deb rpm
  appimage="$(first_existing "$OUT/Ginga-${VERSION}-linux-x86_64.AppImage" "$OUT/Ginga-${VERSION}-linux-x64.AppImage")" || fail "AppImage x64 nao encontrado em $OUT"
  deb="$(first_existing "$OUT/Ginga-${VERSION}-linux-amd64.deb" "$OUT/Ginga-${VERSION}-linux-x64.deb")" || fail "DEB x64 nao encontrado em $OUT"
  rpm="$(first_existing "$OUT/Ginga-${VERSION}-linux-x86_64.rpm" "$OUT/Ginga-${VERSION}-linux-x64.rpm")" || fail "RPM x64 nao encontrado em $OUT"
  cp -f "$appimage" "$dest/Ginga-${VERSION}-linux-x64.AppImage"
  cp -f "$deb" "$dest/Ginga-${VERSION}-linux-x64.deb"
  cp -f "$rpm" "$dest/Ginga-${VERSION}-linux-x64.rpm"
}

publish_arm64(){
  local dest="$1"
  local appimage deb
  appimage="$(first_existing "$OUT/Ginga-${VERSION}-linux-arm64.AppImage" "$OUT/Ginga-${VERSION}-linux-aarch64.AppImage")" || fail "AppImage ARM64 nao encontrado em $OUT"
  deb="$(first_existing "$OUT/Ginga-${VERSION}-linux-arm64.deb" "$OUT/Ginga-${VERSION}-linux-aarch64.deb")" || fail "DEB ARM64 nao encontrado em $OUT"
  cp -f "$appimage" "$dest/Ginga-${VERSION}-linux-arm64.AppImage"
  cp -f "$deb" "$dest/Ginga-${VERSION}-linux-arm64.deb"
}

build_arch(){
  local arch="$1"
  "$ROOT/build-linux.sh" "$arch"
  local dest="$SERVER_ROOT/updates/linux/$arch"
  mkdir -p "$dest"
  rm -f "$dest"/Ginga-* "$dest"/manifest.json "$dest"/SHA256SUMS.txt

  if [[ "$arch" == "x64" ]]; then publish_x64 "$dest"; else publish_arm64 "$dest"; fi

  python3 - "$dest" "$VERSION" "$arch" <<'PY'
import hashlib,json,sys
from pathlib import Path
root=Path(sys.argv[1]); version=sys.argv[2]; arch=sys.argv[3]
files=[]
for path in sorted(root.glob(f'Ginga-{version}-linux-*')):
    if not path.is_file(): continue
    ext='AppImage' if path.name.endswith('.AppImage') else path.suffix.lstrip('.')
    kind={'AppImage':'appimage','deb':'deb','rpm':'rpm'}.get(ext, ext.lower())
    h=hashlib.sha256(path.read_bytes()).hexdigest()
    files.append({'file':path.name,'type':kind,'size':path.stat().st_size,'sha256':h,'href':f'/updates/linux/{arch}/{path.name}'})
if not files:
    raise SystemExit(f'nenhum artefato Linux {arch} encontrado')
priority=['appimage','deb','rpm']
primary=next((f for t in priority for f in files if f['type']==t),files[0])
manifest={'schema':1,'product':'Ginga','platform':f'linux-{arch}','version':version,'primary':primary['file'],'files':files}
(root/'manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n')
(root/'SHA256SUMS.txt').write_text(''.join(f"{f['sha256']}  {f['file']}\n" for f in files))
print(json.dumps(manifest,ensure_ascii=False,indent=2))
PY
  chmod 0644 "$dest"/manifest.json "$dest"/SHA256SUMS.txt "$dest"/*.deb "$dest"/*.rpm 2>/dev/null || true
  chmod 0755 "$dest"/*.AppImage 2>/dev/null || true
}

case "$MODE" in
  --x64) build_arch x64 ;;
  --arm64) build_arch arm64 ;;
  --all) build_arch x64; rm -rf "$OUT"; mkdir -p "$OUT"; build_arch arm64 ;;
esac

echo "============================================================"
echo " GINGA $VERSION LINUX PUBLICADO"
echo "============================================================"
find "$SERVER_ROOT/updates/linux" -maxdepth 2 -type f -printf '%p\n' | sort
