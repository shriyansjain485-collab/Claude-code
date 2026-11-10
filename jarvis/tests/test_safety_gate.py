"""The safety gate: tiers, approval, validation, dry-run, ask-don't-guess."""

import pytest

from jarvis.tools.base import Tier, Tool, ToolResult
from jarvis.tools.registry import OFFLINE_WARNING, Registry, ToolRejected

NOTE = {"title": "Shopping", "content": "milk, eggs"}


def note_file(config):
    return config.notes_dir / "shopping.md"


# ---- Rule 1: read-only runs automatically, writes wait for an explicit "yes"

def test_read_only_tool_runs_without_asking(harness):
    h = harness([("current_datetime", {}), "It is Tuesday, sir."])
    assert h.agent.handle("what day is it?") == "It is Tuesday, sir."
    assert h.previews == []
    assert h.outcomes("current_datetime") == ["auto"]


def test_write_shows_preview_and_runs_only_after_yes(harness, config):
    h = harness([("create_note", NOTE), "Saved, sir."], answers=["yes"])
    assert h.agent.handle("save a shopping note") == "Saved, sir."
    assert "CREATE new note" in h.previews[0] and "+ milk, eggs" in h.previews[0]
    assert note_file(config).exists()
    entry = [e for e in h.audit.entries() if e["tool"] == "create_note"][0]
    assert entry["outcome"] == "approved" and entry["approved"] is True
    assert entry["inputs"] == NOTE and entry["tier"] == "write"


@pytest.mark.parametrize("answer", ["no", "", "y", "Y", "yeah", "sure", "ok", "yes please", "yess", "n", "1", "true"])
def test_anything_other_than_yes_cancels_the_write(harness, config, answer):
    h = harness([("create_note", NOTE), "Understood, sir."], answers=[answer])
    h.agent.handle("save a shopping note")
    assert not note_file(config).exists()
    entry = [e for e in h.audit.entries() if e["tool"] == "create_note"][0]
    assert entry["outcome"] == "declined" and entry["approved"] is False
    assert "DECLINED" in h.tool_messages()[0]


@pytest.mark.parametrize("answer", ["yes", "YES", " Yes "])
def test_yes_is_accepted_in_any_case(harness, config, answer):
    h = harness([("create_note", NOTE), "Saved."], answers=[answer])
    h.agent.handle("save it")
    assert note_file(config).exists()


def test_each_write_needs_its_own_approval(harness, config):
    h = harness(
        [("create_note", NOTE), ("append_to_note", {"title": "Shopping", "content": "bread"}), "Done."],
        answers=["yes", "no"],
    )
    h.agent.handle("save a note then add bread")
    assert len(h.previews) == 2
    assert "bread" not in note_file(config).read_text(encoding="utf-8")
    assert h.outcomes("create_note") == ["approved"] and h.outcomes("append_to_note") == ["declined"]


# ---- Rule 6: dry-run changes nothing

def test_dry_run_shows_the_change_but_never_applies_or_asks(harness, config):
    h = harness([("create_note", NOTE), "That was a dry run, sir."], answers=["yes"])
    h.agent.dry_run = True
    h.agent.handle("save a shopping note")
    assert not note_file(config).exists()
    assert h.previews == []                      # no approval prompt at all
    assert "[DRY RUN]" in h.notices[0] and "milk, eggs" in h.notices[0]
    assert h.outcomes("create_note") == ["dry_run"]
    assert "NOT applied" in h.tool_messages()[0]


def test_dry_run_still_allows_reads(harness):
    h = harness([("current_datetime", {}), "Tuesday."])
    h.agent.dry_run = True
    h.agent.handle("day?")
    assert h.outcomes("current_datetime") == ["auto"]


# ---- Validation: nothing runs unless the call matches the schema

def test_unknown_tool_is_refused_and_logged(harness):
    h = harness([("run_shell", {"command": "rm -rf ~"}), "I cannot do that, sir."])
    h.agent.handle("clean up")
    assert h.outcomes("run_shell") == ["refused"]
    assert "no tool called 'run_shell'" in h.tool_messages()[0]


