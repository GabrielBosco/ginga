# Configuração

O Ginga usa um arquivo `.env` na raiz do projeto. O arquivo real é ignorado pelo Git; publique apenas os exemplos fornecidos no repositório.

## Aplicação

| Variável | Uso |
| --- | --- |
| `GINGA_RELEASE_VERSION` | Versão anunciada pela API |
| `GINGA_SERVER_URL` | URL pública principal |
| `APP_ORIGINS` | Origens permitidas pelo CORS, separadas por vírgula |
| `PASSWORD_RESET_BASE_URL` | Base dos links de redefinição de senha |
| `MAX_UPLOAD_MB` | Limite por arquivo enviado |
| `MAX_USER_STORAGE_MB` | Cota de armazenamento por usuário |
| `ALLOW_REGISTRATION` | Habilita ou desabilita novos cadastros |

## Autenticação e segurança

| Variável | Uso |
| --- | --- |
| `JWT_SECRET` | Segredo usado na assinatura das sessões |
| `JWT_EXPIRES_IN` | Tempo de expiração do JWT |
| `MFA_ENCRYPTION_KEY` | Chave hexadecimal de 32 bytes para proteger TOTP e códigos de recuperação |
| `PWNED_PASSWORD_CHECK` | Consulta Pwned Passwords usando k-anonymity |
| `PLATFORM_OWNER_USERNAME` | Nome de usuário do proprietário global |
| `ALLOW_FIRST_USER_PLATFORM_OWNER` | Promove automaticamente a primeira conta; mantenha `false` em instalações públicas |

`MFA_ENCRYPTION_KEY` deve possuir exatamente 64 caracteres hexadecimais. `./scripts/init.sh` gera uma chave válida automaticamente.

## Banco de dados e cache

| Variável | Uso |
| --- | --- |
| `POSTGRES_DB` | Nome do banco PostgreSQL |
| `POSTGRES_USER` | Usuário PostgreSQL |
| `POSTGRES_PASSWORD` | Senha PostgreSQL |
| `REDIS_PASSWORD` | Senha do Redis |

PostgreSQL e Redis não precisam de portas publicadas no host.

## LiveKit

| Variável | Uso |
| --- | --- |
| `LIVEKIT_API_KEY` | Chave interna do LiveKit |
| `LIVEKIT_API_SECRET` | Segredo interno do LiveKit |
| `PUBLIC_LIVEKIT_URL` | Endpoint utilizado pelos clientes |
| `LIVEKIT_USE_EXTERNAL_IP` | Faz o LiveKit anunciar o IP público descoberto |
| `LIVEKIT_NODE_IP` | IP manual quando `LIVEKIT_USE_EXTERNAL_IP=false` |
| `LIVEKIT_TCP_PORT` | ICE/TCP, padrão `7881` |
| `LIVEKIT_UDP_PORT` | ICE/UDP, padrão `7882` |
| `LIVEKIT_TURN_ENABLED` | Habilita TURN/UDP embutido |
| `LIVEKIT_TURN_UDP_PORT` | Porta TURN/UDP, padrão `3478` |

Exemplo local:

```env
PUBLIC_LIVEKIT_URL=ws://localhost:7880
LIVEKIT_USE_EXTERNAL_IP=false
LIVEKIT_NODE_IP=127.0.0.1
```

Exemplo de produção:

```env
PUBLIC_LIVEKIT_URL=wss://midia.ginga.exemplo.com
LIVEKIT_USE_EXTERNAL_IP=true
LIVEKIT_NODE_IP=
```

## HTTPS

No compose de produção:

```env
APP_DOMAIN=ginga.exemplo.com
LIVEKIT_DOMAIN=midia.ginga.exemplo.com
APP_ORIGINS=https://ginga.exemplo.com
GINGA_SERVER_URL=https://ginga.exemplo.com
PUBLIC_LIVEKIT_URL=wss://midia.ginga.exemplo.com
```

Os nomes DNS devem resolver para o host da instalação.

## E-mail

O Ginga suporta SMTP. Se a verificação de e-mail estiver ativa e o SMTP não estiver configurado, novos cadastros não conseguirão concluir a validação.

```env
EMAIL_VERIFICATION_REQUIRED=true
EMAIL_PROVIDER=smtp
SMTP_HOST=smtp.exemplo.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=
SMTP_PASSWORD=
EMAIL_FROM="Ginga <nao-responda@exemplo.com>"
```

## Integrações opcionais

`YOUTUBE_API_KEY`, `SOUNDCLOUD_CLIENT_ID` e `SOUNDCLOUD_CLIENT_SECRET` são opcionais e podem ser usados pelo Ginga Music quando configurados.
