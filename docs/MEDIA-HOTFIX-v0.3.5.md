# Ginga 0.3.5 - Hotfix de midia

## Alteracoes

- Webcam enquadrada sem crop (`contain`).
- Screen share enquadrado sem crop em grade, foco e fullscreen.
- Camera representada por icone pulsante; `AO VIVO` permanece visivel.
- Cursor solicitado como `always` na faixa de screen share quando suportado.
- Electron/Windows mantem o capturer atual do Chromium 150 e solicita `cursor: always` no MediaStreamTrack; o antigo flag `AllowWgcWindowCapturer` foi removido do Chromium e nao e usado.
- Aceleracao de hardware continua ativa por padrao.

## Overrides Desktop

- `GINGA_DISABLE_HARDWARE_ACCELERATION=1`: desativa aceleracao apenas para diagnostico/fallback.
