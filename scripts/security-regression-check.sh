#!/usr/bin/env bash
set -euo pipefail
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
fail(){ echo "[SECURITY FAIL] $*" >&2; exit 1; }
ok(){ echo "[SECURITY OK] $*"; }

grep -Fq 'requireGuildCustomRoleId' "$ROOT/apps/api/src/routes/v090.ts" || fail "onboarding sem validacao de cargo por guild"
grep -Fq 'safeRoles=await requireGuildCustomRoleIds' "$ROOT/apps/api/src/routes/v090.ts" || fail "onboarding completion sem defesa cross-tenant"
grep -Fq 'await requireGuildMember(u,g);' "$ROOT/apps/api/src/routes/v090.ts" || fail "badge assignment sem validacao de membro"
grep -Fq 'requireGuildTextChannelId' "$ROOT/apps/api/src/routes/v090.ts" || fail "mod log sem validacao de tenant"
grep -Fq 'role.guildId === guildId' "$ROOT/apps/api/src/permissions.ts" || fail "custom roles sem filtro defensivo de guild"
grep -Fq 'channel.category?.guildId === channel.guildId' "$ROOT/apps/api/src/permissions.ts" || fail "heranca de categoria sem defesa de guild"
grep -Fq 'position + 2.5 < duration' "$ROOT/apps/api/src/routes/music.ts" || fail "ENDED sem validacao server-side de termino natural"
grep -Fq 'playbackMode: "CLIENT_EDGE"' "$ROOT/apps/api/src/routes/music.ts" || fail "Ginga Music nao esta em modo client-edge"
grep -Fq 'scheduleNaturalAdvance' "$ROOT/apps/api/src/routes/music.ts" || fail "fila de musica sem avancar pelo relogio do control-plane"
if grep -Fq '/music/playback-lease' "$ROOT/apps/web/src/components/GingaMusicPlayer.tsx"; then fail "cliente 0.4.8 ainda envia heartbeat de playback"; fi
grep -Fq 'const tenantCleanup = [' "$ROOT/apps/api/src/v090Storage.ts" || fail "saneamento de dados cross-tenant legados ausente"
if grep -Fq 'musicPlaybackLeases = new Map' "$ROOT/apps/api/src/routes/music.ts"; then fail "heartbeat de playback legado ainda ativo"; fi
grep -Fq 'POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:?' "$ROOT/docker-compose.yml" || fail "PostgreSQL aceita senha ausente"
grep -Fq 'REDIS_PASSWORD: ${REDIS_PASSWORD:?' "$ROOT/docker-compose.yml" || fail "Redis aceita senha ausente"
grep -Fq -- '--requirepass "$$REDIS_PASSWORD"' "$ROOT/docker-compose.yml" || fail "Redis nao usa senha obrigatoria via ambiente"
if grep -Fq -- '--requirepass", "${REDIS_PASSWORD:' "$ROOT/docker-compose.yml"; then fail "Redis expoe senha resolvida no command do Compose"; fi
if grep -Fq 'else exec redis-server --appendonly yes' "$ROOT/docker-compose.yml"; then fail "Redis ainda possui fallback sem senha"; fi
ok "tenant isolation, music authorization/client-edge e secrets fail-closed presentes"
