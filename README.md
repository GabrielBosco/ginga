<div align="center">
  <img src="apps/web/public/ginga-wordmark.png" alt="Ginga" width="260" />

  <p><strong>Plataforma brasileira, de código aberto e auto-hospedada para comunidades, equipes e grupos.</strong></p>
  <p>Chat em tempo real, voz, vídeo, compartilhamento de tela, moderação, bots, Desktop e Android em uma única stack.</p>

  <p>
    <img alt="Versão" src="https://img.shields.io/badge/versão-0.3.1-5865F2" />
    <img alt="Idioma" src="https://img.shields.io/badge/idioma-pt--BR-009C3B" />
    <img alt="Debian" src="https://img.shields.io/badge/Debian-13-A81D33?logo=debian&logoColor=white" />
    <img alt="Docker" src="https://img.shields.io/badge/Docker-Compose-2496ED?logo=docker&logoColor=white" />
    <img alt="Node.js" src="https://img.shields.io/badge/Node.js-22-339933?logo=nodedotjs&logoColor=white" />
    <img alt="Licença" src="https://img.shields.io/badge/licença-MIT-green" />
  </p>

  <p>
    <a href="docs/INSTALL.md">Instalação</a> ·
    <a href="docs/CONFIGURATION.md">Configuração</a> ·
    <a href="docs/ANDROID.md">Android</a> ·
    <a href="docs/DESKTOP.md">Desktop</a> ·
    <a href="SECURITY.md">Segurança</a> ·
    <a href="CONTRIBUTING.md">Contribuir</a>
  </p>
</div>

---

## Sobre o Ginga

O **Ginga** é uma plataforma de comunicação em tempo real feita para rodar na sua própria infraestrutura. A ideia é oferecer uma experiência moderna de comunidade sem obrigar o administrador a depender de um serviço central de terceiros.

Você hospeda, administra e escolhe onde os dados ficam.

> **Versão atual:** `0.3.1`. O projeto ainda está na série `0.x`; APIs, estrutura do banco e alguns fluxos de implantação podem evoluir antes da `1.0.0`.

A documentação oficial do projeto é mantida em **português do Brasil**.

## Recursos principais

- servidores, categorias e canais de texto e voz;
- mensagens em tempo real, respostas, reações, anexos, fixados e busca;
- mensagens privadas, amigos e chamadas particulares;
- voz, vídeo e compartilhamento de tela com LiveKit/WebRTC;
- status Online, Ausente, Ocupado e Invisível;
- Push-to-Talk configurável por tecla ou botão do mouse no Desktop;
- presença de jogos e sobreposição durante a partida no cliente Desktop;
- cargos, hierarquia, permissões e regras por canal/categoria;
- expulsão, banimento temporário ou permanente, timeout, AutoMod e auditoria;
- convites, comunidades públicas, fóruns, eventos e anúncios;
- autenticação em duas etapas (TOTP), códigos de recuperação e sessões revogáveis;
- redefinição segura de senha por e-mail;
- Portal do Desenvolvedor, bots, webhooks e **Ginga Bot SDK** para Python;
- Ginga Music opcional;
- cliente Web responsivo;
- cliente Windows com Electron;
- base Android experimental para testes.

## Tecnologias

| Camada | Tecnologia |
| --- | --- |
| Interface Web | React 19, TypeScript e Vite |
| API | Node.js 22, Express, Socket.IO e Prisma |
| Banco de dados | PostgreSQL 16 |
| Cache e presença | Redis 7 |
| Voz e vídeo | LiveKit / WebRTC |
| Desktop | Electron |
| Android | WebView nativo para a fase inicial |
| Implantação | Docker Compose |
| Entrada HTTP/HTTPS | Caddy incluído na stack de produção |

Não é necessário configurar um proxy externo para a instalação padrão do projeto.

## Requisitos recomendados

Para uma comunidade pequena ou média, um bom ponto de partida é:

- **Debian 13 minimal**;
- Docker Engine + plugin Docker Compose;
- 4 vCPU;
- 8 GB de RAM;
- 20 GB ou mais de armazenamento;
- conexão estável e boa banda de upload para voz/vídeo;
- DNS público para uso HTTPS na Internet.

Outras distribuições Linux modernas também podem funcionar, mas o Debian 13 é a referência oficial da documentação.

## Início rápido — rede local

```bash
git clone https://github.com/SEU_USUARIO/ginga.git
cd ginga

./scripts/init.sh
docker compose up -d --build
```

Acesse:

```text
http://IP_DO_SERVIDOR
```

A aplicação Web usa **porta 80** no modo local. A sinalização direta do LiveKit usa `7880/TCP` nesse cenário.

Confira o estado:

```bash
docker compose ps
curl -fsS http://127.0.0.1/api/health
```

## Produção — Internet + HTTPS

Crie dois registros DNS apontando para o servidor, por exemplo:

```text
ginga.exemplo.com        -> IP público do servidor
midia.ginga.exemplo.com  -> IP público do servidor
```

Gere o ambiente:

```bash
./scripts/init.sh --production ginga.exemplo.com midia.ginga.exemplo.com
```

Revise o `.env`, principalmente SMTP, proprietário global e limites de armazenamento. Depois suba:

```bash
docker compose -f docker-compose.production.yml up -d --build
```

A instalação padrão publica a aplicação em **80/TCP e 443/TCP** e cuida do HTTPS dentro da própria stack.

Acesse:

```text
https://ginga.exemplo.com
```

