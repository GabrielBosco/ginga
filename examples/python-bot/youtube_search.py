import os

import ginga
from ginga.ext import commands
from googleapiclient.discovery import build

TOKEN = os.environ["GINGA_BOT_TOKEN"]
SERVER = os.getenv("GINGA_SERVER", "http://127.0.0.1")
YOUTUBE_API_KEY = os.environ["YOUTUBE_API_KEY"]

intents = ginga.Intents.default()
intents.message_content = True
bot = commands.Bot(command_prefix="!", intents=intents, server_url=SERVER)


@bot.command(description="Pesquisa um video no YouTube")
async def ytsearch(ctx, *, query: str):
    youtube = build("youtube", "v3", developerKey=YOUTUBE_API_KEY)
    request = youtube.search().list(
        q=query,
        part="id,snippet",
        maxResults=1,
        type="video",
    )
    response = request.execute()
    items = response.get("items", [])
    if not items:
        await ctx.reply("Nao encontrei nenhum video.")
        return

    video_id = items[0]["id"]["videoId"]
    await ctx.reply(f"https://www.youtube.com/watch?v={video_id}")


bot.run(TOKEN)
