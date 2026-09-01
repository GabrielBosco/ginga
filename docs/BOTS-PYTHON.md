# Ginga Bot SDK para Python

O **Ginga Bot SDK** e o SDK Python oficial para criar bots conectados ao Ginga.

- pacote no PyPI: `ginga-bot`
- modulo Python: `gingabot`
- versao atual do SDK: `0.1.0`
- Python suportado: `3.10+`
- transporte em tempo real: Socket.IO
- chamadas explicitas: REST

> O import `ginga` nao e usado pelo SDK oficial porque esse namespace ja pertence a outro projeto no ecossistema Python. No Ginga, o import oficial e `gingabot`.

## Quickstart: primeiro bot em poucos minutos

### 1. Crie o bot no Ginga

No cliente Ginga:

1. abra **Ginga Developer**;
2. entre em **Bots Python**;
3. clique em **Novo bot Python**;
4. informe nome e descricao;
5. escolha o preset inicial de permissoes;
6. crie o bot;
7. copie o token exibido.

O token aparece apenas no momento da criacao ou rotacao. O servidor armazena somente o hash da credencial.

### 2. Instale o bot em um servidor

Ainda no Portal Developer:

1. selecione o bot;
2. escolha as permissoes que ele realmente precisa;
3. gere/abra o fluxo de instalacao;
4. escolha o servidor;
5. revise as permissoes;
6. conclua a autorizacao.

Intents e permissoes sao coisas diferentes:

- **Intent** define quais eventos o processo quer receber;
- **Permissao** define o que o bot pode fazer;
- **ACL do canal** continua valendo normalmente.

## Instalando o SDK

### Requisito

Confirme a versao do Python:

```bash
python --version
```

O SDK exige **Python 3.10 ou superior**.

### Windows PowerShell

Recomendado usar ambiente virtual:

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
python -m pip install -U ginga-bot
```

Confirme a instalacao:

```powershell
python -c "import gingabot; print(gingabot.__version__)"
```

Esperado para esta documentacao:

```text
0.1.0
```

### Linux

```bash
python3 -m venv .venv
source .venv/bin/activate
python -m pip install --upgrade pip
python -m pip install -U ginga-bot
```

Valide:

```bash
python -c "import gingabot; print(gingabot.__version__)"
```

## Se o pip disser `No matching distribution found`

Primeiro confirme:

```bash
python --version
```

Depois verifique se o `pip` esta usando um mirror, indice corporativo ou configuracao diferente do PyPI oficial:

```bash
python -m pip config list
```

Para consultar explicitamente o PyPI oficial:

```bash
python -m pip index versions ginga-bot --index-url https://pypi.org/simple
```

Para instalar forçando o indice oficial e ignorando cache local:

```bash
python -m pip install --no-cache-dir --index-url https://pypi.org/simple ginga-bot
```

No Windows o mesmo comando funciona no PowerShell e no Prompt de Comando.

> Use `--index-url https://pypi.org/simple` como diagnostico quando sua maquina estiver configurada para outro indice. Em um Python/pip padrao, `python -m pip install -U ginga-bot` deve ser suficiente.

## 3. Configure as credenciais

Nunca coloque o token diretamente no codigo-fonte.

### Windows PowerShell

```powershell
$env:GINGA_SERVER="https://seu-servidor-ginga.exemplo"
$env:GINGA_BOT_TOKEN="cole_o_token_do_bot_aqui"
```

### Linux

```bash
export GINGA_SERVER="https://seu-servidor-ginga.exemplo"
export GINGA_BOT_TOKEN="cole_o_token_do_bot_aqui"
```

`GINGA_SERVER` deve apontar para a URL base do Ginga, sem adicionar `/api` manualmente.

## 4. Crie o primeiro bot

Crie `bot.py`:

```python
import os
import gingabot

intents = gingabot.Intents.default()
intents.message_content = True

bot = gingabot.Bot(
    command_prefix="!",
    intents=intents,
    server_url=os.environ["GINGA_SERVER"],
)

@bot.event
async def on_ready():
    print(f"Online como {bot.user}")

@bot.command(description="Testa o bot")
async def ping(ctx):
    await ctx.reply("Pong!")

bot.run(os.environ["GINGA_BOT_TOKEN"])
```

Execute:

```bash
python bot.py
```

No Ginga, envie em um canal acessivel ao bot:

```text
!ping
```

Resposta esperada:

```text
Pong!
```

## `MESSAGE_CONTENT`: detalhe importante

Para comandos de texto como `!ping`, duas configuracoes precisam estar ativas ao mesmo tempo.

No codigo:

```python
intents = gingabot.Intents.default()
intents.message_content = True
```

No **Portal Developer** do bot:

```text
Conteudo de mensagens = habilitado
```

Se o codigo pedir `MESSAGE_CONTENT` mas o Portal Developer nao permitir, o SDK conecta, mas avisa no log que o conteudo das mensagens nao sera entregue.

## Alias opcional

O import oficial e:

```python
import gingabot
```

Se voce prefere escrever `ginga.Bot(...)`, use apenas um alias local:

