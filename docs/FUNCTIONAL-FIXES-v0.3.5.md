# Ginga Desktop 0.3.5 - Functional Final

- Aceleracao de hardware continua ATIVA por padrao. `GINGA_DISABLE_HARDWARE_ACCELERATION=1` permanece apenas como fallback de diagnostico.
- Captura de janela/tela continua via `setDisplayMediaRequestHandler` do Electron; o Web solicita `cursor: always`.
- Monitoramento de `child-process-gone` para processo GPU/utility, com log e recuperacao sem encerrar o app inteiro.
- Notificacao Windows usa Electron `Notification` como caminho principal.
- Se o toast nativo falhar ou nao disparar evento `show`, usa `Tray.displayBalloon` como fallback.
- O IPC de teste de notificacao retorna confirmacao real para a UI.
- Versao permanece 0.3.5 e fluxo de release continua por `./release-win.sh 0.3.5`.

## Validacao local
- `node --check apps/desktop/src/main.cjs`: OK.
- `node --check apps/desktop/src/preload.cjs`: OK.
