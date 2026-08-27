"""Compatibilidade com imports antigos `nexora.client`."""
from ginga.client import Client, Context, GingaError

NexoraError = GingaError

__all__ = ["Client", "Context", "GingaError", "NexoraError"]
