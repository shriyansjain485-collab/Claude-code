import pytest

from jarvis.tools.base import Tier, ToolError
from jarvis.tools.notes import slugify


def test_tiers_reads_are_automatic_writes_ask(tools):
    assert tools["search_notes"].tier is Tier.READ
    assert tools["read_note"].tier is Tier.READ
    assert tools["create_note"].tier is Tier.WRITE and tools["create_note"].preview
    assert tools["append_to_note"].tier is Tier.WRITE and tools["append_to_note"].preview


def test_there_is_no_delete_tool(tools):
    assert not [name for name in tools if any(word in name for word in ("delete", "remove", "erase"))]


def test_create_preview_shows_exact_content_and_writes_nothing(tools, ctx, config):
    args = {"title": "Holiday ideas", "content": "Lisbon in March\nBook early"}
    preview = tools["create_note"].preview(args, ctx)
    assert "CREATE new note" in preview and "holiday-ideas.md" in preview
    assert "+ Lisbon in March" in preview and "+ Book early" in preview
    assert list(config.notes_dir.iterdir()) == []


def test_create_then_read_and_search(tools, ctx, config):
    tools["create_note"].run({"title": "Holiday ideas", "content": "Lisbon in March"}, ctx)
    path = config.notes_dir / "holiday-ideas.md"
    assert path.read_text(encoding="utf-8") == "# Holiday ideas\n\nLisbon in March\n"
    read = tools["read_note"].run({"title": "holiday ideas"}, ctx)
    assert "Lisbon in March" in read.text and read.untrusted
    assert "holiday-ideas" in tools["search_notes"].run({"query": "lisbon"}, ctx).text
    assert "holiday-ideas" in tools["search_notes"].run({}, ctx).text
    assert "No notes mention" in tools["search_notes"].run({"query": "zebra"}, ctx).text


def test_create_never_overwrites(tools, ctx, config):
    args = {"title": "Plan", "content": "original"}
    tools["create_note"].run(args, ctx)
    with pytest.raises(ToolError, match="already exists"):
        tools["create_note"].preview({"title": "plan", "content": "replacement"}, ctx)
    with pytest.raises(ToolError, match="already exists"):
        tools["create_note"].run({"title": "plan", "content": "replacement"}, ctx)
    assert "original" in (config.notes_dir / "plan.md").read_text(encoding="utf-8")


def test_append_preview_is_a_diff_and_append_keeps_old_text(tools, ctx, config):
    tools["create_note"].run({"title": "Plan", "content": "step one"}, ctx)
    args = {"title": "Plan", "content": "step two"}
    preview = tools["append_to_note"].preview(args, ctx)
    assert "ADD to existing note" in preview and "+step two" in preview
    assert "step two" not in (config.notes_dir / "plan.md").read_text(encoding="utf-8")
    tools["append_to_note"].run(args, ctx)
    assert (config.notes_dir / "plan.md").read_text(encoding="utf-8") == "# Plan\n\nstep one\n\nstep two\n"


def test_missing_note_errors_list_existing(tools, ctx):
    tools["create_note"].run({"title": "Plan", "content": "x"}, ctx)
    with pytest.raises(ToolError, match="Existing notes: plan"):
        tools["read_note"].run({"title": "nope"}, ctx)
    with pytest.raises(ToolError):
        tools["append_to_note"].preview({"title": "nope", "content": "x"}, ctx)


@pytest.mark.parametrize("title", ["../../etc/passwd", "..", "/abs/path", "a/../../b", "~/x"])
def test_titles_cannot_escape_the_notes_folder(tools, ctx, config, title):
    try:
        tools["create_note"].run({"title": title, "content": "x"}, ctx)
    except ToolError:
        pass
    for path in config.base_dir.rglob("*.md"):
        assert config.notes_dir.resolve() in path.resolve().parents


def test_slugify():
    assert slugify("Holiday Ideas 2026!") == "holiday-ideas-2026"
    with pytest.raises(ToolError):
        slugify("!!!")
