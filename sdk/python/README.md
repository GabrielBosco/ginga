# ginga.py — SDK oficial para Python

Bots criados para o Ginga usam **Python** como ambiente oficial do SDK. A interface foi desenhada para ser familiar a quem já conhece bibliotecas de bots modernas, sem tentar reproduzir protocolos de serviços de terceiros.

## Instalação

```bash
python -m venv .venv
.venv\Scripts\activate
pip install -e ./sdk/python
```

## Primeiro bot

```python
import os
import ginga
from ginga.ext import commands

intents = ginga.Intents.default()
intents.message_content = True

bot = commands.Bot(
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

O decorator sincroniza o comando com o **Portal do Desenvolvedor**. Por padrão, o Ginga aceita o prefixo configurado e também `/comando` para integrar com o seletor de comandos da interface.

Para receber texto, habilite **Conteúdo de mensagens** na configuração do bot e defina `intents.message_content = True` no código.

## Intents

```python
intents = ginga.Intents.default()
intents.message_content = True   # necessário para ler texto e comandos por prefixo
intents.voice_states = True      # eventos de presença/estado de voz
```

Use somente os intents necessários. `message_content` permanece desligado por padrão.

## Segredos

Nunca coloque token do bot ou chave de API diretamente no arquivo Python. Use `.env`, variáveis de ambiente ou um gerenciador de segredos.

## IDs fixos e Modo Desenvolvedor

Bots não devem depender do nome de um recurso. Nomes podem mudar; IDs permanecem estáveis durante a vida do objeto.

Ative **Configurações > Desenvolvedor > Modo Desenvolvedor** no cliente. O menu de contexto passa a mostrar **Copiar ID** para servidor, canal, categoria, usuário, conversa, mensagem e cargo.

```python
CANAL_LOGS = "cm123..."
CARGO_STAFF = "cm456..."
USUARIO_DONO = "cm789..."

@bot.command()
async def ids(ctx):
    channel = bot.get_channel(CANAL_LOGS) or await bot.fetch_channel(CANAL_LOGS)
    role = bot.get_role(CARGO_STAFF) or await bot.fetch_role(ctx.guild_id, CARGO_STAFF)
    owner = await bot.fetch_user(USUARIO_DONO)
    await ctx.reply(f"canal={channel.name} cargo={role.name} usuario={owner.display_name}")
```

Renomear um canal, cargo ou usuário não exige alteração no bot quando a integração usa IDs.
