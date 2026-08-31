# Ginga Desktop 1.5.0

Cliente Electron do Ginga.

## Servidor configuravel

O endereco do cliente oficial e gravado pelo pipeline de build a partir de `GINGA_SERVER_URL`/`APP_ORIGINS`. Em desenvolvimento, o fallback e `http://127.0.0.1:3090`. O usuario final nao altera o servidor pelo Desktop; isso evita clientes presos a endpoints antigos e configuracoes divergentes.

O valor persistido fica no perfil do usuario Windows em `Ginga/server.json`.

## Seguranca Electron

- `nodeIntegration=false`
- `contextIsolation=true`
- `sandbox=true`
- `webSecurity=true`
- navegacao e novas janelas filtradas
- webviews bloqueados
- permissoes de midia limitadas ao servidor configurado
- IPC de configuracao/tela limitado a paginas locais do app

## Atualizador 1.5.0+

Antes de aceitar uma atualizacao, o Desktop:

1. baixa `manifest.json` e `manifest.sig`;
2. valida Ed25519 usando `update-public.pem` embutido;
3. confere versao/hash contra `latest.yml`;
4. baixa o instalador;
5. calcula SHA-512 local;
6. instala somente se tudo conferir.

A chave privada nunca deve ser empacotada no cliente.

## IP puro / HTTP

Para o piloto atual, o Electron permite APIs de midia para **somente a origem HTTP escolhida**. Isso nao adiciona criptografia ao trafego. Para exposicao publica definitiva, use HTTPS/WSS.


## Bandeja e notificacoes 1.5.0

- fechar a janela oculta o Ginga sem encerrar Socket.IO/chamadas;
- o tray usa `assets/icon.ico`/`icon.png` empacotados;
- clique no tray restaura a janela;
- notificacoes sao enviadas via IPC validado para `Electron.Notification`;
- preview, som e categorias de notificacao sao controlados pelo usuario na interface;
- cada toast e fechado automaticamente pelo cliente em aproximadamente 5 segundos.
