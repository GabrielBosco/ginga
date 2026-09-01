# Ginga 0.4.6 — UI/UX Polish + Chat Navigation

A `0.4.6` concentra uma rodada de acabamento visual e correções de navegação do chat sem remover os recursos entregues na `0.4.5`.

## Fase 1 — UX crítica

- canais de texto e mensagens diretas entram no final do histórico;
- ao sair do final, aparece **Ir para o final**;
- mensagens recebidas enquanto o histórico está sendo lido incrementam o contador sem deslocar a tela;
- envio próprio retorna ao final;
- carregamento tardio de mídia mantém o final estável quando apropriado;
- datas usam Hoje/Ontem/dia da semana/data completa;
- horários exibem timestamp completo no hover;
- avatar/nome da mensagem e corpo da mensagem possuem contextos separados.

## Fase 2 — acabamento visual

- nova camada `apps/web/src/ui-v046.css`;
- paleta escura mais neutra e suave;
- mensagens e elementos de navegação com tipografia maior;
- sidebar, lista de membros, composer, menus e cabeçalhos com espaçamento e contraste revisados;
- estados hover/ativo mais discretos;
- painel de membros recolhido em larguras intermediárias para proteger a área do chat.

## Fase 3 — estabilidade e regressões

- saltos de busca/fixados não são sobrescritos pelo auto-scroll inicial;
- scroll deixa de puxar o usuário para baixo enquanto ele lê mensagens antigas;
- eventos de contexto em avatar/nome deixam de propagar para o menu da mensagem;
- Service Worker atualizado para `ginga-shell-v046`;
- versões Root/API/Web/Desktop alinhadas em `0.4.6`;
- preservado o suporte a GIF animado e os ajustes responsivos da `0.4.5`;
- preservado o layout Linux/Windows e o fix de schema do electron-builder 26.15.3.

## Voz e compartilhamento de tela

- quando existe uma transmissao ativa, a sala entra em **modo foco**: a tela compartilhada ocupa o palco principal e os participantes ficam em cards empilhados;
- clicar em outro card com `AO VIVO` troca a transmissao principal sem encerrar a chamada;
- o canto inferior esquerdo da transmissao mostra os espectadores reais: ate 3 avatares e `+N` quando houver mais pessoas;
- o contador/lista e atualizado pelos eventos `voice:stream-watch` / `voice:stream-unwatch`, sem contar o proprio transmissor;
- fullscreen mantem a transmissao e o indicador de espectadores;
- o menu de contexto dos cards de usuario continua disponivel sem liberar o clique direito dentro do video compartilhado.

## Release

```bash
cd /opt/ginga-build
./scripts/pre-release-check.sh 0.4.6 --all
./release-all.sh 0.4.6 --all
```
