#!/usr/bin/env bash
set -Eeuo pipefail

# Ginga 0.4.7+ - Gate de pre-release.
# Nao publica nada e nao reinicia containers. Faz build de API/Web e valida
# o Desktop/updater antes de liberar a execucao do release-win.sh.

VERSION="${1:-}"
MODE="${2:---all}"
SERVER_ROOT="${GINGA_SERVER_ROOT:-/opt/ginga}"
BUILD_ROOT="${GINGA_BUILD_ROOT:-/opt/ginga-build}"
NODE_IMAGE="${GINGA_NODE_IMAGE:-node:22-alpine}"
PUBLIC_URL="${GINGA_PUBLIC_URL:-}"
LOCK_FILE="/tmp/ginga-pre-release.lock"

log(){ printf '\n\033[1;36m[Ginga Pre-Release]\033[0m %s\n' "$*"; }
ok(){ printf '\033[1;32m[OK]\033[0m %s\n' "$*"; }
warn(){ printf '\033[1;33m[WARN]\033[0m %s\n' "$*" >&2; }
die(){ printf '\033[1;31m[ERRO]\033[0m %s\n' "$*" >&2; exit 1; }

[[ -n "$VERSION" ]] || die "Informe a versao. Exemplo: ./scripts/pre-release-check.sh 0.4.7 [--all|--windows|--linux]"
[[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+([.-][0-9A-Za-z]+([.-][0-9A-Za-z]+)*)?$ ]] || die "Versao SemVer invalida: $VERSION"
case "$MODE" in --all|--windows|--linux) ;; *) die "Modo invalido: $MODE. Use --all, --windows ou --linux" ;; esac

for cmd in docker curl python3 flock sha256sum; do
  command -v "$cmd" >/dev/null 2>&1 || die "Comando obrigatorio ausente: $cmd"
done
docker compose version >/dev/null 2>&1 || die "docker compose nao esta disponivel"

exec 9>"$LOCK_FILE"
flock -n 9 || die "Ja existe outra verificacao de pre-release em execucao."

[[ -d "$SERVER_ROOT" && -f "$SERVER_ROOT/docker-compose.yml" ]] || die "Servidor Ginga invalido: $SERVER_ROOT"
[[ -f "$SERVER_ROOT/.env" ]] || die ".env ativo ausente: $SERVER_ROOT/.env"
[[ -d "$BUILD_ROOT/apps/desktop" ]] || die "Build root invalido: $BUILD_ROOT"
[[ -s "$BUILD_ROOT/secrets/update-signing/private.pem" ]] || die "private.pem do updater ausente. Restaure a chave original antes de continuar."
[[ -f "$BUILD_ROOT/scripts/update-signing.cjs" ]] || die "update-signing.cjs ausente no build root"
[[ -x "$BUILD_ROOT/build-linux.sh" ]] || die "build-linux.sh ausente ou sem permissao de execucao"
[[ -x "$BUILD_ROOT/release-linux.sh" ]] || die "release-linux.sh ausente ou sem permissao de execucao"

if [[ -z "$PUBLIC_URL" ]]; then
  PUBLIC_URL="$(awk -F= '/^GINGA_SERVER_URL=/{sub(/^[^=]*=/,""); gsub(/^[\047\"]|[\047\"]$/,""); print; exit}' "$SERVER_ROOT/.env")"
fi
[[ -n "$PUBLIC_URL" ]] || die "GINGA_PUBLIC_URL/GINGA_SERVER_URL nao definido"

log "1/7 - Conferindo versoes e arquivos obrigatorios"
python3 - "$VERSION" \
  "$SERVER_ROOT/package.json" \
  "$SERVER_ROOT/apps/api/package.json" \
  "$SERVER_ROOT/apps/web/package.json" \
  "$BUILD_ROOT/apps/desktop/package.json" <<'PY'
import json, pathlib, sys
expected=sys.argv[1]
for raw in sys.argv[2:]:
    p=pathlib.Path(raw)
    if not p.is_file():
        raise SystemExit(f"Arquivo ausente: {p}")
    value=str(json.loads(p.read_text(encoding='utf-8')).get('version',''))
    if value != expected:
        raise SystemExit(f"Versao inconsistente em {p}: {value!r}; esperado {expected!r}")
    print(f"{p}: {value}")
PY
ok "Root/API/Web/Desktop estao em $VERSION"

