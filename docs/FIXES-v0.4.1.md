# Ginga 0.4.1 - BIG FIX

## Correcao de dimensionamento
- corrige o Desktop ocupando uma altura maior que a area util da janela;
- mantem a barra de controles de voz sempre dentro da janela;
- evita que chat/voz ultrapassem o viewport em Windows com escala de exibicao.

## Personalizacao
- painel de Personalizacao refeito e responsivo;
- remove dependencia de `window.prompt`, que era inadequada no Electron;
- carregamento parcial: falha de um modulo nao derruba o painel inteiro;
- abas respeitam as permissoes reais do usuario;
- criar/remover areas, emojis, stickers, perguntas/opcoes, modelos de sala e badges;
- atribuicao e remocao de badges;
- protecao com controles completos e layout corrigido.

## Desktop
- comando **Sair** da bandeja encerra janelas, timers e o processo com fallback de hard-exit;
- opcao **Abrir Ginga com o Windows** nas configuracoes e na bandeja;
- `apply-update-safe.sh` nao depende de Node instalado no Debian.
