"""Find and read files inside the folders you allowed. Read-only."""

from __future__ import annotations

import os
from pathlib import Path

from jarvis.safety.paths import PathNotAllowed, is_sensitive
from jarvis.tools.base import Tier, Tool, ToolContext, ToolError, ToolResult

TEXT_EXTENSIONS = {".txt", ".md", ".markdown", ".text", ".csv"}
MAX_RESULTS = 20
MAX_FILES_SCANNED = 5000
MAX_SEARCHABLE_BYTES = 1_000_000
MAX_READ_BYTES = 5_000_000
DEFAULT_READ_CHARS = 8000
MAX_READ_CHARS = 20000


def _read_text(path: Path, limit_bytes: int) -> str:
    with open(path, "rb") as handle:
        raw = handle.read(limit_bytes)
    if b"\x00" in raw[:4096]:
        raise ToolError(f"{path.name} is not a text file.")
    return raw.decode("utf-8", errors="replace")


def _walk(root: Path, ctx: ToolContext):
    """Yield allowed, non-hidden, non-sensitive files under root."""
    for folder, subfolders, filenames in os.walk(root, followlinks=False):
        subfolders[:] = sorted(
            name for name in subfolders
            if not name.startswith(".") and not is_sensitive(Path(name) / "x")
        )
        for filename in sorted(filenames):
            if filename.startswith("."):
                continue
            path = Path(folder) / filename
            # Symlinks may point outside the allowlist: check the real target.
            if ctx.paths.is_allowed(path):
                yield path


def _snippet(text: str, terms: list[str]) -> str:
    lowered = text.lower()
    positions = [lowered.find(term) for term in terms if term in lowered]
    if not positions:
        return ""
    start = max(0, min(positions) - 60)
    return " ".join(text[start : start + 200].split())


def _find_files(args: dict, ctx: ToolContext) -> ToolResult:
    terms = [term for term in args["query"].lower().split() if term]
    if not terms:
        raise ToolError("Give me at least one word to search for.")
    if args.get("folder"):
        try:
            roots = [ctx.paths.check(args["folder"])]
        except PathNotAllowed as error:
            raise ToolError(str(error)) from None
        if not roots[0].is_dir():
            raise ToolError(f"'{args['folder']}' is not a folder.")
    else:
        roots = [root for root in ctx.paths.allowed if root.is_dir()]

    matches: list[str] = []
    scanned = 0
    truncated = False
    seen: set[Path] = set()
    for root in roots:
        for path in _walk(root, ctx):
            if path in seen:
                continue
            seen.add(path)
            scanned += 1
            if scanned > MAX_FILES_SCANNED:
                truncated = True
                break
            name_hit = all(term in path.name.lower() for term in terms)
            snippet = ""
            if path.suffix.lower() in TEXT_EXTENSIONS:
                try:
                    if path.stat().st_size <= MAX_SEARCHABLE_BYTES:
                        text = _read_text(path, MAX_SEARCHABLE_BYTES)
                        if all(term in text.lower() for term in terms):
                            snippet = _snippet(text, terms)
                except (OSError, ToolError):
                    pass
            if name_hit or snippet:
                line = f"- {path}"
                if snippet:
                    line += f"\n    …{snippet}…"
                matches.append(line)
                if len(matches) >= MAX_RESULTS:
                    truncated = True
                    break
        if truncated:
            break

    if not matches:
        searched = ", ".join(str(root) for root in roots) or "(no allowed folders exist)"
        return ToolResult(f"No files matching '{args['query']}' in: {searched}")
    header = f"{len(matches)} file(s) matching '{args['query']}':"
    if truncated:
        header += " (stopped early; there may be more. Use a more specific query.)"
    return ToolResult(header + "\n" + "\n".join(matches), untrusted=True, source="file search results")


def _read_file(args: dict, ctx: ToolContext) -> ToolResult:
    try:
        path = ctx.paths.check(args["path"])
    except PathNotAllowed as error:
        raise ToolError(str(error)) from None
    if not path.exists():
        raise ToolError(f"There is no file at '{args['path']}'. Use find_files to locate it.")
    if not path.is_file():
        raise ToolError(f"'{args['path']}' is a folder, not a file.")
    if path.suffix.lower() not in TEXT_EXTENSIONS:
        raise ToolError(
            f"I can only read {', '.join(sorted(TEXT_EXTENSIONS))} files so far, "
            f"not '{path.suffix or 'files without an extension'}'."
        )
    limit = args.get("max_chars", DEFAULT_READ_CHARS)
    text = _read_text(path, MAX_READ_BYTES)
    total = len(text)
    shown = text[:limit]
    note = f"\n[Shown: first {limit} of {total} characters.]" if total > limit else ""
    return ToolResult(shown + note, untrusted=True, source=str(path))


TOOLS = [
    Tool(
        name="find_files",
        description=(
            "Search the user's allowed folders for files whose name or text contains "
            "ALL the given words. Returns file paths with a short excerpt."
        ),
        parameters={
            "type": "object",
            "properties": {
                "query": {
                    "type": "string",
                    "description": "One to five key words, e.g. 'tax 2025'. Not a sentence.",
                    "minLength": 1,
                    "maxLength": 100,
                },
                "folder": {
                    "type": "string",
                    "description": "Optional: only search inside this folder (must be an allowed folder).",
                    "maxLength": 500,
                },
            },
            "required": ["query"],
        },
        tier=Tier.READ,
        run=_find_files,
    ),
    Tool(
        name="read_file",
        description=(
            "Read a text file (.txt, .md, .csv) from the user's allowed folders, "
            "for example to summarise it. Use a path returned by find_files."
        ),
        parameters={
            "type": "object",
            "properties": {
                "path": {
                    "type": "string",
                    "description": "Full path of the file, exactly as returned by find_files.",
                    "minLength": 1,
                    "maxLength": 500,
                },
                "max_chars": {
                    "type": "integer",
                    "description": "How many characters to read (default 8000).",
                    "minimum": 200,
                    "maximum": MAX_READ_CHARS,
                },
            },
            "required": ["path"],
        },
        tier=Tier.READ,
        run=_read_file,
    ),
]
