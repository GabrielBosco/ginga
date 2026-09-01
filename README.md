<div align="center">
  <img src="apps/web/public/ginga-wordmark.png" alt="Ginga" width="260" />

  <p><strong>Plataforma brasileira, open source e auto-hospedada para comunidades, equipes e grupos.</strong></p>
  <p>Chat em tempo real, voz, vídeo, compartilhamento de tela, moderação, bots e clientes Desktop/Web.</p>

  <p>
    <img alt="Versão" src="https://img.shields.io/badge/versão-0.4.8-5865F2" />
    <img alt="Idioma" src="https://img.shields.io/badge/idioma-pt--BR-009C3B" />
    <img alt="Debian" src="https://img.shields.io/badge/Debian-13-A81D33?logo=debian&logoColor=white" />
    <img alt="Docker" src="https://img.shields.io/badge/Docker-Compose-2496ED?logo=docker&logoColor=white" />
    <img alt="Node.js" src="https://img.shields.io/badge/Node.js-22-339933?logo=nodedotjs&logoColor=white" />
    <img alt="Licença" src="https://img.shields.io/badge/licença-MIT-green" />
  </p>

  <p>
    <a href="docs/INSTALL.md">Instalação</a> ·
    <a href="docs/CONFIGURATION.md">Configuração</a> ·
    <a href="docs/DESKTOP.md">Desktop</a> ·
    <a href="docs/ANDROID.md">Android</a> ·
    <a href="SECURITY.md">Segurança</a> ·
    <a href="CONTRIBUTING.md">Contribuir</a>
  </p>
</div>

---

## Sobre o Ginga

O **Ginga** é uma plataforma de comunicação em tempo real feita para rodar na sua própria infraestrutura. O administrador controla a aplicação, o banco de dados, os uploads e a infraestrutura de voz/vídeo.

> **Versão atual do servidor/Web/Desktop:** `0.4.8`.
>
> O projeto ainda está na série `0.x`; APIs, banco e processos de implantação podem evoluir antes da `1.0.0`.

A documentação oficial deste repositório é mantida em **português do Brasil**.

## Recursos principais

- servidores, categorias e canais de texto/voz;
- mensagens em tempo real, respostas, reações, anexos, fixados e busca;
- amigos, mensagens privadas e chamadas;
- voz, vídeo e compartilhamento de tela via LiveKit/WebRTC;
- modo foco para transmissões, com participantes empilhados e avatares dos espectadores em tempo real;
- cargos, hierarquia, permissões e regras por canal/categoria;
- moderação, timeout, AutoMod e auditoria;
- fóruns, eventos, convites e comunidades;
- 2FA/TOTP, códigos de recuperação e sessões revogáveis;
- redefinição e verificação de conta por e-mail;
- Portal Developer, bots, webhooks e Ginga Bot SDK para Python;
- cliente Web responsivo;
- cliente Desktop Electron para Windows e Linux;
- suporte a avatar, banner e ícone em GIF animado;
- Soundboard por servidor, sincronizado em tempo real na sala de voz, com busca, favoritos, volume e upload moderado;
- Ginga Music em modo Client Edge: fila/clock no servidor e audio reproduzido diretamente do YouTube/SoundCloud em cada Web/Desktop, sem proxy de midia pela infraestrutura Ginga;
- base Android experimental, com ciclo de versão separado.

## Stack

| Camada | Tecnologia |
| --- | --- |
| Web | React 19, TypeScript, Vite |
| API | Node.js 22, Express, Socket.IO, Prisma |
| Banco | PostgreSQL 16 |
| Cache/presença | Redis 7 |
| Voz/vídeo | LiveKit / WebRTC |
| Desktop | Electron |
| Android | WebView nativo experimental |
| Deploy | Docker Compose |
| Edge opcional | Caddy |

## Estrutura do repositório

```text
apps/
├── api/          API, autenticação, permissões e tempo real
├── web/          interface React
├── desktop/      Electron Windows/Linux
└── android/      cliente Android experimental

infra/
├── caddy/        exemplos de entrada HTTPS/LAN
└── livekit/      geração da configuração LiveKit

sdk/
├── python/       SDK oficial ginga-bot / import gingabot
└── javascript/   integração JavaScript

scripts/          inicialização, auditoria, backup e release
updates/          diretório de publicação; binários não são versionados
docs/             documentação técnica e histórico de releases
```

