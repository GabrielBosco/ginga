# Ginga 0.4.3 RC6 — Chat QoL

Esta RC fecha problemas de legibilidade e recursos de qualidade de vida do chat antes da publicacao da 0.4.3.

## Links e seguranca

- URLs `http://` e `https://` em mensagens viram hyperlinks automaticamente.
- Links Markdown no formato `[texto](https://destino)` sao renderizados como hyperlink.
- Links externos exibem confirmacao antes de sair do Ginga, mostrando dominio e URL.
- Links usam apenas protocolos HTTP/HTTPS no renderer do chat.
- O mesmo renderer foi aplicado a canais, mensagens fixadas, threads e mensagens diretas.

## Formatacao de mensagens

Toolbar nova no composer:

- Negrito: `**texto**` — Ctrl+B
- Italico: `*texto*` — Ctrl+I
- Sublinhado: `__texto__` — Ctrl+U
- Riscado: `~~texto~~`
- Codigo inline: `` `codigo` `` — Ctrl+E
- Link: `[texto](https://destino)` — Ctrl+K
- Blocos de codigo com tres crases tambem sao renderizados.

A implementacao renderiza React nodes diretamente e nao usa `dangerouslySetInnerHTML`.

## Modo lento

O backend ja possuia a regra de slow mode; nesta RC ela foi exposta na interface:

- configuracao ao criar canal;
- Configuracoes do espaco > Canais;
- menu de contexto do canal;
- aviso no composer;
- contagem regressiva local apos envio para membros sujeitos ao limite.

Presets: desativado, 5s, 10s, 15s, 30s, 1min, 2min, 5min e 10min. O backend continua aceitando ate 21600 segundos.

## Limpeza do canal

Usuarios com `Gerenciar mensagens` podem limpar:

- as ultimas 1 a 500 mensagens;
- todo o historico do canal.

Disponivel em:

- Configuracoes do espaco > Canais > Limpar;
- menu de contexto do canal > Limpar mensagens;
- comando `/clear 50`;
- comando `/clear all`.

A acao exige confirmacao, grava auditoria e sincroniza os clientes conectados via Socket.IO.

## Legibilidade / acessibilidade

A base tipografica foi aumentada sem alterar zoom do navegador ou escala do Electron. A configuracao Aparencia > Escala do texto agora oferece:

- 90% Compacto
- 100% Padrao
- 110% Confortavel
- 120% Grande
- 130% Muito grande
- 140% Acessibilidade

A escala ajusta as variaveis tipograficas do Ginga, em vez de aplicar `transform: scale()`.

## Validacao local

- 111 arquivos TS/TSX passaram por parse/transpile de sintaxe com TypeScript 5.8.3.
- scripts shell passaram em `bash -n`.
- Electron `main.cjs` e `preload.cjs` passaram em `node --check`.
- O build npm completo deve ser executado pelo `scripts/pre-release-check.sh 0.4.3` no builder de producao, pois o ambiente de empacotamento nao possui o registry/cache completo de dependencias.