# Evita gastar meia hora buildando uma release Windows que o updater nao podera ofertar.
# Linux tem feed separado e, nesta RC, nao usa electron-updater automatico.
if [[ "$MODE" != "--linux" ]]; then
python3 - "$SERVER_ROOT/updates/windows/manifest.json" "$VERSION" <<'PY'
import json, pathlib, re, sys
manifest=pathlib.Path(sys.argv[1]); target=sys.argv[2]

def semver(value):
    m=re.fullmatch(r'(\d+)\.(\d+)\.(\d+)(?:-(.+))?', value or '')
    if not m: raise ValueError(value)
    core=tuple(map(int,m.group(1,2,3)))
    pre=m.group(4)
    if pre is None: return core, 1, ()
    parts=[]
    for token in re.split(r'[.-]',pre.lower()):
        for item in re.findall(r'\d+|[a-z]+|[^a-z\d]+',token):
            parts.append((0,int(item)) if item.isdigit() else (1,item))
    return core, 0, tuple(parts)

if manifest.is_file():
    try:
        current=str(json.loads(manifest.read_text(encoding='utf-8')).get('version',''))
        if current and semver(target) <= semver(current):
            raise SystemExit(f"Release recusada: feed Windows local ja publica {current}; alvo {target} precisa ser maior.")
        print(f"Feed Windows atual: {current or 'sem versao'} -> alvo: {target}")
    except json.JSONDecodeError as exc:
        raise SystemExit(f"manifest.json atual invalido: {exc}")
else:
    print("Feed Windows atual ausente; primeira publicacao detectada.")
PY
else
  ok "Modo Linux: guarda de monotonicidade do feed Windows ignorada (feeds independentes nesta RC)"
fi

FREE_KB="$(df -Pk "$BUILD_ROOT" | awk 'NR==2{print $4}')"
[[ "${FREE_KB:-0}" -ge 2097152 ]] || die "Espaco livre insuficiente no build root. Deixe pelo menos 2 GiB livres."
ok "Arquivos, versao e espaco em disco OK"

log "2/7 - Validando shell scripts e Docker Compose"
while IFS= read -r -d '' script; do bash -n "$script"; done < <(find "$SERVER_ROOT" -maxdepth 2 -type f -name '*.sh' -print0)
while IFS= read -r -d '' script; do bash -n "$script"; done < <(find "$BUILD_ROOT" -maxdepth 2 -type f -name '*.sh' -print0)
(cd "$SERVER_ROOT" && docker compose config -q)
ok "Shell e docker-compose validos"

log "3/7 - Validando Electron sem depender de Node no Debian"
docker run --rm \
  -v "$BUILD_ROOT:/project:ro" \
  "$NODE_IMAGE" sh -lc '
    node --check /project/apps/desktop/src/main.cjs &&
    node --check /project/apps/desktop/src/preload.cjs &&
    node --check /project/apps/desktop/src/brand.cjs &&
    node --check /project/scripts/update-signing.cjs
  '
ok "Electron/preload/signer passaram no node --check"

log "4/7 - Validando continuidade da chave do updater"
# ensure deriva a publica a partir da private.pem e compara a fingerprint fixada.
docker run --rm \
  -v "$BUILD_ROOT:/project" \
  "$NODE_IMAGE" node /project/scripts/update-signing.cjs ensure /project
ok "Chave Ed25519 e chave publica embutida coerentes"

log "5/7 - Build real da API e Web"
# Importante: builda imagens, mas NAO executa docker compose up. Produção continua intacta.
(cd "$SERVER_ROOT" && docker compose build api web)
ok "TypeScript/Vite/API compilaram"

