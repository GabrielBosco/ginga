# Instalação do Ginga

Este guia cobre uma instalação limpa do Ginga `0.2.0` em Linux usando Docker Compose.

## Sistema recomendado

A referência oficial do projeto é **Debian 13 minimal**. Outras distribuições Linux modernas podem funcionar, mas os exemplos abaixo consideram Debian.

Para uma comunidade pequena ou média:

- 4 vCPU;
- 8 GB de RAM;
- 20 GB ou mais de disco;
- conexão estável e boa banda de upload;
- Docker Engine e plugin Docker Compose.

Voz e vídeo dependem principalmente da banda disponível e da quantidade de participantes simultâneos.

## 1. Preparar o Debian 13

Atualize o sistema:

```bash
sudo apt update
sudo apt full-upgrade -y
sudo apt install -y ca-certificates curl git openssl
```

Instale Docker Engine e Docker Compose conforme a documentação oficial do Docker. Depois confirme:

```bash
docker --version
docker compose version
```

## 2. Clonar o projeto

```bash
git clone https://github.com/SEU_USUARIO/ginga.git
cd ginga
```

## 3. Instalação local ou em LAN

Gere o `.env`:

```bash
./scripts/init.sh
```

Suba a stack:

```bash
docker compose up -d --build
```

Confira:

```bash
docker compose ps
curl -fsS http://127.0.0.1/api/health
```

Acesse:

```text
http://IP_DO_SERVIDOR
```

### Portas do modo local

- `80/TCP`: Web/API;
- `7880/TCP`: sinalização LiveKit;
- `7881/TCP`: WebRTC/ICE TCP;
- `7882/UDP`: WebRTC/ICE UDP;
- `3478/UDP`: TURN quando habilitado.

## 4. Produção com HTTPS

Crie dois registros DNS apontando para o IP público do host:

```text
ginga.exemplo.com
midia.ginga.exemplo.com
```

Gere o ambiente de produção:

```bash
./scripts/init.sh --production ginga.exemplo.com midia.ginga.exemplo.com
```

Abra o `.env` e configure no mínimo:

- `PLATFORM_OWNER_USERNAME`;
- SMTP, se `EMAIL_VERIFICATION_REQUIRED=true`;
- `GITHUB_REPOSITORY_URL`, caso queira exibir o link do código na interface;
- limites de upload e armazenamento.

Suba:

```bash
docker compose -f docker-compose.production.yml up -d --build
```

A stack publica a aplicação em **80/443**. Web, API, PostgreSQL, Redis e a sinalização interna do LiveKit permanecem isolados na rede Docker conforme a configuração de produção.

### Portas públicas esperadas

```text
80/TCP
443/TCP
443/UDP
7881/TCP
7882/UDP
3478/UDP  # somente se TURN estiver habilitado
```

Não publique PostgreSQL (`5432`) ou Redis (`6379`) diretamente na Internet.

## 5. Proprietário global

Antes do cadastro da conta que administrará toda a instalação:

```env
PLATFORM_OWNER_USERNAME=meu_usuario
ALLOW_FIRST_USER_PLATFORM_OWNER=false
```

O valor deve corresponder exatamente ao nome de usuário usado no cadastro.

## 6. E-mail

Exemplo SMTP:

```env
EMAIL_VERIFICATION_REQUIRED=true
EMAIL_PROVIDER=smtp
SMTP_HOST=smtp.exemplo.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=usuario
SMTP_PASSWORD=senha
EMAIL_FROM="Ginga <nao-responda@exemplo.com>"
```

Não publique senha SMTP em `.env.example`, documentação, Issue ou commit.

## 7. Atualizar o Ginga

Faça backup:

```bash
./scripts/backup.sh
```

Atualize o código:

```bash
git pull --ff-only
docker compose -f docker-compose.production.yml build
docker compose -f docker-compose.production.yml up -d
```

Confira os logs:

```bash
docker compose -f docker-compose.production.yml logs --tail=200 api web livekit
```

## 8. Backup

```bash
./scripts/backup.sh
```

Os backups ficam em `backups/<data-hora>/` e são ignorados pelo Git.

Mantenha pelo menos uma cópia fora do servidor.
