# Validacao tecnica - Ginga 0.4.1

Validacoes realizadas neste pacote:

- parsing sintatico TypeScript/TSX de API e Web;
- `node --check` no Desktop e SDK JavaScript;
- `bash -n` nos scripts shell;
- parse de JSON/package manifests;
- testes unitarios existentes do SDK Python;
- verificacao de ausencia de `.env`, private.pem, EXE e node_modules no ZIP final;
- versoes root/API/Web/Desktop/SDK JS sincronizadas em 0.4.1.

## Build npm completo

O build semantico completo com `npm ci` nao e declarado como concluido neste ambiente, porque o registry/dependencias de producao nao estao integralmente disponiveis aqui. O `release-win.sh 0.4.1` no servidor oficial de build continua sendo a barreira final antes da publicacao.

Se o release apontar erro TypeScript real depois do `npm ci` normal no servidor, interrompa a publicacao e corrija antes de disponibilizar o update.