### Portas públicas de produção

| Porta | Protocolo | Uso |
| ---: | :---: | --- |
| 80 | TCP | HTTP e emissão/renovação do certificado |
| 443 | TCP | Web, API e WSS |
| 443 | UDP | HTTP/3, quando disponível |
| 7881 | TCP | alternativa WebRTC/ICE por TCP |
| 7882 | UDP | mídia WebRTC/ICE por UDP |
| 3478 | UDP | TURN, quando habilitado |

`PostgreSQL`, `Redis`, API interna e a sinalização interna do LiveKit **não devem ser publicados diretamente na Internet**.

## Configuração inicial

O arquivo `.env` contém segredos e **nunca deve entrar no Git**. O script `./scripts/init.sh` gera os principais valores aleatórios automaticamente.

Para definir o proprietário global:

```env
PLATFORM_OWNER_USERNAME=seu_usuario
ALLOW_FIRST_USER_PLATFORM_OWNER=false
```

Para exigir verificação de e-mail:

```env
EMAIL_VERIFICATION_REQUIRED=true
EMAIL_PROVIDER=smtp
SMTP_HOST=smtp.exemplo.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=usuario
SMTP_PASSWORD=senha-de-app-ou-senha-smtp
EMAIL_FROM="Ginga <nao-responda@exemplo.com>"
```

Todas as opções estão em [docs/CONFIGURATION.md](docs/CONFIGURATION.md).

## Ginga Bot SDK

O SDK oficial de bots usa o pacote **`ginga-bot`** e o modulo Python **`gingabot`**. O namespace `ginga` nao e utilizado porque ja pertence a outro projeto no ecossistema Python.

```bash
pip install -U ginga-bot
```

```python
import gingabot

bot = gingabot.Bot(command_prefix="!")
```

Durante o desenvolvimento pelo proprio repositorio:

```bash
pip install -e ./sdk/python
```

Consulte [docs/BOTS-PYTHON.md](docs/BOTS-PYTHON.md) para intents, eventos, comandos, IDs, seguranca e publicacao do SDK.

## Estrutura do projeto

```text
apps/
├── api/          API, autenticação, permissões e tempo real
├── web/          interface React responsiva
├── desktop/      cliente Windows/Electron
└── android/      cliente Android experimental

infra/
├── caddy/        entrada HTTP/HTTPS da produção
└── livekit/      configuração de voz e vídeo

sdk/
├── python/       SDK oficial para bots Python
└── javascript/   exemplos e integração Node.js

scripts/          inicialização, backup, auditoria e release
updates/          arquivos públicos do atualizador Desktop
```

Veja [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Cliente Desktop

O cliente Desktop adiciona recursos nativos que o navegador não consegue oferecer da mesma forma, como presença de jogos, sobreposição, integração com bandeja e Push-to-Talk global.

Para compilar o instalador Windows:

```bash
./build-win.sh
```

Saída esperada:

```text
apps/desktop/dist/Ginga-Setup-0.3.1-x64.exe
```

A chave privada do atualizador nunca deve entrar no Git. Veja [docs/DESKTOP.md](docs/DESKTOP.md).

## Android

A `0.3.1` inclui uma base Android experimental voltada a testes. O aplicativo utiliza a interface responsiva do servidor Ginga e exige HTTPS para conexões externas.

O APK de teste pode ser gerado pelo fluxo **Gerar APK Android** no GitHub Actions ou localmente:

```bash
./scripts/build-android.sh https://ginga.exemplo.com
```

Veja [docs/ANDROID.md](docs/ANDROID.md).

## Backup

```bash
./scripts/backup.sh
```

Mantenha pelo menos uma cópia dos backups fora do próprio servidor.

## Desenvolvimento

API:

```bash
cd apps/api
npm install
npm run build
```

Web:

```bash
cd apps/web
npm install
npm run build
```

Antes de abrir um Pull Request ou publicar uma cópia do projeto:

```bash
./scripts/prepare-github.sh
```

O verificador procura segredos, `.env`, chaves privadas, dependências vendorizadas, binários e configurações específicas de uma instalação.

## Segurança

O Ginga utiliza limites de requisição, cabeçalhos de segurança, validação de upload, sessões revogáveis, 2FA/TOTP, isolamento de containers e outras proteções na aplicação.

Para uma instalação pública, **HTTPS/WSS deve ser considerado obrigatório**. Credenciais, tokens e sinalização não devem trafegar em HTTP puro pela Internet.

Não publique vulnerabilidades exploráveis em Issues. Consulte [SECURITY.md](SECURITY.md).

Para reforço do host Debian, consulte [docs/HARDENING-DEBIAN13.md](docs/HARDENING-DEBIAN13.md).

## Roteiro de desenvolvimento

A série `0.x` está focada em estabilidade, voz, experiência mobile, cliente Desktop, moderação, segurança e facilidade de auto-hospedagem.

- correções compatíveis: `0.2.1`, `0.2.2`;
- novas funcionalidades relevantes: `0.3.0`, `0.4.0`;
- primeira versão considerada estável: `1.0.0`.

## Contribuindo

Relatos de bugs reproduzíveis, ideias bem explicadas e Pull Requests pequenos são bem-vindos. Leia [CONTRIBUTING.md](CONTRIBUTING.md).

## Licença

Distribuído sob a licença [MIT](LICENSE).

O arquivo `LICENSE` mantém o texto jurídico oficial da licença MIT. Componentes de terceiros continuam sujeitos às respectivas licenças.
