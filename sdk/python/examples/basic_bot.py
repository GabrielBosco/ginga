"""Bot minimo usando o Ginga Bot SDK."""

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


@bot.command(description="Testa a conexao do bot")
async def ping(ctx):
    await ctx.reply("Pong!")


@bot.event
async def on_command_error(ctx, error):
    await ctx.reply(f"Nao consegui executar: {error}")


bot.run(os.environ["GINGA_BOT_TOKEN"])
