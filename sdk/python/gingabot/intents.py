from __future__ import annotations

from dataclasses import dataclass


@dataclass(slots=True)
class Intents:
    """Eventos que o bot deseja receber do Gateway do Ginga.

    O modelo segue a mesma ideia de plataformas de bots maduras: o bot declara
    apenas os grupos de eventos que realmente usa. ``message_content`` fica
    desligado por padrao porque libera o conteudo das mensagens para o processo
    do bot.
    """

    guilds: bool = True
    guild_messages: bool = True
    message_content: bool = False
    voice_states: bool = False

    @classmethod
    def none(cls) -> "Intents":
        return cls(guilds=False, guild_messages=False, message_content=False, voice_states=False)

    @classmethod
    def default(cls) -> "Intents":
        return cls()

    @classmethod
    def all(cls) -> "Intents":
        return cls(guilds=True, guild_messages=True, message_content=True, voice_states=True)

    def to_gateway(self) -> list[str]:
        values: list[str] = []
        if self.guilds:
            values.append("GUILDS")
        if self.guild_messages:
            values.append("GUILD_MESSAGES")
        if self.message_content:
            values.append("MESSAGE_CONTENT")
        if self.voice_states:
            values.append("VOICE_STATES")
        return values
