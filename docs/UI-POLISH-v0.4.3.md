# Ginga 0.4.3 - UI Polish

A 0.4.3 adiciona uma camada final de design system em `apps/web/src/ui-foundation-v043.css`.

## O que foi ajustado

- tipografia consistente entre Web e Electron;
- textos de canais, membros, chat e menus deixam de usar tamanhos excessivamente pequenos;
- tela `Explorar` refeita visualmente no painel lateral;
- hierarquia de titulos/subtitulos em configuracoes;
- campos, botoes e labels com tamanhos mais coerentes;
- tela de Personalizacao/Community com leitura melhor;
- o dimensionamento responsivo R2 permanece ativo: a geometria continua compacta em 1440x900/1536x864, mas a fonte nao e mais reduzida como se o navegador estivesse em 80%;
- mobile preserva textarea em 16px para evitar zoom automatico em WebView/iOS.

## Arquitetura CSS

O legado do Ginga possui varias camadas historicas dentro de `styles.css`. Para diminuir risco antes da 0.4.3, esta revisao nao reescreve 10 mil linhas de CSS em uma unica migracao. Em vez disso, a camada `ui-foundation-v043.css` e importada por ultimo e funciona como fonte canonica para tipografia e densidade visual.

Uma futura 0.5.x pode consolidar os estilos antigos por modulo sem misturar essa limpeza com a release atual.