```python
import gingabot as ginga

bot = ginga.Bot(...)
```

Isso nao instala nem substitui o pacote Python chamado `ginga`.

## Intents disponiveis

```python
intents = gingabot.Intents.default()
```

Intents atuais:

| Propriedade Python | Gateway | Finalidade |
| --- | --- | --- |
| `guilds` | `GUILDS` | servidores, canais e metadados basicos |
| `guild_messages` | `GUILD_MESSAGES` | eventos de mensagens em servidores |
| `message_content` | `MESSAGE_CONTENT` | conteudo textual das mensagens |
| `voice_states` | `VOICE_STATES` | estados e presenca em voz |

Exemplos:

```python
intents = gingabot.Intents.none()
```

```python
intents = gingabot.Intents.default()
```

```python
intents = gingabot.Intents.all()
```

Prefira habilitar somente o necessario.

## Eventos

### Bot pronto

```python
@bot.event
async def on_ready():
    print(bot.user)
```

### Conexao e desconexao

```python
@bot.event
async def on_connect():
    print("Gateway conectado")

@bot.event
async def on_disconnect():
    print("Gateway desconectado")
```

### Nova mensagem

```python
@bot.event
async def on_message(message):
    print(message.author, message.content)
```

O SDK ignora no handler de mensagem as mensagens produzidas pelo proprio bot, evitando loops basicos de resposta.

### Estado de voz

```python
@bot.event
async def on_voice_state_update(payload):
    print(payload)
```

Exige `voice_states = True` e acesso efetivo ao servidor/canal.

## Comandos

### Comando simples

```python
@bot.command()
async def ola(ctx):
    await ctx.reply(f"Ola, {ctx.author.display_name}!")
```

### Nome e descricao

```python
@bot.command(name="status", description="Mostra se o bot esta online")
async def meu_status(ctx):
    await ctx.reply("Tudo certo por aqui.")
```

### Aliases

```python
@bot.command(aliases=("p", "latencia"))
async def ping(ctx):
    await ctx.reply("Pong!")
```

### Argumentos tipados

```python
@bot.command(description="Soma dois numeros")
async def somar(ctx, a: int, b: int):
    await ctx.reply(str(a + b))
```

Tipos basicos convertidos automaticamente:

- `str`
- `int`
- `float`
- `bool`

Exemplo:

```text
!somar 10 25
```

Resposta:

```text
35
```

### Texto restante como um unico argumento

Use argumento keyword-only:

```python
@bot.command()
async def falar(ctx, *, texto: str):
    await ctx.send(texto)
```

Exemplo:

```text
!falar deploy concluido com sucesso
```

## Tratamento de erros de comando

```python
@bot.event
async def on_command_error(ctx, error):
    await ctx.reply(f"Nao consegui executar: {error}")
```

Classes publicas importantes:

```python
gingabot.GingaError
gingabot.CommandError
gingabot.CommandNotFound
gingabot.MissingRequiredArgument
gingabot.BadArgument
gingabot.CommandInvokeError
```

Erros HTTP, autenticacao, permissao e rate limit sao representados por `GingaError` ou subclasses relacionadas ao comando.

## Enviar mensagens sem comando

```python
await bot.send_message(CHANNEL_ID, "Backup concluido")
```

Responder uma mensagem:

```python
@bot.command()
async def confirmar(ctx):
    await ctx.reply("Recebido.")
```

## Consultar recursos por ID

Use IDs em configuracoes persistentes. Nomes podem mudar.

```python
channel = bot.get_channel(CHANNEL_ID) or await bot.fetch_channel(CHANNEL_ID)
role = bot.get_role(ROLE_ID) or await bot.fetch_role(GUILD_ID, ROLE_ID)
user = await bot.fetch_user(USER_ID)
member = await bot.fetch_member(GUILD_ID, USER_ID)
```

No cliente Ginga, habilite **Configuracoes -> Desenvolvedor -> Modo Desenvolvedor** para liberar as opcoes de copiar IDs.

## API de alto nivel

Metodos disponiveis na versao atual:

```python
await bot.me()
await bot.fetch_guilds()
await bot.fetch_channel(CHANNEL_ID)
await bot.fetch_role(GUILD_ID, ROLE_ID)
await bot.fetch_user(USER_ID)
await bot.fetch_member(GUILD_ID, USER_ID)
await bot.send_message(CHANNEL_ID, "Ola")
```

Caches locais:

```python
bot.guilds
bot.get_channel(CHANNEL_ID)
bot.get_role(ROLE_ID)
```

## Prefixo e comandos `/`

Por padrao:

```python
bot = gingabot.Bot(command_prefix="!")
```

O SDK tambem aceita `/comando` quando `accept_slash_commands=True`, que e o padrao atual.

Para desabilitar:

```python
bot = gingabot.Bot(
    command_prefix="!",
    accept_slash_commands=False,
)
```

## Sincronizacao de comandos

Decorators `@bot.command(...)` sao sincronizados com a aplicacao no Ginga quando o bot fica pronto.

Para controlar manualmente:

```python
bot = gingabot.Bot(
    command_prefix="!",
    sync_commands=False,
)
```

