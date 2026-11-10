"""What a tool is.

A tool is one capability: a name, a description the model reads, a schema for
its inputs, a permission tier, and a function that does the work.

  READ  tools run automatically (search, read).
  WRITE tools must provide `preview`, which describes exactly what will
        change. The user sees it and must type "yes" before `run` is called.
"""

from __future__ import annotations

import enum
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Callable

from jarvis.config import Config
from jarvis.safety.paths import PathPolicy


class Tier(enum.Enum):
    READ = "read"
    WRITE = "write"


class ToolError(Exception):
    """A tool could not do what was asked. The message is shown to the model."""


@dataclass
class ToolContext:
    """Everything a tool is allowed to know about its surroundings."""

    config: Config
    paths: PathPolicy
    now: Callable[[], datetime] = datetime.now

    @property
    def notes_dir(self) -> Path:
        return self.config.notes_dir


@dataclass
class ToolResult:
    text: str
    # True when the text contains content from files or notes. It is then
    # wrapped as untrusted data and scanned before the model sees it.
    untrusted: bool = False
    source: str = ""


@dataclass
class Tool:
    name: str
    description: str
    parameters: dict
    tier: Tier
    run: Callable[[dict, ToolContext], ToolResult]
    preview: Callable[[dict, ToolContext], str] | None = None
    requires_network: bool = False
    categories: tuple[str, ...] = field(default_factory=tuple)

    def to_model_format(self) -> dict:
        """The description of this tool that is sent to the model."""
        return {
            "type": "function",
            "function": {
                "name": self.name,
                "description": self.description,
                "parameters": self.parameters,
            },
        }
