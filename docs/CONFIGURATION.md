# Configuração

Use `.env.example` como referência e mantenha o `.env` real fora do Git.

## Banco e cache

```env
POSTGRES_DB=ginga
POSTGRES_USER=ginga
POSTGRES_PASSWORD=...
REDIS_PASSWORD=...
```

## Autenticação

```env
JWT_SECRET=...
JWT_EXPIRES_IN=12h
MFA_ENCRYPTION_KEY=... # 64 caracteres hexadecimais
PWNED_PASSWORD_CHECK=true
ALLOW_REGISTRATION=true
EMAIL_VERIFICATION_REQUIRED=false
```

`JWT_SECRET`, senhas e chaves devem ser exclusivos por instalação.

## URLs

```env
APP_ORIGINS=https://ginga.example.com
GINGA_SERVER_URL=https://ginga.example.com
PASSWORD_RESET_BASE_URL=https://ginga.example.com
```

`APP_ORIGINS` aceita origens separadas por vírgula.

## LiveKit

```env
LIVEKIT_API_KEY=...
LIVEKIT_API_SECRET=...
LIVEKIT_INTERNAL_URL=http://livekit:7880
PUBLIC_LIVEKIT_URL=wss://media.ginga.example.com
LIVEKIT_USE_EXTERNAL_IP=true
LIVEKIT_TURN_ENABLED=true
```

A topologia de NAT/firewall deve ser ajustada ao ambiente. O Ginga não deve inventar IP público no source; a configuração é responsabilidade da instalação.

## E-mail

SMTP:

```env
EMAIL_PROVIDER=smtp
EMAIL_FROM="Ginga <noreply@example.com>"
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=...
SMTP_PASSWORD=...
```

Ou Resend:

```env
EMAIL_PROVIDER=resend
EMAIL_FROM="Ginga <noreply@example.com>"
RESEND_API_KEY=...
```

## Uploads e limites

```env
MAX_UPLOAD_MB=50
MAX_USER_STORAGE_MB=2048
```

A API também possui rate limits configuráveis no `.env.example`.

## Proprietário global

```env
PLATFORM_OWNER_USERNAME=admin
ALLOW_FIRST_USER_PLATFORM_OWNER=false
```

Defina explicitamente o usuário quando quiser evitar que a primeira conta criada assuma automaticamente privilégios globais.
