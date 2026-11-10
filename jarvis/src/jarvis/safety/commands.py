"""The ONLY place Jarvis may run a system command.

There is no general "run a command" ability. Each entry below is a fixed
program with a fixed argument template; the only variable parts are checked by
a validator first. Commands never go through a shell, so characters like
`;`, `|` or `&&` have no special meaning.

To add a command (rarely needed): add an entry here and a test for it.
"""

from __future__ import annotations

import re
import subprocess
from dataclasses import dataclass
from typing import Callable


class CommandNotAllowed(PermissionError):
    pass


@dataclass(frozen=True)
class AllowedCommand:
    description: str
    program: str                                  # absolute path, never searched on PATH
    build_args: Callable[[dict], list[str]]       # validates inputs, returns the arguments
    timeout_seconds: int = 5


def _pid_args(inputs: dict) -> list[str]:
    pid = str(inputs.get("pid", ""))
    if not re.fullmatch(r"[1-9][0-9]{0,9}", pid):
        raise CommandNotAllowed("pid must be a positive whole number")
    return ["-p", pid, "-o", "command="]


ALLOWLIST: dict[str, AllowedCommand] = {
    # Used by the kill switch to confirm a process really is Jarvis.
    "process_command_line": AllowedCommand(
        description="Show the command line of one process (read-only).",
        program="/bin/ps",
        build_args=_pid_args,
    ),
}


def run_allowed(name: str, inputs: dict) -> str:
    """Run an allowlisted command and return what it printed."""
    command = ALLOWLIST.get(name)
    if command is None:
        raise CommandNotAllowed(f"'{name}' is not an allowed command.")
    args = command.build_args(inputs)
    if not all(isinstance(arg, str) and "\x00" not in arg for arg in args):
        raise CommandNotAllowed("invalid argument")
    completed = subprocess.run(
        [command.program, *args],
        shell=False,
        capture_output=True,
        text=True,
        timeout=command.timeout_seconds,
        stdin=subprocess.DEVNULL,
        check=False,
    )
    return completed.stdout
