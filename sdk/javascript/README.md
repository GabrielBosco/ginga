# Ginga Bot SDK JavaScript/TypeScript 0.4.1

```js
import { GingaBot, Intents } from "@ginga/bot-sdk";
const bot = new GingaBot({ token: process.env.GINGA_BOT_TOKEN, serverUrl: process.env.GINGA_SERVER, intents: Intents.all() });
bot.on("message", async (m) => { if (m.content === "!ping") await bot.sendMessage(m.channelId, "Pong!"); });
await bot.connect();
```
