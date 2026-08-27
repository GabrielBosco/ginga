import os

import ginga
from ginga.ext import commands

TOKEN = os.environ["GINGA_BOT_TOKEN"]
SERVER = os.getenv("GINGA_SERVER", "http://127.0.0.1")

intents = ginga.Intents.default()
intents.message_content = True

bot = commands.Bot(command_prefix="!", intents=intents, server_url=SERVER)


@bot.event
async def on_ready():
    print(f"GingaBot conectado como {bot.user}.")


@bot.command(description="Mostra que o bot esta online")
async def ping(ctx):
    await ctx.reply("Pong! Bot Python conectado ao Ginga.")


@bot.command(description="Repete uma mensagem")
async def falar(ctx, *, texto: str):
    await ctx.send(texto)


@bot.event
async def on_command_error(ctx, error):
    await ctx.reply(f"Nao consegui executar esse comando: {error}")


bot.run(TOKEN)
