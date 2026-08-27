import asyncio
import unittest
from types import SimpleNamespace

import gingabot
from gingabot.ext.commands import Command, MissingRequiredArgument


class PublicSurfaceTests(unittest.TestCase):
    def test_public_surface(self):
        self.assertEqual(gingabot.__version__, "0.1.1")
        self.assertTrue(gingabot.Bot)
        self.assertTrue(gingabot.Intents)
        self.assertTrue(gingabot.Message)

    def test_intents(self):
        self.assertEqual(
            gingabot.Intents.default().to_gateway(),
            ["GUILDS", "GUILD_MESSAGES"],
        )
        self.assertEqual(
            gingabot.Intents.all().to_gateway(),
            ["GUILDS", "GUILD_MESSAGES", "MESSAGE_CONTENT", "VOICE_STATES"],
        )


class CommandTests(unittest.IsolatedAsyncioTestCase):
    async def test_converts_arguments(self):
        received = {}

        async def callback(ctx, numero: int, ativo: bool, *, texto: str):
            received.update(numero=numero, ativo=ativo, texto=texto)
            return "ok"

        command = Command(callback, name="teste", description="Teste")
        ctx = SimpleNamespace(args_text='42 sim "ola mundo"')
        result = await command.invoke(ctx)

        self.assertEqual(result, "ok")
        self.assertEqual(received, {"numero": 42, "ativo": True, "texto": "ola mundo"})

    async def test_missing_required_argument(self):
        async def callback(ctx, numero: int):
            return numero

        command = Command(callback, name="teste", description="Teste")
        ctx = SimpleNamespace(args_text="")
        with self.assertRaises(MissingRequiredArgument):
            await command.invoke(ctx)


class GatewayCompatibilityTests(unittest.IsolatedAsyncioTestCase):
    async def test_bot_ready_accepts_extra_socketio_arguments(self):
        bot = gingabot.Bot(command_prefix="!")

        async def fake_me():
            return {
                "application": {
                    "botUser": {
                        "id": "bot-user-1",
                        "username": "TesteBot",
                    }
                }
            }

        async def fake_fetch_guilds():
            return []

        async def fake_sync():
            return None

        dispatched = []

        async def fake_dispatch(name, *args):
            dispatched.append((name, args))

        bot.me = fake_me
        bot.fetch_guilds = fake_fetch_guilds
        bot._sync_application_commands = fake_sync
        bot._dispatch = fake_dispatch

        handler = bot.socket.handlers["/"]["bot:ready"]
        await handler(
            {"applicationId": "app-1", "intents": ["GUILDS"]},
            {"transport": "websocket"},
        )

        self.assertTrue(bot._ready.is_set())
        self.assertEqual(bot.user.id, "bot-user-1")
        self.assertIn(("ready", ()), dispatched)


if __name__ == "__main__":
    unittest.main()