log "6/7 - Sanidade visual/arquivos de release"
[[ -f "$SERVER_ROOT/apps/web/src/ui-release-v043.css" ]] || die "ui-release-v043.css ausente"
[[ -f "$SERVER_ROOT/apps/web/src/ui-rc9-v043.css" ]] || die "ui-rc9-v043.css ausente"
[[ -f "$SERVER_ROOT/apps/web/src/ui-v046.css" ]] || die "ui-v046.css ausente"
[[ -f "$SERVER_ROOT/apps/web/src/ui-v047.css" ]] || die "ui-v047.css ausente"
[[ -f "$SERVER_ROOT/apps/web/src/ui-v047-final.css" ]] || die "ui-v047-final.css ausente"
[[ -f "$SERVER_ROOT/apps/web/src/ui-v048-viewport-fit.css" ]] || die "ui-v048-viewport-fit.css ausente"
[[ -f "$SERVER_ROOT/apps/web/src/ui-v048-responsive-final.css" ]] || die "ui-v048-responsive-final.css ausente"
[[ -f "$SERVER_ROOT/apps/web/src/ui-packfix-20260901.css" ]] || die "ui-packfix-20260901.css ausente"
[[ -f "$SERVER_ROOT/apps/web/src/auth-v047.css" ]] || die "auth-v047.css ausente"
[[ -f "$SERVER_ROOT/apps/web/src/auth-v047-r2.css" ]] || die "auth-v047-r2.css ausente"
[[ -f "$SERVER_ROOT/apps/web/src/auth-v047-r3.css" ]] || die "auth-v047-r3.css ausente"
[[ -f "$SERVER_ROOT/apps/web/src/auth-v048-redesign.css" ]] || die "auth-v048-redesign.css ausente"
[[ -f "$SERVER_ROOT/apps/web/src/lib/unreadState.ts" ]] || die "Persistencia de nao lidas 0.4.7 ausente"
[[ -f "$SERVER_ROOT/apps/web/src/components/SoundboardPanel.tsx" ]] || die "SoundboardPanel.tsx ausente"
[[ -f "$SERVER_ROOT/apps/web/src/lib/soundboard.ts" ]] || die "lib/soundboard.ts ausente"
grep -Fq 'import "./ui-release-v043.css";' "$SERVER_ROOT/apps/web/src/main.tsx" || die "Camada final de CSS nao esta importada"
grep -Fq 'import "./ui-rc9-v043.css";' "$SERVER_ROOT/apps/web/src/main.tsx" || die "Camada RC9 de CSS nao esta importada"
grep -Fq 'import "./ui-v046.css";' "$SERVER_ROOT/apps/web/src/main.tsx" || die "Camada UI/UX 0.4.6 nao esta importada"
grep -Fq 'import "./ui-v047.css";' "$SERVER_ROOT/apps/web/src/main.tsx" || die "Camada 0.4.7 nao esta importada"
grep -Fq 'import "./ui-v047-final.css";' "$SERVER_ROOT/apps/web/src/main.tsx" || die "Camada final responsiva 0.4.7 nao esta importada"
grep -Fq 'import "./ui-v048-viewport-fit.css";' "$SERVER_ROOT/apps/web/src/main.tsx" || die "Hotfix de viewport 0.4.8 nao esta importado"
grep -Fq 'import "./ui-v048-responsive-final.css";' "$SERVER_ROOT/apps/web/src/main.tsx" || die "Camada responsiva global 0.4.8 nao esta importada"
grep -Fq 'import "./ui-packfix-20260901.css";' "$SERVER_ROOT/apps/web/src/main.tsx" || die "Packfix 2026-09-01 nao esta importado por ultimo"
grep -Fq 'compactNavigation' "$SERVER_ROOT/apps/web/src/components/SettingsShell.tsx" || die "SettingsShell perdeu navegacao mobile previsivel"
grep -Fq 'import "./auth-v047.css";' "$SERVER_ROOT/apps/web/src/main.tsx" || die "Camada de autenticacao 0.4.7 nao esta importada"
grep -Fq 'import "./auth-v047-r2.css";' "$SERVER_ROOT/apps/web/src/main.tsx" || die "Camada responsiva AUTH R2 nao esta importada"
grep -Fq 'import "./auth-v047-r3.css";' "$SERVER_ROOT/apps/web/src/main.tsx" || die "Camada dark/downloads AUTH R3 nao esta importada"
grep -Fq 'import "./auth-v048-redesign.css";' "$SERVER_ROOT/apps/web/src/main.tsx" || die "Redesign final de login 0.4.8 nao esta importado"
grep -Fq 'auth-v047-r2' "$SERVER_ROOT/apps/web/src/components/AuthScreen.tsx" || die "AuthScreen perdeu isolamento responsivo R2"
grep -Fq 'auth-v047-r3' "$SERVER_ROOT/apps/web/src/components/AuthScreen.tsx" || die "AuthScreen perdeu tema dark R3"
grep -Fq 'auth-v048-redesign' "$SERVER_ROOT/apps/web/src/components/AuthScreen.tsx" || die "AuthScreen perdeu redesign final 0.4.8"
grep -Fq 'auth-chat-mock' "$SERVER_ROOT/apps/web/src/components/AuthScreen.tsx" || die "Preview de produto do login 0.4.8 ausente"
grep -Fq 'auth-linux-strip' "$SERVER_ROOT/apps/web/src/components/AuthScreen.tsx" || die "Landing perdeu downloads Linux compactos"
grep -Fq 'auth-mobile-brand' "$SERVER_ROOT/apps/web/src/components/AuthScreen.tsx" || die "Login mobile perdeu cabecalho compacto"
grep -Fq 'loadPersistedUnreadState' "$SERVER_ROOT/apps/web/src/components/Workspace.tsx" || die "Workspace perdeu persistencia de nao lidas"
grep -Fq 'ginga_remember_session' "$SERVER_ROOT/apps/api/src/routes/auth.ts" || die "API perdeu cookie de sessao lembrada"
grep -Fq '/session/restore' "$SERVER_ROOT/apps/api/src/routes/auth.ts" || die "API perdeu restauracao de sessao lembrada"
grep -Fq '/login/2fa-only' "$SERVER_ROOT/apps/api/src/routes/auth.ts" || die "API perdeu login de recuperacao por 2FA"
grep -Fq 'createRememberedAuthSession' "$SERVER_ROOT/apps/api/src/authSessions.ts" || die "Storage de sessoes lembradas ausente"
grep -Fq 'Entrar com 2FA' "$SERVER_ROOT/apps/web/src/components/AuthScreen.tsx" || die "Tela de login perdeu recuperacao por 2FA"
grep -Fq 'voice:soundboard-play' "$SERVER_ROOT/apps/api/src/socket.ts" || die "Socket perdeu disparo do Soundboard"
grep -Fq 'GingaGuildSoundboardSound' "$SERVER_ROOT/apps/api/src/v090Storage.ts" || die "Storage do Soundboard ausente"
grep -Fq 'SoundboardPanel' "$SERVER_ROOT/apps/web/src/components/VoiceRoom.tsx" || die "VoiceRoom perdeu painel de sons"
grep -Fq 'voice:soundboard-played' "$SERVER_ROOT/apps/web/src/components/PersistentVoiceAudio.tsx" || die "Audio persistente perdeu playback do Soundboard"
grep -Fq 'Ir para o final' "$SERVER_ROOT/apps/web/src/components/ChatView.tsx" || die "ChatView perdeu navegacao para o final"
grep -Fq 'Ir para o final' "$SERVER_ROOT/apps/web/src/components/DirectChat.tsx" || die "DirectChat perdeu navegacao para o final"
grep -Fq 'voice-stream-focus-layout' "$SERVER_ROOT/apps/web/src/components/VoiceRoom.tsx" || die "VoiceRoom perdeu modo foco da transmissao"
grep -Fq 'voice-stream-viewers' "$SERVER_ROOT/apps/web/src/components/VoiceRoom.tsx" || die "VoiceRoom perdeu avatares de espectadores"
[[ -f "$BUILD_ROOT/apps/desktop/src/game-overlay.html" ]] || die "game-overlay.html ausente no Desktop"
grep -Fq 'GingaOverlayNative' "$BUILD_ROOT/apps/desktop/src/main.cjs" || die "Desktop perdeu deteccao da janela real do jogo"
grep -Fq 'ginga:game-overlay-status' "$BUILD_ROOT/apps/desktop/src/main.cjs" || die "Desktop perdeu diagnostico/runtime da sobreposicao"
grep -Fq 'getGameOverlayStatus' "$BUILD_ROOT/apps/desktop/src/preload.cjs" || die "Preload perdeu bridge de status da sobreposicao"
grep -Fq 'screenShareEnabled: Boolean(participant.isScreenShareEnabled)' "$SERVER_ROOT/apps/web/src/lib/gameOverlay.ts" || die "Overlay perdeu estado de transmissao dos participantes"
grep -Fq 'cameraEnabled: Boolean(participant.isCameraEnabled)' "$SERVER_ROOT/apps/web/src/lib/gameOverlay.ts" || die "Overlay perdeu estado de camera dos participantes"
grep -Fq 'Promise.allSettled' "$SERVER_ROOT/apps/web/src/components/UserSettingsModal.tsx" || die "Configuracao do overlay voltou a depender integralmente da API de perfil"
grep -Fq 'ginga-shell-v048-packfix-20260901' "$SERVER_ROOT/apps/web/public/sw.js" || die "Service Worker nao foi rotacionado para o PACKFIX 2026-09-01"
! grep -Fq 'resp.clone()' "$SERVER_ROOT/apps/web/public/sw.js" || die "Service Worker voltou a clonar Response em runtime"
grep -Fq '__LIVEKIT_CONNECT_SRC__' "$SERVER_ROOT/apps/web/nginx.conf" || die "Template CSP perdeu placeholder do LiveKit"
grep -Fq 'PUBLIC_LIVEKIT_URL: ${PUBLIC_LIVEKIT_URL:-}' "$SERVER_ROOT/docker-compose.yml" || die "Compose nao injeta PUBLIC_LIVEKIT_URL no build Web"
grep -Fq 'LIVEKIT_DOMAIN: ${LIVEKIT_DOMAIN:-}' "$SERVER_ROOT/docker-compose.yml" || die "Compose nao injeta LIVEKIT_DOMAIN no build Web"
grep -Fq 'viewerIds' "$SERVER_ROOT/apps/api/src/socket.ts" || die "API perdeu lista de espectadores da transmissao"
grep -Fq "GINGA $VERSION" "$SERVER_ROOT/apps/web/src/components/ServerUltimatePanel.tsx" || die "ServerUltimatePanel nao exibe GINGA $VERSION"
grep -Fq "Ginga $VERSION suporta" "$SERVER_ROOT/apps/web/src/components/UserSocialPanel.tsx" || die "UserSocialPanel ainda exibe versao diferente de $VERSION"
python3 - "$BUILD_ROOT/apps/desktop/package.json" <<'PYLINUX'
import json,sys
p=sys.argv[1]
x=json.load(open(p,encoding='utf-8'))
scripts=x.get('scripts',{})
for name in ('dist:linux:x64','dist:linux:arm64'):
    if name not in scripts: raise SystemExit(f'Script Linux ausente: {name}')
