"""The terminal chat window, and the `stop`, `audit` and `tools` commands."""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from jarvis import __version__
from jarvis.agent import Agent, UserIO
from jarvis.config import Config, ConfigError, load
from jarvis.llm import ModelError, OllamaClient
from jarvis.safety import killswitch, netguard
from jarvis.safety.audit import AuditLog
from jarvis.tools.base import Tool
from jarvis.tools.registry import OFFLINE_WARNING, build_default_registry

DEFAULT_CONFIG = Path(__file__).resolve().parents[2] / "config.toml"

HELP = """Commands:
  /help      show this help
  /tools     list what I can do and which actions ask first
  /dry-run   switch dry-run on or off (show changes without making them)
  /stop      quit immediately (also: /quit, or Ctrl+C twice)
  Ctrl+C     cancel whatever I am doing right now
From another terminal:  ./stop.sh   stops me at once."""


def _say(text: str = "") -> None:
    print(text, flush=True)


class Terminal:
    """Reads what you type and shows approval prompts."""

    def __init__(self, config: Config):
        self.config = config
        self._streamed = False

    def read(self, prompt: str) -> str:
        return input(prompt)

    def on_text(self, text: str) -> None:
        if not self._streamed:
            sys.stdout.write(f"\n{self.config.assistant_name}: ")
            self._streamed = True
        sys.stdout.write(text)
        sys.stdout.flush()

    def end_reply(self, full_text: str) -> None:
        if self._streamed:
            sys.stdout.write("\n\n")
        elif full_text:
            sys.stdout.write(f"\n{self.config.assistant_name}: {full_text}\n\n")
        sys.stdout.flush()
        self._streamed = False

    def notify(self, text: str) -> None:
        if self._streamed:
            sys.stdout.write("\n")
            self._streamed = False
        _say(f"\n{text}")

    def approve(self, tool: Tool, preview: str, sources_read: list[str]) -> bool:
        if self._streamed:
            sys.stdout.write("\n")
            self._streamed = False
        line = "─" * 60
        _say(f"\n{line}\nAPPROVAL NEEDED  ({tool.name})\n{line}")
        _say(preview)
        if sources_read:
            _say(
                "\nNote: this was proposed after reading: " + ", ".join(sources_read)
                + "\n      Check it is what YOU asked for, not something a file told me to do."
            )
        _say(line)
        try:
            answer = self.read(
                f'Apply this change, {self.config.address_user_as}? Type "yes" to confirm (anything else cancels): '
            )
        except EOFError:
            answer = ""
        approved = answer.strip().lower() == "yes"
        _say("Applied." if approved else "Cancelled. Nothing was changed.")
        return approved


def _banner(config: Config, registry, rejected: list[str]) -> None:
    _say(f"{config.assistant_name} v{__version__}  ·  model: {config.model_name}  ·  offline guard: ON")
    _say(f"Allowed folders: {', '.join(str(folder) for folder in config.allowed_folders)}")
    if config.dry_run:
        _say("DRY RUN is on: I will show changes but not make them.")
    online = [tool.name for tool in registry.all() if tool.requires_network]
    if online:
        _say(f"{OFFLINE_WARNING}: online tools are enabled: {', '.join(online)}")
    for reason in rejected:
        _say(f"Tool not loaded: {reason}")
    _say("Type /help for commands. Ctrl+C cancels; /stop quits.\n")


def prepare(config: Config):
    """Shared start-up for the terminal and the browser UI.

    Returns (registry, client, audit), or None after printing why it cannot start.
    """
    audit = AuditLog(config.audit_path)
    netguard.add_listener(lambda what: audit.record("network_guard", {"attempt": what}, "blocked", what))
    try:
        registry = build_default_registry(config.allow_online_tools)
    except ValueError as error:
        _say(f"A built-in tool failed its safety check: {error}")
        return None
    client = OllamaClient(config)
    try:
        client.check_ready()
    except ModelError as error:
        _say(str(error))
        return None
    config.notes_dir.mkdir(parents=True, exist_ok=True)
    killswitch.write_pidfile(config.data_dir)
    killswitch.install_term_handler()
    return registry, client, audit


def chat(config: Config, terminal: Terminal | None = None) -> int:
    terminal = terminal or Terminal(config)
    prepared = prepare(config)
    if prepared is None:
        return 1
    registry, client, audit = prepared
    agent = Agent(
        config, client, registry, audit,
        UserIO(approve=terminal.approve, notify=terminal.notify, on_text=terminal.on_text),
    )
    _banner(config, registry, [])
    sir = config.address_user_as
    interrupted_at_prompt = False
    try:
        while True:
            try:
                text = terminal.read("You: ").strip()
                interrupted_at_prompt = False
            except EOFError:
                break
            except KeyboardInterrupt:
                if interrupted_at_prompt:
                    break
                interrupted_at_prompt = True
                _say("\n(Press Ctrl+C again, or type /stop, to quit.)")
                continue
            if not text:
                continue
            command = text.lower()
            if command in ("/stop", "/quit", "/exit"):
                break
            if command == "/help":
                _say(HELP)
                continue
            if command == "/tools":
                _say(registry.describe())
                continue
            if command == "/dry-run":
                agent.dry_run = not agent.dry_run
                _say(f"Dry run is now {'ON: nothing will be changed' if agent.dry_run else 'OFF'}.")
                continue
            if command.startswith("/"):
                _say("Unknown command. Type /help.")
                continue
            try:
                reply = agent.handle(text)
                terminal.end_reply(reply)
            except KeyboardInterrupt:
                client.cancel()
                terminal.end_reply("")
                _say(f"Stopped, {sir}.")
                agent.messages.append({"role": "assistant", "content": "(The user cancelled this.)"})
            except ModelError as error:
                terminal.end_reply("")
                _say(str(error))
    finally:
        client.cancel()
        killswitch.remove_pidfile(config.data_dir)
    _say(f"Goodbye, {sir}.")
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="jarvis", description="Your offline personal assistant.")
    parser.add_argument("--config", type=Path, default=DEFAULT_CONFIG, help="path to config.toml")
    parser.add_argument("--dry-run", action="store_true", help="show changes without making them")
    parser.add_argument("--ui", action="store_true", help="open the browser window instead of terminal chat")
    parser.add_argument(
        "command", nargs="*", default=[],
        help="nothing = chat · stop = stop a running Jarvis · tools = list tools · audit verify = check the audit log",
    )
    args = parser.parse_args(argv)

    netguard.install()
    try:
        config = load(args.config)
    except ConfigError as error:
        _say(str(error))
        return 2
    if args.dry_run:
        config.dry_run = True

    command = " ".join(args.command)
    if command == "" and args.ui:
        from jarvis import web

        return web.serve(config)
    if command == "":
        return chat(config)
    if command == "stop":
        stopped, message = killswitch.stop_running(config.data_dir)
        _say(message)
        return 0 if stopped else 1
    if command == "tools":
        _say(build_default_registry(config.allow_online_tools).describe())
        return 0
    if command == "audit verify":
        ok, message = AuditLog(config.audit_path).verify()
        _say(message)
        return 0 if ok else 1
    if command == "audit":
        for entry in AuditLog(config.audit_path).entries()[-30:]:
            _say(f"{entry['time']}  {entry['outcome']:<9} {entry['tool']:<18} {str(entry['inputs'])[:70]}")
        return 0
    parser.print_help()
    return 2
