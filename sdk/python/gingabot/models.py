from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, TYPE_CHECKING

if TYPE_CHECKING:
    from .ext.commands import Bot


@dataclass(slots=True)
class User:
    id: str
    username: str
    display_name: str
    bot: bool = False

    @classmethod
    def from_payload(cls, payload: dict[str, Any] | None) -> "User":
        data = payload or {}
        return cls(
            id=str(data.get("id") or ""),
            username=str(data.get("username") or ""),
            display_name=str(data.get("displayName") or data.get("username") or ""),
            bot=str(data.get("accountType") or "").upper() == "BOT",
        )

    def __str__(self) -> str:
        return self.display_name or self.username or self.id


@dataclass(slots=True)
class Channel:
    id: str
    guild_id: str
    name: str
    type: str
    category_id: str | None = None
    topic: str = ""
    position: int = 0

    @classmethod
    def from_payload(cls, payload: dict[str, Any] | None, *, guild_id: str = "") -> "Channel":
        data = payload or {}
        return cls(
            id=str(data.get("id") or ""),
            guild_id=str(data.get("guildId") or guild_id or ""),
            name=str(data.get("name") or ""),
            type=str(data.get("type") or ""),
            category_id=str(data.get("categoryId")) if data.get("categoryId") is not None else None,
            topic=str(data.get("topic") or ""),
            position=int(data.get("position") or 0),
        )


@dataclass(slots=True)
class Role:
    id: str
    guild_id: str
    name: str
    color: str | None = None
    position: int = 0
    permissions: tuple[str, ...] = ()
    builtin: bool = False
    managed: bool = False
    key: str | None = None

    @classmethod
    def from_payload(cls, payload: dict[str, Any] | None, *, guild_id: str = "") -> "Role":
        data = payload or {}
        permissions = data.get("permissions") or []
        return cls(
            id=str(data.get("id") or ""),
            guild_id=str(data.get("guildId") or guild_id or ""),
            name=str(data.get("name") or ""),
            color=str(data.get("color")) if data.get("color") is not None else None,
            position=int(data.get("position") or 0),
            permissions=tuple(str(item) for item in permissions if isinstance(item, str)),
            builtin=bool(data.get("builtin")),
            managed=bool(data.get("managed")),
            key=str(data.get("key")) if data.get("key") is not None else None,
        )


@dataclass(slots=True)
class Member:
    guild_id: str
    user: User
    base_role: str
    base_role_id: str
    roles: tuple[Role, ...] = field(default_factory=tuple)
    joined_at: str = ""

    @classmethod
    def from_payload(cls, guild_id: str, payload: dict[str, Any] | None) -> "Member":
        data = payload or {}
        return cls(
            guild_id=guild_id,
            user=User.from_payload(data.get("user") if isinstance(data.get("user"), dict) else None),
            base_role=str(data.get("baseRole") or "MEMBER"),
            base_role_id=str(data.get("baseRoleId") or ""),
            roles=tuple(Role.from_payload(item, guild_id=guild_id) for item in (data.get("roles") or []) if isinstance(item, dict)),
            joined_at=str(data.get("joinedAt") or ""),
        )


class Message:
    __slots__ = ("_bot", "raw", "id", "content", "channel_id", "guild_id", "author")

    def __init__(self, bot: "Bot", payload: dict[str, Any]) -> None:
        self._bot = bot
        self.raw = payload
        self.id = str(payload.get("id") or "")
        self.content = str(payload.get("content") or "")
        self.channel_id = str(payload.get("channelId") or "")
        self.guild_id = bot.guild_id_for_channel(self.channel_id)
        self.author = User.from_payload(payload.get("author") if isinstance(payload.get("author"), dict) else None)

    async def reply(self, content: str) -> "Message":
        return await self._bot.send_message(self.channel_id, content, reply_to_id=self.id)
