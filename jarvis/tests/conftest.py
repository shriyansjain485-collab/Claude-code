from __future__ import annotations

import fcntl
import os
import socket
import struct
import sys
from datetime import datetime
from pathlib import Path

import pytest

pytest_plugins = ["offline_plugin"]

JARVIS_DIR = Path(__file__).resolve().parents[1]
SRC = JARVIS_DIR / "src"


def _bring_up_loopback() -> None:
    """Inside an empty network namespace, switch on 'lo' (localhost)."""
    SIOCGIFFLAGS, SIOCSIFFLAGS, IFF_UP = 0x8913, 0x8914, 0x1
    with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as sock:
        request = struct.pack("16sH14s", b"lo", 0, b"")
        flags = struct.unpack("16sH14s", fcntl.ioctl(sock, SIOCGIFFLAGS, request))[1]
        fcntl.ioctl(sock, SIOCSIFFLAGS, struct.pack("16sH14s", b"lo", flags | IFF_UP, b""))


if os.environ.get("JARVIS_IN_NETNS") == "1":
    _bring_up_loopback()

from jarvis.agent import Agent, UserIO  # noqa: E402
from jarvis.config import Config  # noqa: E402
from jarvis.llm import ModelReply  # noqa: E402
from jarvis.safety.audit import AuditLog  # noqa: E402
from jarvis.safety.paths import PathPolicy  # noqa: E402
from jarvis.tools.base import ToolContext  # noqa: E402
from jarvis.tools.registry import build_default_registry  # noqa: E402

FIXED_NOW = datetime(2026, 11, 10, 9, 30)


@pytest.fixture
def config(tmp_path) -> Config:
    data = tmp_path / "data"
    docs = tmp_path / "docs"
    (data / "notes").mkdir(parents=True)
    docs.mkdir()
    return Config(base_dir=tmp_path, allowed_folders=[data.resolve(), docs.resolve()], data_dir=data.resolve())


@pytest.fixture
def docs(config) -> Path:
    return config.allowed_folders[1]


@pytest.fixture
def ctx(config) -> ToolContext:
    return ToolContext(config=config, paths=PathPolicy(config.allowed_folders), now=lambda: FIXED_NOW)


@pytest.fixture
def tools(config):
    registry = build_default_registry()
    return {tool.name: tool for tool in registry.all()}


class FakeModel:
    """A scripted model: returns the next prepared reply each time it is asked."""

    def __init__(self, replies):
        self.replies = list(replies)
        self.seen: list[list[dict]] = []

    def chat(self, messages, tools, on_text=None):
        self.seen.append([dict(m) for m in messages])
        if not self.replies:
            return ModelReply(content="(script finished)")
        step = self.replies.pop(0)
        if isinstance(step, str):
            return ModelReply(content=step)
        return ModelReply(tool_calls=[{"name": step[0], "arguments": step[1]}])


class Harness:
    def __init__(self, config, ctx, replies, answers=()):
        self.model = FakeModel(replies)
        self.answers = list(answers)       # what the "user" types at approval prompts
        self.previews: list[str] = []
        self.sources: list[list[str]] = []
        self.notices: list[str] = []
        self.audit = AuditLog(config.audit_path)

        def approve(tool, preview, sources_read):
            self.previews.append(preview)
            self.sources.append(sources_read)
            answer = self.answers.pop(0) if self.answers else ""
            return answer.strip().lower() == "yes"

        self.agent = Agent(
            config, self.model, build_default_registry(), self.audit,
            UserIO(approve=approve, notify=self.notices.append), context=ctx,
        )

    def outcomes(self, tool=None):
        return [e["outcome"] for e in self.audit.entries() if tool is None or e["tool"] == tool]

    def tool_messages(self):
        return [m["content"] for m in self.agent.messages if m["role"] == "tool"]


@pytest.fixture
def harness(config, ctx):
    def make(replies, answers=()):
        return Harness(config, ctx, replies, answers)

    return make


def subprocess_env() -> dict:
    env = dict(os.environ)
    env["PYTHONPATH"] = str(SRC)
    env["PYTHONUNBUFFERED"] = "1"
    return env


def write_config(tmp_path: Path, url: str, extra_safety: str = "") -> Path:
    (tmp_path / "docs").mkdir(exist_ok=True)
    path = tmp_path / "config.toml"
    path.write_text(
        f'[model]\nname = "test-model"\nhost = "{url}"\ntimeout_seconds = 30\n'
        f'[safety]\nallowed_folders = ["./data", "./docs"]\n{extra_safety}\n'
        '[storage]\ndata_dir = "./data"\n',
        encoding="utf-8",
    )
    return path


PYTHON = sys.executable