@pytest.mark.parametrize(
    "arguments",
    [
        {"title": "Shopping"},                                   # missing content
        {"title": "Shopping", "content": 42},                    # wrong type
        {"title": "Shopping", "content": "x", "path": "/etc"},   # invented parameter
        {"title": "x" * 500, "content": "x"},                    # too long
        "not json at all",
        ["a", "list"],
    ],
)
def test_invalid_inputs_never_reach_the_tool_or_the_user(harness, config, arguments):
    h = harness([("create_note", arguments), "Sorry, sir."], answers=["yes"])
    h.agent.handle("save something")
    assert h.previews == [] and list(config.notes_dir.iterdir()) == []
    assert h.outcomes("create_note") == ["invalid"]
    assert "invalid inputs, nothing was done" in h.tool_messages()[0]


def test_inputs_sent_as_json_text_are_parsed_then_validated(harness, config):
    h = harness([("create_note", '{"title": "Shopping", "content": "milk"}'), "Saved."], answers=["yes"])
    h.agent.handle("save it")
    assert note_file(config).exists()


def test_model_gets_one_chance_to_fix_a_bad_call(harness, config):
    h = harness([("create_note", {"title": "Shopping"}), ("create_note", NOTE), "Saved."], answers=["yes"])
    assert h.agent.handle("save a shopping note") == "Saved."
    assert h.outcomes("create_note") == ["invalid", "approved"]


def test_after_two_bad_calls_jarvis_asks_the_user_instead_of_guessing(harness, config):
    h = harness([("create_note", {"title": "A"}), ("create_note", {"content": "B"}), ("create_note", NOTE)], answers=["yes"])
    reply = h.agent.handle("save that thing")
    assert "rather ask than guess" in reply
    assert list(config.notes_dir.iterdir()) == []
    assert len(h.model.replies) == 1             # the third attempt was never requested


def test_ask_user_tool_puts_the_question_to_the_user(harness):
    h = harness([("ask_user", {"question": "Which note do you mean, sir?"})])
    assert h.agent.handle("add it to my note") == "Which note do you mean, sir?"
    assert h.outcomes("ask_user") == ["auto"]


def test_runaway_tool_loops_are_stopped(harness):
    h = harness([("current_datetime", {})] * 50)
    assert "stopped" in h.agent.handle("loop")
    assert len(h.outcomes("current_datetime")) == 8


def test_a_crashing_tool_is_logged_and_does_not_crash_jarvis(harness):
    h = harness([("boom", {}), "Something went wrong, sir."])

    def explode(args, ctx):
        raise RuntimeError("kaboom")

    h.agent.registry.register(Tool(
        name="boom", description="A tool that always fails.",
        parameters={"type": "object", "properties": {}}, tier=Tier.READ, run=explode,
    ))
    assert h.agent.handle("go") == "Something went wrong, sir."
    assert h.outcomes("boom") == ["error"]


# ---- Registry rules

def _tool(**overrides):
    base = dict(
        name="sample_tool", description="A sample tool for tests.",
        parameters={"type": "object", "properties": {}}, tier=Tier.READ,
        run=lambda args, ctx: ToolResult("ok"),
    )
    base.update(overrides)
    return Tool(**base)


def test_write_tool_without_preview_is_rejected():
    with pytest.raises(ToolRejected, match="preview"):
        Registry().register(_tool(tier=Tier.WRITE))


def test_tool_without_a_tier_is_rejected():
    with pytest.raises(ToolRejected, match="tier"):
        Registry().register(_tool(tier="read"))


def test_online_tools_are_off_by_default_and_labelled_when_enabled():
    with pytest.raises(ToolRejected, match="BREAKS OFFLINE MODE"):
        Registry().register(_tool(requires_network=True))
    registry = Registry(allow_online_tools=True)
    registry.register(_tool(requires_network=True))
    assert OFFLINE_WARNING in registry.describe()


def test_no_builtin_tool_needs_the_network(tools):
    assert not [tool.name for tool in tools.values() if tool.requires_network]


def test_every_builtin_tool_has_description_schema_and_tier(tools):
    assert set(tools) == {
        "current_datetime", "calculate", "find_files", "read_file",
        "search_notes", "read_note", "create_note", "append_to_note",
    }
    for tool in tools.values():
        assert len(tool.description) > 20 and tool.parameters["type"] == "object"
        assert isinstance(tool.tier, Tier)
        for spec in tool.parameters["properties"].values():
            assert spec.get("description"), f"{tool.name}: every input needs a description"