## Rate limit e reconexao

O SDK:

- usa reconexao automatica do cliente Socket.IO;
- trata `429 Too Many Requests`;
- respeita `Retry-After`;
- limita novas tentativas;
- usa timeout nas chamadas HTTP.

Nao implemente loops agressivos para contornar rate limit.

## Seguranca do token

Nunca faca isso:

```python
TOKEN = "token_real_aqui"
```

Nunca envie token para:

- GitHub;
- frontend;
- screenshot;
- mensagem de chat;
- log de aplicacao;
- imagem Docker publica;
- arquivo versionado.

Se um token vazar:

1. abra o Portal Developer;
2. selecione o bot;
3. rotacione o token;
4. atualize o secret no ambiente do bot;
5. reinicie o processo;
6. verifique logs e commits que possam conter a credencial antiga.

## Producao

Para um bot 24/7:

- use usuario de sistema dedicado;
- use ambiente virtual ou container;
- mantenha HTTPS/WSS para acesso externo;
- use variaveis de ambiente ou secret manager;
- configure restart automatico;
- mantenha logs sem credenciais;
- configure timeout para APIs externas;
- aplique menor privilegio;
- monitore falhas de conexao;
- mantenha `ginga-bot` atualizado.

### Exemplo de systemd

Arquivo `/etc/systemd/system/ginga-meu-bot.service`:

```ini
[Unit]
Description=Meu bot do Ginga
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=gingabot
WorkingDirectory=/opt/meu-bot
Environment=GINGA_SERVER=https://seu-servidor-ginga.exemplo
EnvironmentFile=/etc/ginga/meu-bot.env
ExecStart=/opt/meu-bot/.venv/bin/python /opt/meu-bot/bot.py
Restart=on-failure
RestartSec=5
NoNewPrivileges=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
```

Proteja o arquivo de secrets:

```bash
install -d -m 750 /etc/ginga
install -m 600 /dev/null /etc/ginga/meu-bot.env
```

Conteudo:

```text
GINGA_BOT_TOKEN=token_aqui
```

Depois:

```bash
systemctl daemon-reload
systemctl enable --now ginga-meu-bot
systemctl status ginga-meu-bot
```

## Diagnostico rapido

### `ModuleNotFoundError: No module named 'gingabot'`

Confirme que o `pip` e o `python` sao do mesmo ambiente:

```bash
python -m pip show ginga-bot
python -c "import sys; print(sys.executable)"
```

Evite instalar com um `pip` e executar com outro Python.

### `No matching distribution found for ginga-bot`

Confirme Python `3.10+` e teste o indice oficial:

```bash
python -m pip install --no-cache-dir --index-url https://pypi.org/simple ginga-bot
```

### `HTTP 401`

Token ausente, invalido ou rotacionado. Copie/rotacione a credencial no Portal Developer e atualize `GINGA_BOT_TOKEN`.

### `HTTP 403`

O bot autenticou, mas nao possui permissao efetiva para a operacao. Revise:

1. permissoes solicitadas;
2. instalacao no servidor;
3. cargo do bot;
4. ACL do canal.

### Bot conecta mas `!ping` nao responde

Revise:

1. `intents.message_content = True` no codigo;
2. **Conteudo de mensagens** habilitado no Portal Developer;
3. `VIEW_CHANNELS`, `READ_HISTORY` e `SEND_MESSAGES` conforme o uso;
4. bot instalado no servidor correto;
5. canal acessivel ao bot;
6. prefixo correto.

### Bot fica reconectando

Confira:

- URL em `GINGA_SERVER`;
- HTTPS/WSS e proxy reverso;
- disponibilidade da API;
- WebSocket liberado no proxy/firewall;
- logs do processo do bot;
- logs da API do Ginga.

## Desenvolvimento do proprio SDK

Codigo-fonte:

```text
sdk/python/gingabot/
```

Instalacao editavel:

```bash
python -m pip install -e ./sdk/python
```

Testes:

```bash
cd sdk/python
python -m unittest discover -s tests -v
```

Build:

```bash
cd sdk/python
python -m pip install -U build twine
python -m build
python -m twine check dist/*
```

## Publicacao no PyPI

A versao do SDK e independente da versao do servidor Ginga.

Exemplo:

```text
Servidor Ginga: 0.4.7
Ginga Bot SDK: 0.1.0
```

A publicacao oficial usa GitHub Actions + PyPI Trusted Publishing. Nao salve senha nem API token do PyPI no repositorio.

Workflow:

```text
.github/workflows/python-sdk-publish.yml
```

Tag:

```bash
git tag -a sdk-python-v0.1.0 -m "Ginga Bot SDK 0.1.0"
git push origin sdk-python-v0.1.0
```

Releases do PyPI sao imutaveis: um arquivo de `0.1.0` que ja foi publicado nao pode ser sobrescrito. Mudancas no SDK exigem uma nova versao, por exemplo `0.1.1`.

Consulte tambem:

```text
sdk/python/README.md
sdk/python/PUBLISHING.md
sdk/python/examples/
```
