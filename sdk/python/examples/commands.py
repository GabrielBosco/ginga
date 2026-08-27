"""Exemplos de comandos tipados do Ginga Bot SDK."""

import os

import gingabot


intents = gingabot.Intents.default()
intents.message_content = True
bot = gingabot.Bot(command_prefix="!", intents=intents, server_url=os.environ["GINGA_SERVER"])


@bot.command(description="Soma dois numeros")
async def somar(ctx, a: int, b: int):
    await ctx.reply(str(a + b))


@bot.command(description="Repete um texto")
async def falar(ctx, *, texto: str):
    await ctx.send(texto)


@bot.command(description="Mostra informacoes basicas do contexto")
async def onde(ctx):
    await ctx.reply(f"guild={ctx.guild_id} channel={ctx.channel_id} user={ctx.author.id}")


bot.run(os.environ["GINGA_BOT_TOKEN"])
