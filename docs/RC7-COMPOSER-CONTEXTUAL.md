# Ginga 0.4.3 RC7 - Composer contextual

A barra Markdown nao ocupa espaco permanentemente no chat.

## Comportamento

- sem foco no textarea: barra recolhida
- clicou/digitou no textarea: barra exibida
- usou negrito/italico/link/etc.: textarea mantem foco e barra permanece aberta
- clicou fora do composer: barra recolhida novamente
- mesmo comportamento em canais e DMs

Isso preserva os atalhos Ctrl+B, Ctrl+I, Ctrl+U, Ctrl+E e Ctrl+K.
