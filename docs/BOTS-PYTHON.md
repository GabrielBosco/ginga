# Bots Python no Ginga

O SDK Python oficial do Ginga se chama **Ginga Bot SDK**.

- pacote PyPI: `ginga-bot`
- modulo Python: `gingabot`
- versao inicial do SDK: `0.1.0`
- runtime suportado: Python 3.10+

O nome `ginga` nao e usado como import porque esse namespace ja pertence a outro projeto publicado no ecossistema Python.

## Fluxo recomendado

1. No Ginga, abra **Portal do Desenvolvedor**.
2. Crie um bot.
3. Copie o token exibido uma unica vez.
4. Instale o bot no servidor e escolha apenas as permissoes necessarias.
5. Se o bot precisar ler o texto das mensagens, habilite **Conteudo de mensagens**.
6. Instale o SDK no ambiente Python.
7. Rode o processo do bot fora do frontend do Ginga.

## Instalar

```bash
python -m venv .venv
```

Linux/macOS:

```bash
source .venv/bin/activate
python -m pip install -U ginga-bot
```

Windows PowerShell:

```powershell
.\.venv\Scripts\Activate.ps1
python -m pip install -U ginga-bot
```

Para testar o SDK diretamente de um checkout do Ginga antes da publicacao no PyPI:

```bash
python -m pip install -e ./sdk/python
```

## Bot minimo

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

Tambem e valido:

```python
import gingabot as ginga

bot = ginga.Bot(...)
```

Esse alias e apenas local ao codigo do bot; ele nao instala nem sobrescreve o pacote `ginga` de terceiros.

## Intents

O Gateway atual reconhece:

| Intent | Uso |
| --- | --- |
| `GUILDS` | servidores e metadados basicos |
| `GUILD_MESSAGES` | eventos de mensagem em servidores |
| `MESSAGE_CONTENT` | conteudo textual das mensagens |
| `VOICE_STATES` | presenca e estado em canais de voz |

`MESSAGE_CONTENT` exige duas coisas ao mesmo tempo:

```python
intents.message_content = True
```

e a opcao **Conteudo de mensagens** habilitada no Portal do Desenvolvedor.

## Permissoes e ACL

Intents nao concedem permissao. O servidor continua validando:

- permissoes aprovadas durante a instalacao do bot;
- cargos do bot;
- permissoes especificas do canal;
- acesso efetivo ao recurso solicitado.

Um bot nao consegue usar o SDK para ignorar ACL.

## Eventos

```python
@bot.event
async def on_message(message):
    print(message.author, message.content)

@bot.event
async def on_voice_state_update(payload):
    print(payload)
```

O Gateway usa Socket.IO e o SDK tenta reconectar automaticamente.

## Comandos e argumentos

```python
@bot.command(description="Soma valores")
async def somar(ctx, a: int, b: int):
    await ctx.reply(str(a + b))
```

Tipos basicos sao convertidos automaticamente. Argumentos obrigatorios ausentes e conversoes invalidas geram erros de comando.

```python
@bot.event
async def on_command_error(ctx, error):
    await ctx.reply(f"Erro: {error}")
```

## Buscar recursos por ID

```python
channel = bot.get_channel(CHANNEL_ID) or await bot.fetch_channel(CHANNEL_ID)
role = bot.get_role(ROLE_ID) or await bot.fetch_role(GUILD_ID, ROLE_ID)
user = await bot.fetch_user(USER_ID)
member = await bot.fetch_member(GUILD_ID, USER_ID)
```

Use IDs em configuracoes persistentes. Nomes podem mudar.

## Enviar mensagens

```python
await bot.send_message(CHANNEL_ID, "Backup concluido")
```

Resposta a uma mensagem:

```python
@bot.command()
async def ola(ctx):
    await ctx.reply(f"Ola, {ctx.author.display_name}!")
```

## Rate limit

O SDK respeita `Retry-After` quando a API responde `429` e faz novas tentativas limitadas. Nao crie loops agressivos para contornar os limites do servidor.

## Seguranca

Nunca faca isso:

```python
TOKEN = "token_real_aqui"
```

Prefira variaveis de ambiente ou um gerenciador de segredos.

Se uma credencial aparecer em commit, log ou print publico, rotacione o token no Portal do Desenvolvedor antes de qualquer outra coisa.

## Producao

Para bots permanentes:

- rode em um usuario de sistema separado;
- use HTTPS/WSS externamente;
- configure restart automatico com systemd, Docker ou outro supervisor;
- mantenha logs sem tokens;
- use timeout para integracoes externas;
- mantenha `ginga-bot` atualizado dentro da faixa compativel com seu servidor.

## Desenvolvimento do SDK

O codigo fica em:

```text
sdk/python/gingabot/
```

Build:

```bash
cd sdk/python
python -m pip install -U build twine
python -m build
python -m twine check dist/*
```

A publicacao oficial deve usar PyPI Trusted Publishing pelo GitHub Actions, sem token do PyPI salvo no repositorio.
