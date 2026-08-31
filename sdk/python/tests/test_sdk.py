import asyncio
import unittest
from types import SimpleNamespace

import gingabot
from gingabot.ext.commands import Command, MissingRequiredArgument


class PublicSurfaceTests(unittest.TestCase):
    def test_public_surface(self):
        self.assertEqual(gingabot.__version__, "0.1.0")
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


if __name__ == "__main__":
    unittest.main()