build=x.get('build',{})
linux=build.get('linux',{})
targets=linux.get('target',[])
for target in ('AppImage','deb','rpm'):
    if target not in targets: raise SystemExit(f'Target Linux ausente: {target}')
# electron-builder 26.15.3 nao aceita packageName dentro de build.linux.
# packageName e configuracao especifica dos empacotadores DEB/RPM.
if 'packageName' in linux:
    raise SystemExit('Configuracao Linux invalida: mova build.linux.packageName para build.deb.packageName e build.rpm.packageName')
for section in ('deb','rpm'):
    cfg=build.get(section,{})
    if cfg.get('packageName') != 'ginga':
        raise SystemExit(f'build.{section}.packageName deve ser ginga')
print('Empacotamento Linux: AppImage/deb/rpm x64 + AppImage/deb arm64 configurado; schema 26.15.3 saneado')
PYLINUX
if grep -Rni --include='*.tsx' --include='*.ts' -E 'Personaliza(c|ç)ao 0\.9|GINGA 0\.9|Ginga 0\.9' "$SERVER_ROOT/apps/web/src" >/tmp/ginga-v09-ui.$$ 2>/dev/null; then
  cat /tmp/ginga-v09-ui.$$ >&2
  rm -f /tmp/ginga-v09-ui.$$
  die "Texto legado 0.9 encontrado na interface"
