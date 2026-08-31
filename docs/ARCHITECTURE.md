# Arquitetura

## Fluxo principal

```text
Navegador / Desktop / Android
            |
            v
          Web
            |
       HTTP + Socket.IO
            |
            v
           API  -------- PostgreSQL
            |  \\------- Redis
            |
            +---------- LiveKit
```

## Serviços Docker

- `postgres`: catálogo persistente;
- `redis`: cache/presença e suporte ao LiveKit;
- `livekit-config`: gera a configuração de runtime;
- `livekit`: mídia WebRTC;
- `api`: autenticação, regras, dados e tempo real;
- `web`: frontend e publicação de `/updates/`;
- `caddy` / `caddy-lan`: perfis opcionais de entrada.

## Código

- `apps/api`: Node.js/TypeScript/Prisma;
- `apps/web`: React/TypeScript/Vite;
- `apps/desktop`: Electron;
- `apps/android`: base Android experimental;
- `sdk/python`: Ginga Bot SDK;
- `infra`: Caddy/LiveKit;
- `scripts`: manutenção, auditoria e releases.

## Dados que não pertencem ao Git

- `.env`;
- `secrets/`;
- banco e volumes Docker;
- uploads;
- backups;
- `updates/` gerados;
- `node_modules` e `dist`;
- backups de hotfix/release.
