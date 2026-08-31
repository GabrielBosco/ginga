# Ginga 0.4.3 RC4

## Visualizador de midia

O botao **Abrir original** continua abrindo o anexo fora do visualizador, mas no Desktop o URL e encaminhado ao navegador padrao. A janela principal do Electron nunca e navegada para o arquivo bruto.

## Lista de membros

A regra passa a ser:

1. membro online + cargo com `hoist`: entra no grupo do cargo mais alto;
2. membro online sem cargo separado: entra em `Online`;
3. membro offline: entra sempre em `Offline`, ignorando agrupamento por cargo;
4. o criador continua identificado apenas pela coroa ao lado do nome.
