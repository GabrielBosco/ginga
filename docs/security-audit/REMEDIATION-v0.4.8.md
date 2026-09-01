# Remediacao da auditoria de seguranca - Ginga 0.4.8

Este documento registra as correcoes aplicadas sobre os cinco achados confirmados no relatorio da v0.4.7. O PDF preservado nesta pasta continua sendo a evidencia historica do codigo auditado; a v0.4.8 adiciona os controles abaixo.

## 1. Isolamento de tenant no onboarding - corrigido

- `apps/api/src/tenantValidation.ts` centraliza validacao de cargo, canal e categoria pelo `guildId`.
- criacao de opcoes de onboarding rejeita `roleId` e `channelIds` de outro servidor.
- conclusao do onboarding revalida configuracoes legadas antes de conceder cargos/favoritos.
- `apps/api/src/permissions.ts` ignora defensivamente qualquer custom role cujo `role.guildId` seja diferente do guild consultado.
- `apps/api/src/v090Storage.ts` remove referencias cross-tenant legadas no bootstrap.

## 2. IDOR na atribuicao de badges - corrigido

- o badge precisa existir no `guildId` da rota;
- o usuario alvo precisa ser membro desse mesmo guild;
- atribuicoes legadas para usuarios fora do guild sao saneadas no bootstrap.

## 3. Referencias cross-tenant em Spaces/voz/security-policy - corrigido

- Spaces validam todas as categorias e canais antes da gravacao;
- leituras de Spaces filtram relacionamentos pelo guild real do recurso;
- canal de log de moderacao precisa ser canal TEXT/ANNOUNCEMENT do mesmo guild;
- template de voz dinamica valida categoria na configuracao e novamente na criacao da sala;
- heranca de permissao por categoria so ocorre quando `category.guildId === channel.guildId`;
- dados legados invalidos sao removidos ou neutralizados no bootstrap.

## 4. Ginga Music confiava no frontend para `ENDED` - corrigido

- `ENDED` agora e validado integralmente na API;
- membro sem permissao de controle so consegue reportar termino quando o relogio do servidor confirma o final natural da faixa;
- `expectedTrackId` mantem a operacao idempotente;
- faixas com duracao conhecida sao avancadas pelo timer leve do control-plane, reduzindo requests dos clientes.

## 5. Defaults inseguros de PostgreSQL/Redis - corrigido

- `.env.example` nao publica senha conhecida;
- Docker Compose recusa startup sem `POSTGRES_PASSWORD` e `REDIS_PASSWORD`;
- Redis nao possui mais fallback sem autenticacao;
- a senha do Redis e consumida dentro do container por variavel de ambiente, sem ser materializada no `command` resolvido pelo Compose;
- startup da API rejeita placeholders `CHANGE_ME` conhecidos.

## Ginga Music - arquitetura client-edge

Na v0.4.8 o servidor Ginga e apenas o **control-plane** da musica:

- fila, estado, timestamps e comandos passam pela API/Socket.IO;
- audio do YouTube/SoundCloud e reproduzido diretamente no Web/Electron de cada ouvinte;
- o audio nao passa pela API Ginga, pelo LiveKit nem por um proxy de midia do servidor;
- o antigo heartbeat `/music/playback-lease` fica somente como endpoint de compatibilidade para clientes 0.4.7; o cliente 0.4.8 nao o utiliza;
- o servidor agenda o fim natural de faixas conhecidas com timers leves e os players edge funcionam como fallback.

Isso faz o consumo de banda do servidor crescer principalmente com mensagens pequenas de controle, e nao com o bitrate das musicas reproduzidas.

## Gate de regressao

Execute:

```bash
./scripts/security-regression-check.sh
```

O `pre-release-check.sh` da v0.4.8 executa esse gate automaticamente antes da publicacao.
