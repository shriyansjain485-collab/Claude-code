"""Rule 3: no arbitrary shell commands, anywhere."""

import os
import re
from pathlib import Path

import pytest

from jarvis.safety import commands

SRC = Path(__file__).resolve().parents[1] / "src" / "jarvis"


def _sources():
    return {path: path.read_text(encoding="utf-8") for path in SRC.rglob("*.py")}


def test_only_allowlisted_commands_can_run():
    for name in ("rm", "sh", "bash", "open", "curl", "", "process_command_line; rm -rf /"):
        with pytest.raises(commands.CommandNotAllowed):
            commands.run_allowed(name, {})


@pytest.mark.parametrize("pid", ["1; rm -rf /", "$(whoami)", "-1", "0", "abc", "", "1 2", "12345678901", None])
def test_arguments_are_validated(pid):
    with pytest.raises(commands.CommandNotAllowed):
        commands.run_allowed("process_command_line", {"pid": pid})


def test_allowed_command_runs_without_a_shell():
    output = commands.run_allowed("process_command_line", {"pid": os.getpid()})
    assert "python" in output.lower() or "pytest" in output.lower()


def test_allowlist_is_small_and_uses_absolute_programs():
    assert set(commands.ALLOWLIST) == {"process_command_line"}
    for command in commands.ALLOWLIST.values():
        assert command.program.startswith("/")


def test_source_never_uses_a_shell_or_dynamic_code():
    banned = [r"shell\s*=\s*True", r"os\.system", r"os\.popen", r"\beval\(", r"\bexec\(", r"os\.exec", r"os\.spawn", r"\bpty\b", r"__import__"]
    for path, text in _sources().items():
        for pattern in banned:
            assert not re.search(pattern, text), f"{path.name} uses {pattern}"


def test_subprocess_is_only_used_by_the_command_allowlist():
    users = {path.name for path, text in _sources().items() if re.search(r"^\s*(import|from)\s+subprocess", text, re.M)}
    assert users == {"commands.py"}


def test_nothing_in_the_source_can_delete_user_files():
    banned = [r"\.unlink\(", r"os\.remove", r"os\.rmdir", r"rmtree", r"\.rmdir\(", r"send2trash", r"os\.truncate"]
    for path, text in _sources().items():
        if path.name == "killswitch.py":       # removes only its own pid bookkeeping file
            assert text.count(".unlink(") == 1
            continue
        for pattern in banned:
            assert not re.search(pattern, text), f"{path.name} uses {pattern}"


def test_only_the_model_client_uses_network_libraries():
    pattern = r"^\s*(import|from)\s+(http|urllib\.request|requests|httpx|aiohttp|ftplib|smtplib|telnetlib|socketserver|xmlrpc|websockets?)\b"
    users = {path.name for path, text in _sources().items() if re.search(pattern, text, re.M)}
    assert users == {"llm.py", "web.py"}      # web.py serves the local page on 127.0.0.1 only
    raw_socket = {path.name for path, text in _sources().items() if re.search(r"^\s*import socket", text, re.M)}
    assert raw_socket == {"netguard.py"}
