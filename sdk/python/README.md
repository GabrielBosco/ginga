# Ginga Bot SDK

SDK Python oficial para bots do Ginga.

```bash
python -m pip install -U ginga-bot
```

```python
import gingabot
```

- distribuicao PyPI: `ginga-bot`
- modulo: `gingabot`
- Python: `3.10+`
- versao atual: `0.1.0`

> O modulo `ginga` nao e usado porque esse namespace ja pertence a outro projeto Python. O import oficial deste SDK e `gingabot`.

## Quickstart

Crie um bot no **Ginga Developer -> Bots Python**, copie o token, instale o bot em um servidor e habilite apenas as permissoes/intents necessarias.

### Windows PowerShell

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
python -m pip install -U ginga-bot
python -c "import gingabot; print(gingabot.__version__)"
```

### Linux

```bash
python3 -m venv .venv
source .venv/bin/activate
python -m pip install --upgrade pip
python -m pip install -U ginga-bot
python -c "import gingabot; print(gingabot.__version__)"
```

Se sua maquina usa outro indice/mirror do pip:

```bash
python -m pip install --no-cache-dir --index-url https://pypi.org/simple ginga-bot
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

Variaveis no PowerShell:

```powershell
$env:GINGA_SERVER="https://seu-servidor-ginga.exemplo"
$env:GINGA_BOT_TOKEN="seu_token"
python .\bot.py
```

Linux:

```bash
export GINGA_SERVER="https://seu-servidor-ginga.exemplo"
export GINGA_BOT_TOKEN="seu_token"
python bot.py
```

## MESSAGE_CONTENT

Comandos baseados em mensagens precisam de duas configuracoes:

```python
intents.message_content = True
```

E no Portal Developer:

```text
Conteudo de mensagens = habilitado
```

## Comandos

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

## Eventos

```python
@bot.event
async def on_message(message):
    print(message.author, message.content)

@bot.event
async def on_voice_state_update(payload):
    print(payload)
```

## Recursos por ID

```python
channel = bot.get_channel(CHANNEL_ID) or await bot.fetch_channel(CHANNEL_ID)
role = bot.get_role(ROLE_ID) or await bot.fetch_role(GUILD_ID, ROLE_ID)
user = await bot.fetch_user(USER_ID)
member = await bot.fetch_member(GUILD_ID, USER_ID)
```

Use IDs em configuracoes persistentes. Nomes podem mudar.

## Tratamento de erros

```python
@bot.event
async def on_command_error(ctx, error):
    await ctx.reply(f"Nao consegui executar: {error}")
```

O SDK expoe `GingaError` e erros especificos de comandos.

## Rate limit e reconexao

O cliente:

- reconecta o Gateway automaticamente;
- respeita `Retry-After` em `429`;
- limita retries;
- usa timeout nas chamadas REST.

## Seguranca

Nunca versione tokens.

Use variavel de ambiente, secret manager, Docker Secret ou arquivo protegido fora do repositorio.

Se o token vazar, rotacione imediatamente no Portal Developer.

## Documentacao completa

No repositorio principal:

```text
docs/BOTS-PYTHON.md
```

Exemplos:

```text
sdk/python/examples/
```

Publicacao/manutencao:

```text
sdk/python/PUBLISHING.md
```

## Desenvolvimento local

```bash
python -m pip install -e ./sdk/python
```

Testes:

```bash
cd sdk/python
python -m unittest discover -s tests -v
```