Mais detalhes em [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Início rápido no Debian

Requisitos recomendados para uma instalação pequena/média:

- Debian 13;
- Docker Engine + plugin Docker Compose;
- 4 vCPU;
- 8 GB de RAM;
- armazenamento adequado para banco e uploads.

Clone o projeto:

```bash
git clone https://github.com/GabrielBosco/ginga.git
cd ginga
```

Crie um `.env` seguro a partir do exemplo:

```bash
./scripts/init.sh
```

Suba os serviços:

```bash
docker compose up -d --build
```

Por padrão, a Web fica vinculada a `127.0.0.1:3090`. Valide localmente:

```bash
docker compose ps
curl -fsS http://127.0.0.1:3090/api/health
```

Para LAN ou Internet, revise `.env`, `APP_ORIGINS`, `GINGA_SERVER_URL`, LiveKit e a estratégia de proxy/TLS antes de expor a aplicação. Consulte [docs/INSTALL.md](docs/INSTALL.md) e [docs/CONFIGURATION.md](docs/CONFIGURATION.md).

## Produção / HTTPS

A stack inclui perfis Caddy para cenários em que o host pode publicar `80/TCP` e `443/TCP/UDP`:

```bash
docker compose --profile production up -d --build
```

Configure `APP_DOMAIN`, `LIVEKIT_DOMAIN`, `GINGA_SERVER_URL` e `APP_ORIGINS` antes de ativar o perfil.

Se `80/443` não puderem ser usados diretamente no host, mantenha Web/API protegidos e publique o Ginga por um reverse proxy, NAT ou edge compatível com HTTPS/WSS. Não exponha PostgreSQL ou Redis à Internet.

## Cliente Desktop 0.4.8

O Desktop utiliza a URL embutida no momento do release. O source público usa `127.0.0.1` como fallback de desenvolvimento; `release-win.sh` injeta `GINGA_PUBLIC_URL`/`GINGA_SERVER_URL` no build oficial.

Build Linux x64:

```bash
./build-linux.sh x64
```

Release Linux x64:

```bash
./release-linux.sh 0.4.8 --x64
```

Release Windows + Linux:

```bash
./release-all.sh 0.4.8 --all
```

Targets atuais:

- Windows x64: NSIS `.exe`;
- Linux x64: AppImage, `.deb`, `.rpm`;
- Linux ARM64: AppImage, `.deb`.

**Nunca publique a chave privada do updater.** A chave pública `apps/desktop/update-public.pem` faz parte do cliente e pode ser versionada; `secrets/update-signing/private.pem` não pode entrar no Git.

Consulte [docs/DESKTOP.md](docs/DESKTOP.md) e [docs/LINUX.md](docs/LINUX.md).

## Ginga Bot SDK

O pacote Python oficial é **`ginga-bot`** e o módulo importado é **`gingabot`**:

```bash
python -m pip install -U ginga-bot
```

Exemplo:

```python
import os
import gingabot

bot = gingabot.Bot(
    command_prefix="!",
    intents=gingabot.Intents.default(),
    server_url=os.environ["GINGA_SERVER"],
)

@bot.command(description="Testa o bot")
async def ping(ctx):
    await ctx.reply("Pong!")

bot.run(os.environ["GINGA_BOT_TOKEN"])
```

Veja [docs/BOTS-PYTHON.md](docs/BOTS-PYTHON.md).

## Desenvolvimento e CI

API:

```bash
cd apps/api
npm ci
npx prisma generate
npm run build
```

Web:

```bash
cd apps/web
npm ci
npm run build
```

Antes de enviar código ao GitHub:

```bash
./scripts/prepare-github.sh
```

Esse gate procura arquivos sensíveis, backups internos, artefatos gerados, endpoints específicos de produção, divergência de versões e regressões conhecidas do empacotamento Linux.

## Segurança

- `.env` nunca deve ser commitado;
- a chave privada do updater nunca deve ser commitada;
- PostgreSQL e Redis devem permanecer internos;
- para Internet, use HTTPS/WSS;
- revise uploads, backups e permissões do host;
- não publique vulnerabilidades exploráveis em Issues públicas.

Consulte [SECURITY.md](SECURITY.md) e [docs/HARDENING-DEBIAN13.md](docs/HARDENING-DEBIAN13.md).

## GitHub e releases

O repositório oficial é:

```text
https://github.com/GabrielBosco/ginga
```

Instaladores e pacotes não devem entrar no histórico Git. Use o feed `/updates/` do servidor e/ou **GitHub Releases** para distribuir `.exe`, `.AppImage`, `.deb`, `.rpm` e APKs.

O processo recomendado de atualização do repositório está em [docs/GITHUB.md](docs/GITHUB.md).

## Licença

Distribuído sob a licença [MIT](LICENSE).

### Hotfix de viewport (0.4.8 R2)

A interface recebeu um passe extra para notebooks e monitores mais baixos/largos (ex.: 1366x768 e 1600x900). O objetivo e fazer o Ginga caber corretamente em zoom 100% no navegador e no Desktop, sem a necessidade de reduzir o zoom para 90%.

### Responsividade global — FULL FIX R3

A 0.4.8 R3 consolida o layout responsivo em zoom 100% no Web e no Desktop. Alem do shell, a camada final cobre chat, voz, transmissao, Soundboard, configuracoes, modais, amigos, comunidades, forum/eventos, perfis e formularios.
