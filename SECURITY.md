# Política de segurança

## Relato de vulnerabilidades

Não publique detalhes de uma vulnerabilidade explorável em uma Issue pública antes de existir correção.

Use o recurso de **Private vulnerability reporting** do GitHub quando ele estiver habilitado no repositório. Se não estiver disponível, entre em contato diretamente com o mantenedor do projeto por um canal privado.

## Segredos

Nunca envie ao repositório:

- `.env`;
- senhas de PostgreSQL/Redis/SMTP;
- tokens de bot/API;
- `secrets/update-signing/private.pem`;
- `.pfx`, `.p12`, `.key`, JKS/keystore privados;
- backups de produção.

A chave `apps/desktop/update-public.pem` é pública por definição e é usada para validação do updater.

Antes de um push:

```bash
./scripts/prepare-github.sh
```

## Instalações públicas

- use HTTPS/WSS;
- não exponha PostgreSQL/Redis;
- mantenha Docker e host atualizados;
- revise CORS/origens;
- limite uploads e armazenamento;
- proteja SMTP e integrações externas;
- preserve e proteja a chave privada do updater.
