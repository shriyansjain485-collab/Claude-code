"""Loads and checks config.toml."""

from __future__ import annotations

import shutil
import tomllib
from dataclasses import dataclass, field
from pathlib import Path
from urllib.parse import urlsplit

from jarvis.safety.netguard import is_loopback_host


class ConfigError(ValueError):
    """config.toml has a problem. The message says how to fix it."""


@dataclass
class Config:
    base_dir: Path
    assistant_name: str = "Jarvis"
    address_user_as: str = "sir"
    style: str = "concise, polite, a little dry wit; never sycophantic"
    model_name: str = "qwen3.5:9b"
    model_host: str = "http://127.0.0.1:11434"
    think: bool = False
    temperature: float = 0.3
    context_tokens: int = 8192
    timeout_seconds: int = 300
    allowed_folders: list[Path] = field(default_factory=list)
    dry_run: bool = False
    allow_online_tools: bool = False
    data_dir: Path = Path("data")
    ui_port: int = 8765

    @property
    def notes_dir(self) -> Path:
        return self.data_dir / "notes"

    @property
    def audit_path(self) -> Path:
        return self.data_dir / "audit.log"


def _resolve(base: Path, value: str) -> Path:
    path = Path(str(value)).expanduser()
    if not path.is_absolute():
        path = base / path
    return path.resolve()


def _expect(table: dict, key: str, kind, default):
    value = table.get(key, default)
    if kind is float and isinstance(value, int) and not isinstance(value, bool):
        value = float(value)
    if not isinstance(value, kind) or (kind is int and isinstance(value, bool)):
        raise ConfigError(f"config.toml: '{key}' should be a {kind.__name__}, got {value!r}.")
    return value


def check_model_host(host: str) -> str:
    parts = urlsplit(host)
    if parts.scheme != "http" or not parts.hostname:
        raise ConfigError(
            f"config.toml: model host '{host}' must look like http://127.0.0.1:11434."
        )
    if not is_loopback_host(parts.hostname):
        raise ConfigError(
            f"config.toml: model host '{host}' is not this computer. "
            "Jarvis only talks to localhost (127.0.0.1) so nothing leaves your machine."
        )
    try:
        parts.port
    except ValueError:
        raise ConfigError(f"config.toml: model host '{host}' has an invalid port.") from None
    return host.rstrip("/")


def check_model_name(name: str) -> str:
    if not name or len(name) > 200:
        raise ConfigError("config.toml: model name is missing.")
    if "cloud" in name.lower():
        raise ConfigError(
            f"config.toml: model '{name}' is an Ollama CLOUD model. It runs on someone "
            "else's servers and would send your conversations over the internet. "
            "Choose a local model such as qwen3.5:9b."
        )
    return name


def parse(data: dict, base_dir: Path) -> Config:
    assistant = data.get("assistant", {})
    model = data.get("model", {})
    safety = data.get("safety", {})
    storage = data.get("storage", {})
    ui = data.get("ui", {})
    for name, table in (("assistant", assistant), ("model", model), ("safety", safety), ("storage", storage), ("ui", ui)):
        if not isinstance(table, dict):
            raise ConfigError(f"config.toml: [{name}] should be a section.")

    folders = safety.get("allowed_folders", ["./data"])
    if not isinstance(folders, list) or not all(isinstance(f, str) and f.strip() for f in folders):
        raise ConfigError('config.toml: allowed_folders should be a list like ["./data", "~/Documents"].')
    allowed = [_resolve(base_dir, folder) for folder in folders]
    for folder in allowed:
        if folder == Path(folder.anchor) or folder == Path.home().resolve():
            raise ConfigError(
                f"config.toml: allowed_folders contains '{folder}', which is your whole "
                "disk or home folder. Please list specific folders such as ~/Documents."
            )

    temperature = _expect(model, "temperature", float, 0.3)
    if not 0 <= temperature <= 2:
        raise ConfigError("config.toml: temperature should be between 0 and 2.")
    context_tokens = _expect(model, "context_tokens", int, 8192)
    if not 1024 <= context_tokens <= 262144:
        raise ConfigError("config.toml: context_tokens should be between 1024 and 262144.")
    timeout = _expect(model, "timeout_seconds", int, 300)
    if not 5 <= timeout <= 3600:
        raise ConfigError("config.toml: timeout_seconds should be between 5 and 3600.")

    ui_port = _expect(ui, "port", int, 8765) if isinstance(ui, dict) else 8765
    if not 1024 <= ui_port <= 65535:
        raise ConfigError("config.toml: [ui] port should be between 1024 and 65535.")

    return Config(
        base_dir=base_dir,
        ui_port=ui_port,
        assistant_name=_expect(assistant, "name", str, "Jarvis").strip() or "Jarvis",
        address_user_as=_expect(assistant, "address_user_as", str, "sir").strip() or "sir",
        style=_expect(assistant, "style", str, Config.style),
        model_name=check_model_name(_expect(model, "name", str, "qwen3.5:9b").strip()),
        model_host=check_model_host(_expect(model, "host", str, "http://127.0.0.1:11434").strip()),
        think=_expect(model, "think", bool, False),
        temperature=temperature,
        context_tokens=context_tokens,
        timeout_seconds=timeout,
        allowed_folders=allowed,
        dry_run=_expect(safety, "dry_run", bool, False),
        allow_online_tools=_expect(safety, "allow_online_tools", bool, False),
        data_dir=_resolve(base_dir, _expect(storage, "data_dir", str, "./data")),
    )


def load(path: Path) -> Config:
    """Read config.toml. On first run it is created from config.example.toml."""
    path = Path(path).expanduser().resolve()
    if not path.exists():
        example = path.parent / "config.example.toml"
        if not example.exists():
            raise ConfigError(f"No config file at {path} and no config.example.toml next to it.")
        shutil.copyfile(example, path)
    try:
        with open(path, "rb") as handle:
            data = tomllib.load(handle)
    except tomllib.TOMLDecodeError as error:
        raise ConfigError(f"{path.name} has a typo: {error}") from None
    return parse(data, path.parent)
