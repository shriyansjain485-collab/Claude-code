"""Append-only audit log of every tool call.

One JSON object per line in `data/audit.log`. The file is only ever opened in
append mode. Each line stores a hash of the previous line, so if anyone edits
or removes history, `verify()` reports it.
"""

from __future__ import annotations

import hashlib
import json
import os
from datetime import datetime, timezone
from pathlib import Path

GENESIS = "0" * 64
MAX_RESULT_CHARS = 500

# What happened to the call.
OUTCOMES = {
    "auto",       # read-only tool, ran without asking
    "approved",   # write, the user typed "yes"
    "declined",   # write, the user did not type "yes"
    "dry_run",    # write, shown but not applied (dry-run mode)
    "refused",    # blocked by a safety rule
    "invalid",    # inputs failed schema validation
    "error",      # the tool itself failed
    "blocked",    # the network guard stopped a connection
    "cancelled",  # stopped by the user (Ctrl+C)
}


def _entry_hash(entry: dict) -> str:
    body = {k: v for k, v in entry.items() if k != "hash"}
    text = json.dumps(body, sort_keys=True, ensure_ascii=False, separators=(",", ":"))
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


class AuditLog:
    def __init__(self, path: Path):
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)

    def _last_hash(self) -> str:
        if not self.path.exists():
            return GENESIS
        last = None
        with open(self.path, "r", encoding="utf-8") as handle:
            for line in handle:
                if line.strip():
                    last = line
        if last is None:
            return GENESIS
        try:
            return json.loads(last)["hash"]
        except (ValueError, KeyError):
            # A damaged last line: chain from its raw hash so verify() flags it.
            return hashlib.sha256(last.encode("utf-8")).hexdigest()

    def record(
        self,
        tool: str,
        inputs: object,
        outcome: str,
        result: str = "",
        tier: str = "",
        approved: bool | None = None,
    ) -> dict:
        if outcome not in OUTCOMES:
            raise ValueError(f"unknown audit outcome: {outcome}")
        entry = {
            "time": datetime.now(timezone.utc).astimezone().isoformat(timespec="seconds"),
            "tool": tool,
            "inputs": inputs,
            "tier": tier,
            "outcome": outcome,
            "approved": approved,
            "result": (result or "")[:MAX_RESULT_CHARS],
            "prev": self._last_hash(),
        }
        entry["hash"] = _entry_hash(entry)
        line = json.dumps(entry, ensure_ascii=False, default=str) + "\n"
        # O_APPEND: the operating system only ever adds to the end of the file.
        fd = os.open(self.path, os.O_WRONLY | os.O_APPEND | os.O_CREAT, 0o600)
        try:
            os.write(fd, line.encode("utf-8"))
        finally:
            os.close(fd)
        return entry

    def entries(self) -> list[dict]:
        if not self.path.exists():
            return []
        with open(self.path, "r", encoding="utf-8") as handle:
            return [json.loads(line) for line in handle if line.strip()]

    def verify(self) -> tuple[bool, str]:
        """Check the hash chain. Returns (ok, message)."""
        if not self.path.exists():
            return True, "No audit log yet."
        prev = GENESIS
        count = 0
        with open(self.path, "r", encoding="utf-8") as handle:
            for number, line in enumerate(handle, start=1):
                if not line.strip():
                    continue
                try:
                    entry = json.loads(line)
                except ValueError:
                    return False, f"Line {number} is not valid JSON: the log was altered."
                if entry.get("prev") != prev:
                    return False, f"Line {number} does not follow line {number - 1}: an entry was removed or changed."
                if entry.get("hash") != _entry_hash(entry):
                    return False, f"Line {number} was edited after it was written."
                prev = entry["hash"]
                count += 1
        return True, f"Audit log intact: {count} entries."
