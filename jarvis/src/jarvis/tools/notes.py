"""Notes: plain markdown files in data/notes/ that you can open and edit yourself.

Reading and searching run automatically. Creating and adding to notes show
you exactly what will be written and wait for your "yes".
There is deliberately no delete tool.
"""

from __future__ import annotations

import difflib
import re
from pathlib import Path

from jarvis.tools.base import Tier, Tool, ToolContext, ToolError, ToolResult

MAX_NOTE_CHARS = 20000
MAX_RESULTS = 15


def slugify(title: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", title.lower()).strip("-")
    if not slug:
        raise ToolError("A note title needs at least one letter or number.")
    return slug[:80]


def note_path(ctx: ToolContext, title: str) -> Path:
    path = (ctx.notes_dir / f"{slugify(title)}.md").resolve()
    if ctx.notes_dir.resolve() not in path.parents:
        raise ToolError("That note title is not usable.")
    return path


def _existing(ctx: ToolContext, title: str) -> Path:
    path = note_path(ctx, title)
    if not path.is_file():
        available = ", ".join(sorted(p.stem for p in ctx.notes_dir.glob("*.md"))[:20]) or "none yet"
        raise ToolError(f"There is no note called '{title}'. Existing notes: {available}.")
    return path


def _search_notes(args: dict, ctx: ToolContext) -> ToolResult:
    terms = [term for term in args.get("query", "").lower().split() if term]
    notes = sorted(ctx.notes_dir.glob("*.md")) if ctx.notes_dir.is_dir() else []
    if not notes:
        return ToolResult("There are no notes yet.")
    lines = []
    for path in notes:
        text = path.read_text(encoding="utf-8", errors="replace")
        haystack = (path.stem + "\n" + text).lower()
        if all(term in haystack for term in terms):
            first = next((line.strip("# ").strip() for line in text.splitlines() if line.strip()), path.stem)
            lines.append(f"- {path.stem}: {first[:100]}")
        if len(lines) >= MAX_RESULTS:
            break
    if not lines:
        return ToolResult(f"No notes mention '{args.get('query', '')}'.")
    label = f"Notes matching '{args['query']}':" if terms else "All notes:"
    return ToolResult(label + "\n" + "\n".join(lines), untrusted=True, source="note search results")


def _read_note(args: dict, ctx: ToolContext) -> ToolResult:
    path = _existing(ctx, args["title"])
    text = path.read_text(encoding="utf-8", errors="replace")
    if len(text) > MAX_NOTE_CHARS:
        text = text[:MAX_NOTE_CHARS] + f"\n[Shown: first {MAX_NOTE_CHARS} characters.]"
    return ToolResult(text, untrusted=True, source=f"note '{path.stem}'")


def _new_note_text(args: dict) -> str:
    return f"# {args['title'].strip()}\n\n{args['content'].strip()}\n"


def _create_preview(args: dict, ctx: ToolContext) -> str:
    path = note_path(ctx, args["title"])
    if path.exists():
        raise ToolError(
            f"A note called '{path.stem}' already exists. Use append_to_note to add to it."
        )
    body = "\n".join(f"  + {line}" for line in _new_note_text(args).splitlines())
    return f"CREATE new note: {path}\n{body}"


def _create_note(args: dict, ctx: ToolContext) -> ToolResult:
    path = note_path(ctx, args["title"])
    path.parent.mkdir(parents=True, exist_ok=True)
    try:
        # "x" = create only; refuses to overwrite an existing file.
        with open(path, "x", encoding="utf-8") as handle:
            handle.write(_new_note_text(args))
    except FileExistsError:
        raise ToolError(f"A note called '{path.stem}' already exists.") from None
    return ToolResult(f"Note '{path.stem}' created at {path}.")


def _appended_text(old: str, addition: str) -> str:
    separator = "" if old.endswith("\n") else "\n"
    return f"{old}{separator}\n{addition.strip()}\n"


def _append_preview(args: dict, ctx: ToolContext) -> str:
    path = _existing(ctx, args["title"])
    old = path.read_text(encoding="utf-8", errors="replace")
    new = _appended_text(old, args["content"])
    diff = difflib.unified_diff(
        old.splitlines(), new.splitlines(), "before", "after", lineterm="", n=2
    )
    return f"ADD to existing note: {path}\n" + "\n".join(f"  {line}" for line in diff)


def _append_to_note(args: dict, ctx: ToolContext) -> ToolResult:
    path = _existing(ctx, args["title"])
    old = path.read_text(encoding="utf-8", errors="replace")
    path.write_text(_appended_text(old, args["content"]), encoding="utf-8")
    return ToolResult(f"Added to note '{path.stem}'.")


_TITLE = {
    "type": "string",
    "description": "The note's title, e.g. 'Holiday ideas'.",
    "minLength": 1,
    "maxLength": 80,
}

TOOLS = [
    Tool(
        name="search_notes",
        description="List the user's notes, or find notes containing ALL the given words.",
        parameters={
            "type": "object",
            "properties": {
                "query": {
                    "type": "string",
                    "description": "Key words to look for. Leave empty to list all notes.",
                    "maxLength": 100,
                }
            },
            "required": [],
        },
        tier=Tier.READ,
        run=_search_notes,
    ),
    Tool(
        name="read_note",
        description="Read one of the user's notes in full, by its title.",
        parameters={"type": "object", "properties": {"title": _TITLE}, "required": ["title"]},
        tier=Tier.READ,
        run=_read_note,
    ),
    Tool(
        name="create_note",
        description="Save a NEW note. The user is shown the note and must approve it.",
        parameters={
            "type": "object",
            "properties": {
                "title": _TITLE,
                "content": {
                    "type": "string",
                    "description": "The full text of the note.",
                    "minLength": 1,
                    "maxLength": 10000,
                },
            },
            "required": ["title", "content"],
        },
        tier=Tier.WRITE,
        run=_create_note,
        preview=_create_preview,
    ),
    Tool(
        name="append_to_note",
        description="Add text to the end of an EXISTING note. The user is shown the change and must approve it.",
        parameters={
            "type": "object",
            "properties": {
                "title": _TITLE,
                "content": {
                    "type": "string",
                    "description": "The text to add.",
                    "minLength": 1,
                    "maxLength": 10000,
                },
            },
            "required": ["title", "content"],
        },
        tier=Tier.WRITE,
        run=_append_to_note,
        preview=_append_preview,
    ),
]
