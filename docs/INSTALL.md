# Instalação do Ginga

Este guia corresponde ao source `0.4.5`.

## Pré-requisitos

- Linux moderno; Debian 13 é a referência do projeto;
- Docker Engine;
- plugin `docker compose`;
- `openssl` para gerar os segredos iniciais;
- DNS/TLS quando a instalação for exposta à Internet.

## Instalação básica

```bash
git clone https://github.com/GabrielBosco/ginga.git
cd ginga
./scripts/init.sh
docker compose up -d --build
```

O `init.sh` cria `.env` somente se ele ainda não existir e gera valores aleatórios para banco, JWT, MFA e LiveKit.

Valide:

```bash
docker compose ps
curl -fsS http://127.0.0.1:3090/api/health
```

## Acesso pela LAN

O padrão é `WEB_BIND=127.0.0.1`. Para publicar diretamente na LAN, ajuste conscientemente no `.env`, por exemplo:

```env
WEB_BIND=0.0.0.0
WEB_PORT=3090
APP_ORIGINS=http://192.168.1.10:3090
GINGA_SERVER_URL=http://192.168.1.10:3090
```

HTTP deve ser tratado como cenário de laboratório/LAN. Para credenciais e mídia em redes não confiáveis, use HTTPS/WSS.

## Produção com Caddy

Preencha os domínios no `.env`:

```env
APP_DOMAIN=ginga.example.com
LIVEKIT_DOMAIN=media.ginga.example.com
GINGA_SERVER_URL=https://ginga.example.com
APP_ORIGINS=https://ginga.example.com
PUBLIC_LIVEKIT_URL=wss://media.ginga.example.com
```

Então:

```bash
docker compose --profile production up -d --build
```

O perfil Caddy pressupõe disponibilidade de `80/TCP` e `443/TCP/UDP` no host.

## Produção sem 80/443 no host

É possível manter a Web em uma porta local e usar um reverse proxy/edge externo. Preserve:

- HTTPS para a aplicação;
- WSS/HTTPS para a sinalização;
- portas WebRTC necessárias ao LiveKit;
- PostgreSQL/Redis sem exposição pública.

## Atualização do source

Em instalações que utilizam o pipeline do projeto, aplique releases com `scripts/apply-update-safe.sh` em vez de copiar arquivos manualmente sobre `/opt/ginga`. O script preserva `.env`, `updates/` e `secrets/`.
