from __future__ import annotations

import asyncio
import inspect
import logging
import shlex
from dataclasses import dataclass
from typing import Any, Awaitable, Callable, Iterable, Sequence, get_args, get_origin

import aiohttp
import socketio

from ..intents import Intents
from ..models import Channel, Member, Message, Role, User
from ..version import __version__

CommandCallback = Callable[..., Any]
EventCallback = Callable[..., Any]


class GingaError(RuntimeError):
    pass


class CommandError(GingaError):
    pass


class CommandNotFound(CommandError):
    pass


class MissingRequiredArgument(CommandError):
    def __init__(self, parameter: str) -> None:
        super().__init__(f"Argumento obrigatorio ausente: {parameter}")
        self.parameter = parameter


class BadArgument(CommandError):
    pass


class CommandInvokeError(CommandError):
    def __init__(self, original: BaseException) -> None:
        super().__init__(str(original))
        self.original = original


@dataclass(slots=True)
class Context:
    bot: "Bot"
    message: Message
    invoked_with: str
    prefix: str
    args_text: str

    @property
    def author(self) -> User:
        return self.message.author

    @property
    def channel_id(self) -> str:
        return self.message.channel_id

    @property
    def guild_id(self) -> str | None:
        return self.message.guild_id

    async def send(self, content: str) -> Message:
        return await self.bot.send_message(self.channel_id, content)

    async def reply(self, content: str) -> Message:
        return await self.bot.send_message(self.channel_id, content, reply_to_id=self.message.id)


def _is_optional(annotation: Any) -> tuple[bool, Any]:
    origin = get_origin(annotation)
    args = get_args(annotation)
    if origin is None or not args:
        return False, annotation
    none_type = type(None)
    if none_type in args and len(args) == 2:
        return True, args[0] if args[1] is none_type else args[1]
    return False, annotation


def _convert_argument(raw: str, annotation: Any, parameter: str) -> Any:
    optional, target = _is_optional(annotation)
    if raw == "" and optional:
        return None
    if target in (inspect.Parameter.empty, str, Any):
        return raw
    try:
        if target is int:
            return int(raw)
        if target is float:
            return float(raw)
        if target is bool:
            lowered = raw.strip().lower()
            if lowered in {"1", "true", "sim", "yes", "on"}:
                return True
            if lowered in {"0", "false", "nao", "não", "no", "off"}:
                return False
            raise ValueError("booleano invalido")
        return target(raw)
    except Exception as exc:
        raise BadArgument(f"Nao foi possivel converter '{parameter}': {raw}") from exc


class Command:
    def __init__(self, callback: CommandCallback, *, name: str, description: str, aliases: Iterable[str] = ()) -> None:
        self.callback = callback
        self.name = name.strip().lower()
        self.description = description.strip()[:100] or "Comando Ginga"
        self.aliases = tuple(alias.strip().lower() for alias in aliases if alias.strip())
        if not self.name or len(self.name) > 32 or not all(ch.isalnum() or ch in "_-" for ch in self.name):
            raise ValueError("nome de comando invalido")

    async def invoke(self, ctx: Context) -> Any:
        signature = inspect.signature(self.callback)
        parameters = list(signature.parameters.values())
        if not parameters:
            raise CommandInvokeError(TypeError("O primeiro parametro do comando deve ser ctx"))

        command_params = parameters[1:]
        try:
            tokens = shlex.split(ctx.args_text, posix=True) if ctx.args_text.strip() else []
        except ValueError as exc:
            raise BadArgument("Aspas ou argumentos invalidos") from exc

        args: list[Any] = [ctx]
        kwargs: dict[str, Any] = {}
        cursor = 0

        for parameter in command_params:
            if parameter.kind is inspect.Parameter.VAR_POSITIONAL:
                while cursor < len(tokens):
                    args.append(_convert_argument(tokens[cursor], parameter.annotation, parameter.name))
                    cursor += 1
                continue

            if parameter.kind is inspect.Parameter.KEYWORD_ONLY:
                raw = " ".join(tokens[cursor:]).strip()
                cursor = len(tokens)
                if not raw and parameter.default is inspect.Parameter.empty:
                    raise MissingRequiredArgument(parameter.name)
                if not raw:
                    kwargs[parameter.name] = parameter.default
                else:
                    kwargs[parameter.name] = _convert_argument(raw, parameter.annotation, parameter.name)
                continue

            if cursor >= len(tokens):
                if parameter.default is inspect.Parameter.empty:
                    raise MissingRequiredArgument(parameter.name)
                args.append(parameter.default)
                continue

            args.append(_convert_argument(tokens[cursor], parameter.annotation, parameter.name))
            cursor += 1

        if cursor < len(tokens):
            raise BadArgument("Argumentos demais para este comando")

        try:
            result = self.callback(*args, **kwargs)
            if inspect.isawaitable(result):
                return await result
            return result
        except CommandError:
            raise
        except Exception as exc:
            raise CommandInvokeError(exc) from exc


