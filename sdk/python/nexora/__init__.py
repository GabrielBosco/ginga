"""Compatibilidade com o nome antigo do SDK.

Novos bots devem usar `from ginga import Client`.
"""
from ginga import Client, Context, GingaError

NexoraError = GingaError

__all__ = ["Client", "Context", "GingaError", "NexoraError"]
