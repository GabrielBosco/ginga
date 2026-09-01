# Ginga 0.4.8 — Security Hardening + Music Client Edge

## Segurança

- Onboarding valida `roleId` e `channelIds` contra o guild da pergunta antes de persistir e novamente antes de aplicar respostas.
- Permissoes ignoram defensivamente qualquer atribuicao de cargo cujo `role.guildId` nao coincida com o guild da membership.
- Heranca de categoria so e aplicada quando `category.guildId === channel.guildId`.
- Spaces validam categorias/canais do mesmo guild.
- Security Policy valida o canal de log no mesmo guild e somente TEXT/ANNOUNCEMENT.
- Dynamic Voice valida a categoria no cadastro e novamente na criacao da sala.
- Badges validam tanto a badge quanto o usuario alvo no mesmo guild.
- Ginga Music nao confia mais no gate `playbackOwner` do frontend para `ENDED`; o backend valida permissao/termino natural.
- PostgreSQL e Redis deixam de ter caminho de inicializacao com segredo vazio/default conhecido no Compose.

## Ginga Music: Client Edge

O servidor Ginga e apenas **control-plane**: fila, estado, clock e busca de metadados. O audio nao e proxyado pela API e nao e publicado no LiveKit. Cada Web/Desktop reproduz diretamente da origem suportada (YouTube iframe API / SoundCloud Widget).

Na 0.4.8 foi removido o heartbeat de playback por usuario. Isso evita que milhares de ouvintes gerem POSTs periodicos no servidor. Para faixas com duracao conhecida, o proprio control-plane agenda o fim usando um timer leve por servidor ativo. O callback local do player fica como fallback: o usuario que pediu a faixa tenta primeiro e os demais aguardam alguns segundos, abortando se o estado ja tiver avancado. `expectedTrackId` mantem o comando idempotente.

O endpoint `/music/playback-lease` permanece somente como compatibilidade para clientes 0.4.7 durante a transicao.

## Saneamento de dados legados

No primeiro bootstrap do storage v0.9 por processo, a API remove/neutraliza referencias cross-tenant antigas em Spaces, onboarding, custom roles, badges, security-policy e templates de voz. As validacoes de runtime continuam sendo a barreira principal; o saneamento existe para limpar dados que possam ter sido gravados antes da 0.4.8.

## Release

```bash
./scripts/security-regression-check.sh
./scripts/pre-release-check.sh 0.4.8 --all
./release-all.sh 0.4.8 --all
```

## FULL FIX R1 — LiveKit/CSP e Service Worker

- O `connect-src` e gerado no build da Web a partir de `PUBLIC_LIVEKIT_URL` e `LIVEKIT_DOMAIN`, incluindo os origins HTTP(S)/WS(S) correspondentes.
- O endpoint de validacao `https://<livekit>/rtc/v1/validate` deixa de ser bloqueado pela CSP.
- `sw.js` nao faz mais runtime cache de JS/CSS/imagens nem usa `Response.clone()`; mantem apenas shell basico e fallback de navegacao offline.
- O Nginx entrega `/sw.js` com `no-store` para acelerar a substituicao de Service Workers antigos.

## RELEASE FINAL — responsividade global e gate corrigido

- A base oficial de release inclui `ui-v048-viewport-fit.css` e `ui-v048-responsive-final.css`.
- O Service Worker esperado pelo gate e `ginga-shell-v048-full-fix-r3-responsive`.
- `pre-release-check.sh` valida explicitamente as duas camadas responsivas antes de publicar Windows/Linux.
