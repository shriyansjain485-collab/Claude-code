"""The list of tools Jarvis has, with safety checks on every registration."""

from __future__ import annotations

import re

from jarvis import schema
from jarvis.safety.forbidden import FORBIDDEN_CATEGORIES
from jarvis.tools.base import Tier, Tool

OFFLINE_WARNING = "⚠ BREAKS OFFLINE MODE"


class ToolRejected(ValueError):
    """The tool breaks a safety rule and was not registered."""


class Registry:
    def __init__(self, allow_online_tools: bool = False):
        self.allow_online_tools = allow_online_tools
        self._tools: dict[str, Tool] = {}

    def register(self, tool: Tool) -> None:
        if not re.fullmatch(r"[a-z][a-z0-9_]{1,40}", tool.name):
            raise ToolRejected(f"bad tool name: {tool.name!r}")
        if tool.name in self._tools:
            raise ToolRejected(f"tool '{tool.name}' is already registered")
        if not isinstance(tool.tier, Tier):
            raise ToolRejected(f"tool '{tool.name}' must declare a permission tier")
        banned = set(tool.categories) & set(FORBIDDEN_CATEGORIES)
        if banned:
            raise ToolRejected(
                f"tool '{tool.name}' is in a never-allowed category: {sorted(banned)}"
            )
        if tool.tier is Tier.WRITE and tool.preview is None:
            raise ToolRejected(
                f"tool '{tool.name}' changes things, so it must provide a preview "
                "of exactly what will change"
            )
        if tool.requires_network and not self.allow_online_tools:
            raise ToolRejected(
                f"tool '{tool.name}' needs the internet ({OFFLINE_WARNING}). "
                "It stays off unless allow_online_tools = true in config.toml."
            )
        if len(tool.description.strip()) < 10:
            raise ToolRejected(f"tool '{tool.name}' needs a clear description")
        try:
            schema.check_schema(tool.parameters)
        except schema.SchemaError as error:
            raise ToolRejected(f"tool '{tool.name}': {error}") from None
        self._tools[tool.name] = tool

    def try_register(self, tool: Tool) -> str | None:
        """Register if allowed. Returns the reason if it was rejected."""
        try:
            self.register(tool)
            return None
        except ToolRejected as error:
            return str(error)

    def get(self, name: str) -> Tool | None:
        return self._tools.get(name)

    def names(self) -> list[str]:
        return list(self._tools)

    def all(self) -> list[Tool]:
        return list(self._tools.values())

    def to_model_format(self) -> list[dict]:
        return [tool.to_model_format() for tool in self._tools.values()]

    def describe(self) -> str:
        """Human-readable list for the /tools command."""
        lines = []
        for tool in self._tools.values():
            tier = "asks first" if tool.tier is Tier.WRITE else "automatic"
            flag = f"  {OFFLINE_WARNING}" if tool.requires_network else ""
            lines.append(f"  {tool.name:<18} [{tier}]{flag}  {tool.description.splitlines()[0]}")
        return "\n".join(lines)


def build_default_registry(allow_online_tools: bool = False) -> Registry:
    """All built-in tools. To add your own, see README: 'Adding a tool'."""
    from jarvis.tools import clock, files, notes

    registry = Registry(allow_online_tools=allow_online_tools)
    for module in (clock, files, notes):
        for tool in module.TOOLS:
            registry.register(tool)
    return registry
