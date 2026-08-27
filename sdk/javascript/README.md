# Ginga — JavaScript / TypeScript

O **SDK oficial de bots do Ginga e Python** e esta em `sdk/python` (`pip install ginga-bot`, `import gingabot`).

Este diretorio permanece apenas como referencia de integracao de baixo nivel para quem precisa usar Node.js diretamente. Nao existe pacote JavaScript oficial com paridade garantida com o SDK Python.

Para integracao manual em Node.js 20+:

```bash
npm install socket.io-client dotenv
```

Use `fetch` nativo para REST e `socket.io-client` para o Gateway. Tokens devem permanecer somente no backend.

Consulte a Base de Conhecimento do **Portal do Desenvolvedor** para o fluxo:

```text
Aplicacao -> Bot -> Permissoes -> Instalacao
```
