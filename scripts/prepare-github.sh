#!/usr/bin/env bash
set -Eeuo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
RUN_BUILD=0
[[ "${1:-}" == "--build" ]] && RUN_BUILD=1

ok() { printf '[OK] %s\n' "$*"; }
fail() { printf '[FAIL] %s\n' "$*" >&2; exit 1; }
warn() { printf '[WARN] %s\n' "$*" >&2; }

tracked_files() {
  if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    git ls-files -z
  else
    find . -type f ! -path './.git/*' -print0
  fi
}

TMP_LIST=$(mktemp)
trap 'rm -f "$TMP_LIST"' EXIT
tracked_files > "$TMP_LIST"

[[ -f .env.example ]] || fail ".env.example ausente"
[[ -f LICENSE ]] || fail "LICENSE ausente"
[[ -f README.md ]] || fail "README.md ausente"

# Arquivos que nunca devem ser publicados.
while IFS= read -r -d '' file; do
  clean=${file#./}
  case "$clean" in
    .env|*/.env|secrets/*|*/secrets/*|*private.pem|*.key|*.p12|*.pfx|*.jks|*.keystore)
      fail "arquivo sensivel encontrado no conjunto publicado: $clean"
      ;;
    */node_modules/*|node_modules/*|*/dist/*|dist/*|*/out/*|out/*)
      fail "artefato gerado/dependencia vendorizada encontrada: $clean"
      ;;
    .patch-backups/*|.release-backups/*|.security-backup/*|.ginga-hotfix-backup/*|*/.patch-backups/*|*/.release-backups/*|*/.security-backup/*|*/.ginga-hotfix-backup/*)
      fail "backup interno nao deve ser publicado: $clean"
      ;;
    *.tsbuildinfo|*.bak|*.orig|*.rej)
      fail "arquivo temporario nao deve ser publicado: $clean"
      ;;
  esac
done < "$TMP_LIST"
ok "nenhum segredo, backup, node_modules, dist ou temporario publicado"

# Endereco publico canonico pode aparecer em homepage/updater. Bloqueie apenas
# endpoints legados e enderecos privados da instalacao do mantenedor.
PATTERN='ginga\.serveirc\.com|100\.64\.[0-9]+\.[0-9]+'
MATCHES=$(xargs -0 grep -nEIH -- "$PATTERN" < "$TMP_LIST" 2>/dev/null || true)
if [[ -n "$MATCHES" ]]; then
  printf '%s\n' "$MATCHES" >&2
  fail "endpoint especifico de producao encontrado"
fi
ok "nenhum endpoint legado/privado da instalacao encontrado"

# Credenciais obviamente preenchidas. Placeholders do .env.example sao permitidos.
SECRET_MATCHES=$(xargs -0 grep -nEIH -- '(SMTP_PASSWORD|POSTGRES_PASSWORD|REDIS_PASSWORD|JWT_SECRET|LIVEKIT_API_SECRET|RESEND_API_KEY)[[:space:]]*=[[:space:]]*[^[:space:]#]+' < "$TMP_LIST" 2>/dev/null \
  | grep -Eiv 'troque|change[_ -]?me|example\.(com|invalid)|senha-de|senha_de_app|=senha$|=[[:space:]]*\.\.\.|process\.env|\$\{|os\.getenv|^.*\.env\.example:' || true)
if [[ -n "$SECRET_MATCHES" ]]; then
  printf '%s\n' "$SECRET_MATCHES" >&2
  fail "possivel segredo hardcoded encontrado"
fi
ok "nenhum segredo obvio hardcoded encontrado"

ROOT_VERSION=$(node -p "require('./package.json').version")
API_VERSION=$(node -p "require('./apps/api/package.json').version")
WEB_VERSION=$(node -p "require('./apps/web/package.json').version")
DESKTOP_VERSION=$(node -p "require('./apps/desktop/package.json').version")
[[ "$ROOT_VERSION" == "$API_VERSION" && "$API_VERSION" == "$WEB_VERSION" && "$WEB_VERSION" == "$DESKTOP_VERSION" ]] \
  || fail "versoes divergentes: root=$ROOT_VERSION api=$API_VERSION web=$WEB_VERSION desktop=$DESKTOP_VERSION"
ok "Root/API/Web/Desktop sincronizados em $API_VERSION"

if [[ "$API_VERSION" == "0.4.7" || "$API_VERSION" == "0.4.8" ]]; then
  [[ -f apps/web/src/components/SoundboardPanel.tsx ]] || fail "SoundboardPanel.tsx ausente na 0.4.7"
  [[ -f apps/web/src/lib/soundboard.ts ]] || fail "lib/soundboard.ts ausente na 0.4.7"
  [[ -f apps/web/src/ui-v047.css ]] || fail "ui-v047.css ausente na 0.4.7"
  [[ -f apps/web/src/ui-v047-final.css ]] || fail "ui-v047-final.css ausente na 0.4.7"
  grep -Fq 'import "./ui-v047-final.css";' apps/web/src/main.tsx || fail "camada final responsiva 0.4.7 nao importada"
  grep -Fq 'compactNavigation' apps/web/src/components/SettingsShell.tsx || fail "SettingsShell perdeu navegacao mobile previsivel"
  grep -Fq 'voice:soundboard-play' apps/api/src/socket.ts || fail "socket do Soundboard ausente na 0.4.7"
  grep -Fq 'GingaGuildSoundboardSound' apps/api/src/v090Storage.ts || fail "storage do Soundboard ausente na 0.4.7"
  grep -Fq 'voice:soundboard-played' apps/web/src/components/PersistentVoiceAudio.tsx || fail "playback persistente do Soundboard ausente na 0.4.7"
  grep -Fq 'SoundboardPanel' apps/web/src/components/Workspace.tsx || fail "mini-card de voz perdeu acesso ao Soundboard"
  [[ -f apps/web/src/auth-v047.css ]] || fail "auth-v047.css ausente na 0.4.7"
  [[ -f apps/web/src/auth-v047-r2.css ]] || fail "auth-v047-r2.css ausente na 0.4.7"
  [[ -f apps/web/src/lib/unreadState.ts ]] || fail "persistencia de nao lidas ausente na 0.4.7"
  grep -Fq 'import "./auth-v047.css";' apps/web/src/main.tsx || fail "camada de autenticacao 0.4.7 nao importada"
  grep -Fq 'import "./auth-v047-r2.css";' apps/web/src/main.tsx || fail "camada responsiva AUTH R2 nao importada"
  grep -Fq 'auth-mobile-brand' apps/web/src/components/AuthScreen.tsx || fail "login mobile perdeu cabecalho compacto"
  grep -Fq 'loadPersistedUnreadState' apps/web/src/components/Workspace.tsx || fail "Workspace perdeu persistencia de nao lidas"
  grep -Fq 'ginga_remember_session' apps/api/src/routes/auth.ts || fail "cookie de sessao lembrada ausente"
  grep -Fq '/session/restore' apps/api/src/routes/auth.ts || fail "restauracao de sessao lembrada ausente"
  grep -Fq '/login/2fa-only' apps/api/src/routes/auth.ts || fail "login de recuperacao por 2FA ausente"
  grep -Fq 'createRememberedAuthSession' apps/api/src/authSessions.ts || fail "storage da sessao lembrada ausente"
  grep -Fq 'Entrar com 2FA' apps/web/src/components/AuthScreen.tsx || fail "UI de login com 2FA ausente"
  ok "Soundboard + autenticacao responsiva + nao lidas persistentes 0.4.7+ presentes"
fi

if [[ "$API_VERSION" == "0.4.8" ]]; then
  [[ -x scripts/security-regression-check.sh ]] || fail "security-regression-check.sh ausente ou sem permissao de execucao"
  scripts/security-regression-check.sh
  [[ -f apps/api/src/tenantValidation.ts ]] || fail "tenantValidation.ts ausente na 0.4.8"
  grep -Fq 'playbackMode: "CLIENT_EDGE"' apps/api/src/routes/music.ts || fail "Ginga Music perdeu playback client-edge"
  grep -Fq 'audioProxiedByServer: false' apps/api/src/routes/music.ts || fail "Ginga Music voltou a sinalizar proxy de audio pelo servidor"
  ok "hardening de tenant + Music client-edge 0.4.8 presentes"
fi

# Evita regressao do erro que quebrou o build Linux no electron-builder 26.15.3.
python3 - <<'PY'
import json
from pathlib import Path
pkg=json.loads(Path('apps/desktop/package.json').read_text(encoding='utf-8'))
build=pkg.get('build', {})
linux=build.get('linux') or {}
if 'packageName' in linux:
    raise SystemExit('[FAIL] build.linux.packageName e invalido para a configuracao usada; mantenha packageName em build.deb/build.rpm')
for target in ('deb','rpm'):
    if (build.get(target) or {}).get('packageName') != 'ginga':
        raise SystemExit(f'[FAIL] build.{target}.packageName precisa ser ginga')
print('[OK] configuracao Linux preserva packageName em deb/rpm')
PY

if [[ -f sdk/python/pyproject.toml ]]; then
  command -v python3 >/dev/null 2>&1 || fail "SDK Python requer python3"
  SDK_NAME=$(python3 - <<'PY'
import tomllib
with open('sdk/python/pyproject.toml', 'rb') as f:
    print(tomllib.load(f)['project']['name'])
PY
)
  SDK_VERSION=$(python3 - <<'PY'
import tomllib
with open('sdk/python/pyproject.toml', 'rb') as f:
    print(tomllib.load(f)['project']['version'])
PY
)
  [[ "$SDK_NAME" == "ginga-bot" ]] || fail "nome inesperado do SDK Python: $SDK_NAME"
  [[ -f sdk/python/gingabot/__init__.py ]] || fail "modulo gingabot ausente"
  python3 - <<'PY'
from pathlib import Path
for root in (Path('sdk/python/gingabot'), Path('sdk/python/examples'), Path('examples/python-bot')):
    if not root.exists():
        continue
    for path in root.rglob('*.py'):
        compile(path.read_text(encoding='utf-8'), str(path), 'exec')
PY
  ok "Ginga Bot SDK $SDK_VERSION passou no parser"
fi

for f in apps/desktop/src/*.cjs scripts/*.cjs; do
  [[ -f "$f" ]] || continue
  node --check "$f" >/dev/null
done
ok "JavaScript/CJS passou no parser"

for f in scripts/*.sh build-win.sh build-linux.sh release-win.sh release-linux.sh release-all.sh; do
  [[ -f "$f" ]] || continue
  bash -n "$f"
done
ok "scripts shell passaram no parser"

if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
  docker compose --env-file .env.example -f docker-compose.yml config >/dev/null
  ok "Docker Compose valido com .env.example"
else
  warn "Docker Compose nao encontrado; validacao do compose foi ignorada"
fi

if (( RUN_BUILD == 1 )); then
  command -v docker >/dev/null 2>&1 || fail "--build requer Docker"
  docker build -q -t ginga-preflight-api ./apps/api >/dev/null
  docker build -q -t ginga-preflight-web ./apps/web >/dev/null
  ok "imagens API e Web compiladas"
fi

printf '\nRepositorio pronto para publicacao no GitHub.\n'
