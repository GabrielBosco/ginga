from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Callable
import logging
import threading

import requests
import socketio


class GingaError(RuntimeError):
    pass


@dataclass
class Context:
    client: "Client"
    message: dict[str, Any]

    @property
    def content(self) -> str:
        return str(self.message.get("content", ""))

    @property
    def channel_id(self) -> str:
        return str(self.message.get("channelId", ""))

    @property
    def author(self) -> dict[str, Any]:
        return dict(self.message.get("author") or {})

    def reply(self, content: str) -> dict[str, Any]:
        return self.client.send_message(self.channel_id, content)


class Client:
    """Cliente simples para bots Ginga.

    O token e criado no Developer Portal Web. O SDK usa HTTP para comandos/acoes
    e Socket.IO para eventos em tempo real.
    """

    def __init__(self, token: str, server_url: str = "http://127.0.0.1", *, command_prefix: str = "/") -> None:
        if not token:
            raise ValueError("token obrigatorio")
        self.token = token
        self.server_url = server_url.rstrip("/")
        self.command_prefix = command_prefix
        self.http = requests.Session()
        self.http.headers.update({"Authorization": f"Bot {token}", "Content-Type": "application/json"})
        self.socket = socketio.Client(reconnection=True, logger=False, engineio_logger=False)
        self._events: dict[str, Callable[..., Any]] = {}
        self._commands: dict[str, tuple[str, Callable[[Context], Any]]] = {}
        self._stop = threading.Event()
        self._bot_user_id: str | None = None
        self.log = logging.getLogger("ginga.bot")
        self._wire_socket()

    def _wire_socket(self) -> None:
        @self.socket.event
        def connect() -> None:
            self.log.info("Conectado ao Ginga")
            try:
                me = self.me()
                self._bot_user_id = str((me.get("application") or {}).get("botUser", {}).get("id") or "") or None
            except Exception as exc:
                self.log.warning("Nao foi possivel carregar a identidade do bot: %s", exc)
            self._sync_commands()
            callback = self._events.get("ready") or self._events.get("on_ready")
            if callback:
                callback()

        @self.socket.event
        def disconnect() -> None:
            callback = self._events.get("disconnect") or self._events.get("on_disconnect")
            if callback:
                callback()

        @self.socket.on("message:new")
        def on_message(message: dict[str, Any]) -> None:
            if self._bot_user_id and str(message.get("authorId", "")) == self._bot_user_id:
                return
            callback = self._events.get("message") or self._events.get("on_message")
            if callback:
                callback(message)
            content = str(message.get("content", "")).strip()
            if not content.startswith(self.command_prefix):
                return
            command_name = content[len(self.command_prefix):].split(maxsplit=1)[0].lower()
            command = self._commands.get(command_name)
            if command:
                command[1](Context(self, message))

    def _request(self, method: str, path: str, **kwargs: Any) -> Any:
        response = self.http.request(method, f"{self.server_url}{path}", timeout=15, **kwargs)
        if response.status_code >= 400:
            try:
                detail = response.json().get("error")
            except Exception:
                detail = response.text
            raise GingaError(f"HTTP {response.status_code}: {detail or 'erro desconhecido'}")
        if response.status_code == 204:
            return None
        return response.json()

    def event(self, func: Callable[..., Any]) -> Callable[..., Any]:
        self._events[func.__name__] = func
        return func

    def command(self, name: str, description: str = "Comando Ginga") -> Callable[[Callable[[Context], Any]], Callable[[Context], Any]]:
        normalized = name.strip().lower()
        if not normalized or len(normalized) > 32:
            raise ValueError("nome de comando invalido")

        def decorator(func: Callable[[Context], Any]) -> Callable[[Context], Any]:
            self._commands[normalized] = (description[:100], func)
            return func
        return decorator

    def _sync_commands(self) -> None:
        for name, (description, _func) in self._commands.items():
            try:
                self._request("PUT", f"/api/bot/commands/{name}", json={"description": description})
            except Exception as exc:
                self.log.warning("Nao foi possivel registrar /%s: %s", name, exc)

    def me(self) -> dict[str, Any]:
        return self._request("GET", "/api/bot/me")

    def guilds(self) -> list[dict[str, Any]]:
        payload = self._request("GET", "/api/bot/guilds")
        return list(payload.get("guilds", []))

    def send_message(self, channel_id: str, content: str) -> dict[str, Any]:
        if not channel_id:
            raise ValueError("channel_id obrigatorio")
        payload = self._request("POST", f"/api/bot/channels/{channel_id}/messages", json={"content": content})
        return dict(payload.get("message") or payload)

    def run(self) -> None:
        self.socket.connect(
            self.server_url,
            auth={
                "botToken": self.token,
                "intents": ["GUILDS", "GUILD_MESSAGES", "MESSAGE_CONTENT", "VOICE_STATES"],
                "sdk": "ginga.py-legacy"
            },
            transports=["websocket", "polling"]
        )
        try:
            self.socket.wait()
        finally:
            if self.socket.connected:
                self.socket.disconnect()