fi
rm -f /tmp/ginga-v09-ui.$$ 2>/dev/null || true
ok "Camada de UI final e nomenclatura da release OK"

log "6.5/7 - Security regression gate 0.4.8"
"$BUILD_ROOT/scripts/security-regression-check.sh"
ok "Security regression gate passou"

log "7/7 - Consultando runtime atual (informativo)"
WEB_PORT="$(awk -F= '/^WEB_PORT=/{print $2; exit}' "$SERVER_ROOT/.env" | tr -d '\r' || true)"
WEB_PORT="${WEB_PORT:-3090}"
HEALTH="$(curl -fsS --max-time 4 "http://127.0.0.1:${WEB_PORT}/api/health" 2>/dev/null || true)"
if [[ -n "$HEALTH" ]]; then
  python3 - "$HEALTH" <<'PY'
import json,sys
x=json.loads(sys.argv[1])
print(f"Runtime atual: status={x.get('status')} version={x.get('version')}")
if x.get('status') != 'ok': raise SystemExit(1)
PY
  ok "Runtime atual saudavel"
else
  warn "Runtime atual nao respondeu em 127.0.0.1:$WEB_PORT. O build passou, mas confirme o servico antes da publicacao."
fi

printf '\n\033[1;32m============================================================\033[0m\n'
printf '\033[1;32m  GINGA %s APTO PARA PUBLICACAO\033[0m\n' "$VERSION"
printf '\033[1;32m============================================================\033[0m\n'
printf 'Proximos comandos:\n'
if [[ "$MODE" != "--linux" ]]; then
  printf '  Windows: cd %s && ./release-win.sh %s\n' "$BUILD_ROOT" "$VERSION"
fi
if [[ "$MODE" != "--windows" ]]; then
  printf '  Linux x64: cd %s && ./release-linux.sh %s --x64\n' "$BUILD_ROOT" "$VERSION"
  printf '  Linux x64 + ARM64: cd %s && ./release-linux.sh %s --all\n' "$BUILD_ROOT" "$VERSION"
fi
printf '\n'

