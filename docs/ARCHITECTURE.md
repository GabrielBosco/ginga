# Arquitetura

## Visão geral

```text
                  Internet / rede local
                         |
               +---------+---------+
               |                   |
            Web/API             mídia WebRTC
            80/443              7881/TCP
               |                7882/UDP
               |                3478/UDP
               v                   |
         +-------------+           v
         | Web / borda |      +-----------+
         | React/Nginx |      | LiveKit   |
         +------+------+      +-----+-----+
                |                   |
        +-------+-------+-----------+
        |               |
        v               v
   +---------+       +-------+
   | API     |       | Redis |
   | Ginga   |       +-------+
   +----+----+
        |
        v
   +------------+
   | PostgreSQL |
   +------------+
```

Em produção, a sinalização do LiveKit permanece interna à stack. Os clientes usam WSS pelo domínio de mídia configurado.

## `apps/web`

Aplicação React/TypeScript compilada pelo Vite e servida pelo Nginx. O mesmo serviço encaminha `/api`, `/uploads` e `/socket.io` para a API dentro da rede Docker.

## `apps/api`

API Node.js/Express responsável por autenticação, comunidades, mensagens, permissões, moderação, integrações e emissão de tokens LiveKit. Socket.IO mantém os eventos em tempo real.

## PostgreSQL

Armazena usuários, servidores, canais, mensagens, permissões, auditoria e demais entidades persistentes.

## Redis

Usado em operações de baixa latência e por componentes da implantação do LiveKit. Não deve ser publicado diretamente no host.

## LiveKit

Servidor SFU/WebRTC usado para voz, vídeo e compartilhamento de tela. Em produção, a sinalização fica atrás do endpoint HTTPS/WSS e as portas de mídia necessárias são publicadas diretamente.

## Cliente Desktop

O Electron carrega a instalação Ginga configurada e adiciona integrações nativas como sobreposição, presença de jogos, atalhos globais e atualização automática.

## Cliente Android

A fase inicial usa uma camada Android nativa com `WebView` seguro sobre a interface responsiva. O objetivo é evoluir gradualmente recursos específicos de celular sem duplicar toda a aplicação Web.
