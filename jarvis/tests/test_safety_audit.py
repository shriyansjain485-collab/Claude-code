import json

from jarvis.safety.audit import AuditLog


def test_every_call_is_logged_with_time_tool_inputs_result_and_approval(harness):
    h = harness(
        [("current_datetime", {}), ("create_note", {"title": "A", "content": "b"}), ("nope", {}), "Done."],
        answers=["yes"],
    )
    h.agent.handle("go")
    entries = h.audit.entries()
    assert [e["tool"] for e in entries] == ["current_datetime", "create_note", "nope"]
    assert [e["outcome"] for e in entries] == ["auto", "approved", "refused"]
    for entry in entries:
        assert {"time", "tool", "inputs", "tier", "outcome", "approved", "result", "prev", "hash"} <= set(entry)
    assert entries[1]["approved"] is True and entries[1]["inputs"] == {"title": "A", "content": "b"}
    assert "Tuesday" in entries[0]["result"]


def test_log_only_grows_and_chain_verifies(tmp_path):
    log = AuditLog(tmp_path / "audit.log")
    log.record("a", {"x": 1}, "auto", "one")
    first = (tmp_path / "audit.log").read_bytes()
    log.record("b", {"x": 2}, "approved", "two", approved=True)
    AuditLog(tmp_path / "audit.log").record("c", {}, "declined", "three", approved=False)   # a later session
    assert (tmp_path / "audit.log").read_bytes().startswith(first)
    assert len(log.entries()) == 3
    ok, message = log.verify()
    assert ok and "3 entries" in message


def _lines(path):
    return path.read_text(encoding="utf-8").splitlines()


def _three(tmp_path):
    log = AuditLog(tmp_path / "audit.log")
    for name in ("a", "b", "c"):
        log.record(name, {"n": name}, "auto", name)
    return log, tmp_path / "audit.log"


def test_editing_an_entry_is_detected(tmp_path):
    log, path = _three(tmp_path)
    lines = _lines(path)
    entry = json.loads(lines[1])
    entry["inputs"] = {"n": "tampered"}
    lines[1] = json.dumps(entry)
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    ok, message = log.verify()
    assert not ok and "Line 2" in message


def test_removing_an_entry_is_detected(tmp_path):
    log, path = _three(tmp_path)
    lines = _lines(path)
    path.write_text("\n".join([lines[0], lines[2]]) + "\n", encoding="utf-8")
    assert log.verify()[0] is False


def test_garbage_in_the_log_is_detected(tmp_path):
    log, path = _three(tmp_path)
    with open(path, "a", encoding="utf-8") as handle:
        handle.write("not json\n")
    assert log.verify()[0] is False


def test_the_audit_log_cannot_be_read_or_written_through_tools(harness, config):
    h = harness([("read_file", {"path": str(config.audit_path)}), "No."])
    h.agent.handle("show me the audit log file")
    assert h.outcomes("read_file") == ["error"]
    assert "sensitive" in h.tool_messages()[0]
