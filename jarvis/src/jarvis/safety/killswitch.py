"""Stop Jarvis immediately.

- Inside Jarvis: Ctrl+C cancels the current action; Ctrl+C twice or `/stop` quits.
- From any other terminal: `./stop.sh` (which runs `python -m jarvis stop`).

While running, Jarvis writes its process number to `data/jarvis.pid`. The stop
command reads it, confirms that process really is Jarvis, and ends it.
"""

from __future__ import annotations

import os
import signal
import time
from pathlib import Path

from jarvis.safety import commands

PIDFILE_NAME = "jarvis.pid"


def pidfile_path(data_dir: Path) -> Path:
    return Path(data_dir) / PIDFILE_NAME


def write_pidfile(data_dir: Path) -> Path:
    path = pidfile_path(data_dir)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(f"{os.getpid()}\n", encoding="utf-8")
    return path


def remove_pidfile(data_dir: Path) -> None:
    path = pidfile_path(data_dir)
    try:
        if path.read_text(encoding="utf-8").strip() == str(os.getpid()):
            path.unlink()  # our own bookkeeping file, not user data
    except OSError:
        pass


def _is_alive(pid: int) -> bool:
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    return True


def _looks_like_jarvis(pid: int) -> bool:
    try:
        command_line = commands.run_allowed("process_command_line", {"pid": pid})
    except Exception:
        return False
    return "jarvis" in command_line.lower()


def stop_running(data_dir: Path, wait_seconds: float = 2.0) -> tuple[bool, str]:
    """Stop the running Jarvis, if any. Returns (stopped, message)."""
    path = pidfile_path(data_dir)
    try:
        pid = int(path.read_text(encoding="utf-8").strip())
    except (OSError, ValueError):
        return False, "Jarvis does not appear to be running."
    if pid == os.getpid() or not _is_alive(pid):
        return False, "Jarvis does not appear to be running."
    if not _looks_like_jarvis(pid):
        return False, f"Process {pid} is not Jarvis, so I left it alone."

    os.kill(pid, signal.SIGTERM)
    deadline = time.monotonic() + wait_seconds
    while time.monotonic() < deadline:
        if not _is_alive(pid):
            return True, "Jarvis stopped."
        time.sleep(0.05)
    os.kill(pid, signal.SIGKILL)  # it did not stop politely: force it
    return True, "Jarvis force-stopped."


def install_term_handler() -> None:
    """Make `./stop.sh` end the process at once, wherever it is."""

    def handler(signum, frame):
        raise SystemExit(143)

    signal.signal(signal.SIGTERM, handler)
