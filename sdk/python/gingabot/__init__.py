"""SDK Python oficial do Ginga para bots e automacoes em tempo real."""

from .ext.commands import (
    BadArgument,
    Bot,
    CommandError,
    CommandInvokeError,
    CommandNotFound,
    Context,
    GingaError,
    MissingRequiredArgument,
)
from .intents import Intents
from .models import Channel, Member, Message, Role, User
from .version import __version__

__all__ = [
    "BadArgument",
    "Bot",
    "Channel",
    "CommandError",
    "CommandInvokeError",
    "CommandNotFound",
    "Context",
    "GingaError",
    "Intents",
    "Member",
    "Message",
    "MissingRequiredArgument",
    "Role",
    "User",
    "__version__",
]
