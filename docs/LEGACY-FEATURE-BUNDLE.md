# Documento historico interno

Este arquivo descreve um bundle de desenvolvimento que chegou a usar o rotulo interno `0.9.0`, mas **nunca representa a versao publica desta entrega**. O release publico consolidado e **Ginga 0.4.3**.

# Ginga 0.9.0 - BIG Update

A 0.9.0 parte diretamente da 0.4.0 e preserva os fixes de Desktop, updater, voz, perfis e personalizacao existentes.

## O que entrou

- **Servidor:** Areas/Espacos, preferencia pessoal de canais, emojis/stickers proprios, onboarding, badges, salas dinamicas e politica de seguranca avancada.
- **Perfil:** camada social e estrutura de perfil por servidor com avatar/banner, bio, pronomes, temas, cores e links.
- **Chat:** backend de rascunhos sincronizados e historico de edicoes; a base 0.4 continua com respostas, reacoes, arquivos, encaminhamento, fixados e busca.
- **Moderacao:** anti-raid e quarentena opt-in; filtros de links, convites, mencoes e repeticao; auto-timeout opcional e soft-ban.
- **Desktop:** deep link `ginga://invite/CODIGO`, autostart Windows e relatorio de crash autenticado, mantendo sandbox/contextIsolation.
- **Mobile/Web:** PWA com Service Worker seguro. A base Android nativa continua experimental e nao e anunciada como APK final.
- **Admin:** Health v2 com contagens e armazenamento, alem dos crash reports do Desktop.
- **Bots:** SDK Python preservado e SDK JavaScript/TypeScript novo em `sdk/javascript`.
- **Deploy:** `scripts/apply-update-safe.sh` recusa source vazio ou `/` e preserva `.env`, updater e secrets.

## Compatibilidade

As tabelas 0.9 sao criadas de maneira aditiva e idempotente pela API. As politicas de seguranca novas iniciam desligadas em servidores existentes para evitar mudanca de comportamento apos o update.
