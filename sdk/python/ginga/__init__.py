from .client import Client, Context as LegacyContext, GingaError as LegacyGingaError
from .intents import Intents
from .models import Channel, Member, Message, Role, User

__version__ = "2.1.0"

# Client antigo mantido temporariamente para nao quebrar bots Python existentes.
# Novos bots devem usar: from ginga.ext import commands
Context = LegacyContext
GingaError = LegacyGingaError

__all__ = [
    "Channel",
    "Client",
    "Context",
    "GingaError",
    "Intents",
    "Member",
    "Message",
    "Role",
    "User",
]
