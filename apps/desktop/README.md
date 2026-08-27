# Ginga Desktop 0.2.0

Cliente Windows/Electron do Ginga.

## Servidor configurável

O endereço inicial do instalador é gravado pelo pipeline de compilação a partir de `GINGA_SERVER_URL` ou `APP_ORIGINS`. Em desenvolvimento, o endereço alternativo é `http://127.0.0.1`.

O usuário pode abrir **Configurar servidor**, testar outro endereço e salvá-lo sem recompilar o aplicativo.

A configuração persistida fica no perfil do usuário Windows em `Ginga/server.json`.

## Segurança do Electron

- `nodeIntegration=false`;
- `contextIsolation=true`;
- `sandbox=true`;
- `webSecurity=true`;
- navegação e novas janelas filtradas;
- `webviews` bloqueados;
- permissões de mídia limitadas ao servidor configurado;
- IPC de configuração e tela limitado às páginas locais autorizadas.

## Atualizador da versão 0.2.0

Antes de aceitar uma atualização, o Desktop:

1. baixa `manifest.json` e `manifest.sig`;
2. valida a assinatura Ed25519 usando `update-public.pem` embutido;
3. confere versão e hash com `latest.yml`;
4. baixa o instalador;
5. calcula SHA-512 localmente;
6. instala somente se todas as verificações passarem.

A chave privada nunca deve ser empacotada no cliente.

## HTTP e HTTPS

HTTP é aceitável apenas para desenvolvimento local ou laboratório isolado. Para uso público, configure o Ginga com HTTPS/WSS.

## Bandeja e notificações

- fechar a janela pode ocultar o Ginga sem encerrar Socket.IO ou chamadas;
- o ícone da bandeja usa os arquivos empacotados em `assets/`;
- clicar no ícone restaura a janela;
- notificações são enviadas por IPC validado para `Electron.Notification`;
- prévia, som e categorias são controlados pelo usuário;
- notificações temporárias são encerradas automaticamente pelo cliente.
