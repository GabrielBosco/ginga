# Ginga Bot SDK para Python

`ginga-bot` e o SDK Python oficial para bots do Ginga. O pacote publicado no PyPI usa o nome **`ginga-bot`** e o modulo Python usa **`gingabot`**.

> O nome `ginga` nao e usado como modulo porque ja existe outro projeto Python com esse namespace no PyPI.

## Instalacao

Quando o pacote estiver publicado no PyPI:

```bash
python -m pip install -U ginga-bot
```

Durante o desenvolvimento a partir do repositorio do Ginga:

```bash
python -m pip install -e ./sdk/python
```

## Primeiro bot

```python
import os
import gingabot

intents = gingabot.Intents.default()
intents.message_content = True

bot = gingabot.Bot(
    command_prefix="!",
    intents=intents,
    server_url=os.getenv("GINGA_SERVER", "http://127.0.0.1"),
)

@bot.event
async def on_ready():
    print(f"Online como {bot.user}")

@bot.command(description="Testa o bot")
async def ping(ctx):
    await ctx.reply("Pong!")

bot.run(os.environ["GINGA_BOT_TOKEN"])
```

Se voce gosta da leitura `ginga.Bot(...)`, pode usar um alias local sem conflitar com o pacote astronomico existente:

```python
import gingabot as ginga

bot = ginga.Bot(...)
```

## Como funciona

O SDK usa:

- REST para buscar recursos e executar acoes explicitas;
- Socket.IO para eventos em tempo real;
- token exclusivo de bot criado no Portal do Desenvolvedor;
- Intents para limitar quais classes de eventos o processo recebe;
- permissoes de instalacao e ACLs do servidor/canal no lado do servidor.

## Intents

```python
intents = gingabot.Intents.default()
intents.message_content = True
intents.voice_states = True
```

`message_content` fica desligado por padrao. Para ler o texto das mensagens, ele precisa estar habilitado no codigo **e** no Portal do Desenvolvedor.

Intents disponiveis no Gateway atual:

- `GUILDS`
- `GUILD_MESSAGES`
- `MESSAGE_CONTENT`
- `VOICE_STATES`

## Eventos

```python
@bot.event
async def on_ready():
    ...

@bot.event
async def on_message(message):
    print(message.author, message.content)

@bot.event
async def on_voice_state_update(payload):
    print(payload)
```

O SDK reconecta o Gateway automaticamente e nao entrega para o handler de mensagem as mensagens produzidas pelo proprio bot.

## Comandos

```python
@bot.command(description="Soma dois numeros")
async def somar(ctx, a: int, b: int):
    await ctx.reply(str(a + b))
```

Os decorators registram os comandos no Ginga. O bot pode aceitar o prefixo configurado e `/comando` quando `accept_slash_commands=True`.

Argumentos basicos recebem conversao automatica para `str`, `int`, `float` e `bool`.

## IDs fixos

Use IDs em integracoes persistentes. Nome de servidor, canal, cargo ou usuario pode mudar.

```python
CANAL_LOGS = "cm123..."
CARGO_STAFF = "cm456..."

@bot.command()
async def ids(ctx):
    channel = bot.get_channel(CANAL_LOGS) or await bot.fetch_channel(CANAL_LOGS)
    role = bot.get_role(CARGO_STAFF) or await bot.fetch_role(ctx.guild_id, CARGO_STAFF)
    await ctx.reply(f"canal={channel.name} cargo={role.name}")
```

Ative **Configuracoes > Desenvolvedor > Modo Desenvolvedor** no cliente para liberar `Copiar ID` nos menus de contexto.

## API de alto nivel

```python
await bot.fetch_guilds()
channel = await bot.fetch_channel(CHANNEL_ID)
role = await bot.fetch_role(GUILD_ID, ROLE_ID)
user = await bot.fetch_user(USER_ID)
member = await bot.fetch_member(GUILD_ID, USER_ID)
message = await bot.send_message(CHANNEL_ID, "Ola!")
```

## Tratamento de erros de comando

```python
@bot.event
async def on_command_error(ctx, error):
    await ctx.reply(f"Nao consegui executar: {error}")
```

Erros HTTP, autenticacao, permissao e rate limit levantam `gingabot.GingaError`. O SDK respeita `Retry-After` em respostas `429` e tenta novamente antes de falhar.

## Seguranca

Nunca coloque o token no codigo, no Git ou no frontend.

Linux/macOS:

```bash
export GINGA_SERVER="https://seu-ginga.exemplo"
export GINGA_BOT_TOKEN="seu_token"
python bot.py
```

PowerShell:

```powershell
$env:GINGA_SERVER="https://seu-ginga.exemplo"
$env:GINGA_BOT_TOKEN="seu_token"
python .\bot.py
```

Se um token vazar, rotacione a credencial imediatamente no Portal do Desenvolvedor.

## Publicacao do SDK

A versao do SDK e independente da versao do servidor Ginga. O primeiro release oficial e `ginga-bot 0.1.0`.

Build local:

```bash
cd sdk/python
python -m pip install -U build twine
python -m build
python -m twine check dist/*
```

A publicacao no PyPI deve ser feita preferencialmente pelo workflow de Trusted Publishing do GitHub, sem armazenar senha ou API token do PyPI no repositorio.