class Bot:
    """Cliente oficial para bots Ginga, com API inspirada no estilo do discord.py.

    O Ginga nao implementa o protocolo do Discord. A semelhanca fica apenas na
    ergonomia para desenvolvedores Python: ``Bot``, decorators, ``Context`` e
    ``Intents``.
    """

    def __init__(
        self,
        command_prefix: str | Sequence[str] = "!",
        *,
        intents: Intents | None = None,
        server_url: str = "http://127.0.0.1",
        sync_commands: bool = True,
        accept_slash_commands: bool = True,
    ) -> None:
        prefixes = (command_prefix,) if isinstance(command_prefix, str) else tuple(command_prefix)
        if not prefixes or any(not prefix for prefix in prefixes):
            raise ValueError("command_prefix invalido")
        self.command_prefixes = prefixes
        self.intents = intents or Intents.default()
        self.server_url = server_url.rstrip("/")
        self.sync_commands = sync_commands
        self.accept_slash_commands = accept_slash_commands
        self.log = logging.getLogger("ginga.bot")
        self.socket = socketio.AsyncClient(reconnection=True, logger=False, engineio_logger=False)
        self._events: dict[str, EventCallback] = {}
        self._commands: dict[str, Command] = {}
        self._token: str | None = None
        self._http: aiohttp.ClientSession | None = None
        self._ready = asyncio.Event()
        self._channel_guild: dict[str, str] = {}
        self._channels: dict[str, Channel] = {}
        self._roles: dict[str, Role] = {}
        self._guilds: list[dict[str, Any]] = []
        self.user: User | None = None
        self.application: dict[str, Any] | None = None
        self._wire_socket()

    @property
    def guilds(self) -> list[dict[str, Any]]:
        return list(self._guilds)

    def guild_id_for_channel(self, channel_id: str) -> str | None:
        return self._channel_guild.get(channel_id)

    def get_channel(self, channel_id: str) -> Channel | None:
        """Retorna um canal ja conhecido pelo cache usando o ID fixo."""
        return self._channels.get(str(channel_id))

    def get_role(self, role_id: str) -> Role | None:
        """Retorna um cargo ja conhecido pelo cache usando o ID fixo."""
        return self._roles.get(str(role_id))

    def event(self, func: EventCallback) -> EventCallback:
        name = func.__name__
        if name.startswith("on_"):
            name = name[3:]
        self._events[name] = func
        return func

    def command(
        self,
        name: str | None = None,
        *,
        description: str | None = None,
        aliases: Iterable[str] = (),
    ) -> Callable[[CommandCallback], CommandCallback]:
        def decorator(func: CommandCallback) -> CommandCallback:
            command_name = (name or func.__name__).strip().lower()
            command_description = (description or inspect.getdoc(func) or f"Comando {command_name}").splitlines()[0]
            command = Command(func, name=command_name, description=command_description, aliases=aliases)
            for key in (command.name, *command.aliases):
                if key in self._commands:
                    raise ValueError(f"comando duplicado: {key}")
                self._commands[key] = command
            return func
        return decorator

    def get_command(self, name: str) -> Command | None:
        return self._commands.get(name.strip().lower())

    async def wait_until_ready(self) -> None:
        await self._ready.wait()

    async def _dispatch(self, event_name: str, *args: Any) -> None:
        callback = self._events.get(event_name)
        if callback is None:
            return
        try:
            result = callback(*args)
            if inspect.isawaitable(result):
                await result
        except Exception:
            self.log.exception("Falha em on_%s", event_name)

    async def _request(self, method: str, path: str, **kwargs: Any) -> Any:
        if not self._token:
            raise GingaError("Bot ainda nao foi iniciado")
        if self._http is None or self._http.closed:
            self._http = aiohttp.ClientSession(
                headers={"Authorization": f"Bot {self._token}", "Accept": "application/json"},
                timeout=aiohttp.ClientTimeout(total=15),
            )
        for attempt in range(3):
            async with self._http.request(method, f"{self.server_url}{path}", **kwargs) as response:
                if response.status == 429 and attempt < 2:
                    retry_after = response.headers.get("Retry-After", "1")
                    try:
                        delay = max(0.25, min(float(retry_after), 15.0))
                    except ValueError:
                        delay = 1.0
                    await response.read()
                    await asyncio.sleep(delay)
                    continue
                if response.status >= 400:
                    try:
                        payload = await response.json()
                        detail = payload.get("error") if isinstance(payload, dict) else None
                    except Exception:
                        detail = await response.text()
                    raise GingaError(f"HTTP {response.status}: {detail or 'erro desconhecido'}")
                if response.status == 204:
                    return None
                return await response.json()
        raise GingaError("Rate limit persistente ao acessar a API do Ginga")

    async def me(self) -> dict[str, Any]:
        return await self._request("GET", "/api/bot/me")

    async def fetch_guilds(self) -> list[dict[str, Any]]:
        payload = await self._request("GET", "/api/bot/guilds")
        guilds = list(payload.get("guilds") or [])
        self._guilds = guilds
        self._channel_guild.clear()
        self._channels.clear()
        self._roles.clear()
        for guild in guilds:
            guild_id = str(guild.get("id") or "")
            for raw_channel in guild.get("channels") or []:
                if not isinstance(raw_channel, dict):
                    continue
                channel = Channel.from_payload(raw_channel, guild_id=guild_id)
                if channel.id:
                    self._channel_guild[channel.id] = guild_id
                    self._channels[channel.id] = channel
            for raw_role in guild.get("roles") or []:
                if not isinstance(raw_role, dict):
                    continue
                role = Role.from_payload(raw_role, guild_id=guild_id)
                if role.id:
                    self._roles[role.id] = role
        return self.guilds

    async def fetch_channel(self, channel_id: str) -> Channel:
        """Busca um canal pelo ID fixo e atualiza o cache local."""
        channel_id = str(channel_id).strip()
        if not channel_id:
            raise ValueError("channel_id obrigatorio")
        payload = await self._request("GET", f"/api/bot/channels/{channel_id}")
        channel = Channel.from_payload(payload.get("channel") if isinstance(payload, dict) else None)
        if not channel.id:
            raise GingaError("Canal invalido retornado pela API")
        self._channels[channel.id] = channel
        self._channel_guild[channel.id] = channel.guild_id
        return channel

    async def fetch_role(self, guild_id: str, role_id: str) -> Role:
        """Busca um cargo pelo ID fixo. Nome, cor e posicao podem mudar sem afetar o ID."""
        guild_id = str(guild_id).strip()
        role_id = str(role_id).strip()
        if not guild_id or not role_id:
            raise ValueError("guild_id e role_id sao obrigatorios")
        payload = await self._request("GET", f"/api/bot/guilds/{guild_id}/roles/{role_id}")
        role = Role.from_payload(payload.get("role") if isinstance(payload, dict) else None, guild_id=guild_id)
        if not role.id:
            raise GingaError("Cargo invalido retornado pela API")
        self._roles[role.id] = role
        return role

    async def fetch_user(self, user_id: str) -> User:
        """Busca um usuario por ID, limitado a usuarios que compartilham um servidor com o bot."""
        user_id = str(user_id).strip()
        if not user_id:
            raise ValueError("user_id obrigatorio")
        payload = await self._request("GET", f"/api/bot/users/{user_id}")
        user = User.from_payload(payload.get("user") if isinstance(payload, dict) else None)
        if not user.id:
            raise GingaError("Usuario invalido retornado pela API")
        return user

    async def fetch_member(self, guild_id: str, user_id: str) -> Member:
        """Busca um membro e seus cargos por IDs fixos."""
        guild_id = str(guild_id).strip()
        user_id = str(user_id).strip()
        if not guild_id or not user_id:
            raise ValueError("guild_id e user_id sao obrigatorios")
        payload = await self._request("GET", f"/api/bot/guilds/{guild_id}/members/{user_id}")
        member = Member.from_payload(guild_id, payload.get("member") if isinstance(payload, dict) else None)
        for role in member.roles:
            if role.id:
                self._roles[role.id] = role
        return member

    async def send_message(self, channel_id: str, content: str, *, reply_to_id: str | None = None) -> Message:
        if not channel_id:
            raise ValueError("channel_id obrigatorio")
        content = str(content).strip()
        if not content:
            raise ValueError("content obrigatorio")
        body: dict[str, Any] = {"content": content}
        if reply_to_id:
            body["replyToId"] = reply_to_id
        payload = await self._request("POST", f"/api/bot/channels/{channel_id}/messages", json=body)
        raw = dict(payload.get("message") or payload)
        return Message(self, raw)

    async def _sync_application_commands(self) -> None:
        if not self.sync_commands:
            return
        unique = {command.name: command for command in self._commands.values()}
        for command in unique.values():
            try:
                await self._request(
                    "PUT",
                    f"/api/bot/commands/{command.name}",
                    json={"description": command.description},
                )
            except Exception as exc:
                self.log.warning("Nao foi possivel sincronizar /%s: %s", command.name, exc)

    def _extract_invocation(self, content: str) -> tuple[str, str, str] | None:
        stripped = content.strip()
        prefixes = list(self.command_prefixes)
        if self.accept_slash_commands and "/" not in prefixes:
            prefixes.append("/")
        for prefix in sorted(prefixes, key=len, reverse=True):
            if not stripped.startswith(prefix):
                continue
            remainder = stripped[len(prefix):].lstrip()
            if not remainder:
                return None
            name, _, args_text = remainder.partition(" ")
            return prefix, name.lower(), args_text
        return None

    async def process_commands(self, message: Message) -> None:
        invocation = self._extract_invocation(message.content)
        if invocation is None:
            return
        prefix, name, args_text = invocation
        command = self.get_command(name)
        if command is None:
            return
        ctx = Context(self, message, invoked_with=name, prefix=prefix, args_text=args_text)
        try:
            await command.invoke(ctx)
            await self._dispatch("command_completion", ctx)
        except CommandError as exc:
            callback = self._events.get("command_error")
            if callback is not None:
                result = callback(ctx, exc)
                if inspect.isawaitable(result):
                    await result
            else:
                self.log.warning("Erro no comando %s: %s", name, exc)

    def _wire_socket(self) -> None:
        @self.socket.event
        async def connect(*_args: Any) -> None:
            # Algumas versoes do python-socketio podem anexar metadados ao
            # callback de conexao. Eles nao fazem parte da API publica do SDK.
            self.log.info("Gateway do Ginga conectado")
            await self._dispatch("connect")

        @self.socket.event
        async def disconnect(*_args: Any) -> None:
            # Aceita motivo/metadados opcionais sem quebrar a aplicacao do bot.
            self._ready.clear()
            await self._dispatch("disconnect")

        @self.socket.on("bot:ready")
        async def bot_ready(payload: Any = None, *_extra: Any) -> None:
            # Socket.IO pode entregar argumentos adicionais dependendo da versao
            # do cliente/servidor ou de metadados anexados ao evento. O payload
            # oficial do Ginga e sempre o primeiro objeto JSON; argumentos extras
            # sao ignorados para manter compatibilidade entre versoes.
            payload = payload if isinstance(payload, dict) else {}
            effective_intents = set(payload.get("intents") or [])
            if self.intents.message_content and "MESSAGE_CONTENT" not in effective_intents:
                self.log.warning(
                    "MESSAGE_CONTENT foi solicitado pelo codigo, mas esta desabilitado no Developer Portal. "
                    "Ative 'Conteudo de mensagens' na aplicacao do bot."
                )
            me = await self.me()
            self.application = me.get("application") if isinstance(me, dict) else None
            bot_user = (self.application or {}).get("botUser") if isinstance(self.application, dict) else None
            self.user = User.from_payload(bot_user if isinstance(bot_user, dict) else None)
            await self.fetch_guilds()
            await self._sync_application_commands()
            self._ready.set()
            await self._dispatch("ready")

        @self.socket.on("message:new")
        async def message_new(payload: Any = None, *_extra: Any) -> None:
            if not isinstance(payload, dict):
                self.log.warning("Evento message:new recebido sem payload JSON valido")
                return
            message = Message(self, payload)
            if self.user and message.author.id == self.user.id:
                return
            await self._dispatch("message", message)
            await self.process_commands(message)

        @self.socket.on("guild:message:new")
        async def guild_message_new(payload: Any = None, *_extra: Any) -> None:
            if not isinstance(payload, dict):
                self.log.warning("Evento guild:message:new recebido sem payload JSON valido")
                return
            await self._dispatch("guild_message", payload)

        @self.socket.on("voice:presence")
        async def voice_presence(payload: Any = None, *_extra: Any) -> None:
            if not isinstance(payload, dict):
                self.log.warning("Evento voice:presence recebido sem payload JSON valido")
                return
            await self._dispatch("voice_state_update", payload)

    async def start(self, token: str) -> None:
        token = token.strip()
        if not token:
            raise ValueError("token obrigatorio")
        self._token = token
        if self._commands and not self.intents.message_content:
            self.log.warning(
                "Comandos por texto foram definidos, mas Intents.message_content esta desativado. "
                "Ative intents.message_content = True para receber o conteudo das mensagens."
            )
        try:
            await self.socket.connect(
                self.server_url,
                auth={"botToken": token, "intents": self.intents.to_gateway(), "sdk": f"gingabot/{__version__}"},
                transports=["websocket", "polling"],
            )
            await self.socket.wait()
        finally:
            if self.socket.connected:
                await self.socket.disconnect()
            if self._http is not None and not self._http.closed:
                await self._http.close()

    def run(self, token: str) -> None:
        try:
            asyncio.run(self.start(token))
        except KeyboardInterrupt:
            pass

    async def close(self) -> None:
        if self.socket.connected:
            await self.socket.disconnect()
        if self._http is not None and not self._http.closed:
            await self._http.close()
