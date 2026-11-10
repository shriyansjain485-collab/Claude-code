"""Run the real assistant as a separate program with networking blocked."""

import json
import os
import shutil
import subprocess

import pytest

from conftest import JARVIS_DIR, PYTHON, subprocess_env, write_config
from fake_ollama import FakeOllama, call, say
from jarvis.safety import netguard

IN_NETNS = os.environ.get("JARVIS_IN_NETNS") == "1"


def run_jarvis(tmp_path, fake, typed: str, *args):
    config_path = write_config(tmp_path, fake.url)
    return subprocess.run(
        [PYTHON, "-m", "jarvis", "--config", str(config_path), *args],
        input=typed, capture_output=True, text=True, env=subprocess_env(), cwd=tmp_path, timeout=60,
    )


def audit_entries(tmp_path):
    path = tmp_path / "data" / "audit.log"
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines()] if path.exists() else []


def test_full_conversation_with_a_read_and_an_approved_write(tmp_path):
    script = [
        say("Good morning, sir. All systems are local."),
        call("current_datetime"),
        say("It is Tuesday, sir."),
        call("create_note", title="Shopping", content="milk, eggs"),
        say("Noted, sir."),
    ]
    with FakeOllama(script) as fake:
        result = run_jarvis(tmp_path, fake, "hello\nwhat day is it?\nsave a shopping note\nyes\n/stop\n")
        requests = fake.requests
    assert result.returncode == 0, result.stdout + result.stderr
    out = result.stdout
    assert "offline guard: ON" in out
    assert "Jarvis: Good morning, sir. All systems are local." in out
    assert "It is Tuesday, sir." in out
    assert "APPROVAL NEEDED" in out and "+ milk, eggs" in out and "Applied." in out
    assert "Goodbye, sir." in out
    assert (tmp_path / "data" / "notes" / "shopping.md").read_text(encoding="utf-8") == "# Shopping\n\nmilk, eggs\n"

    entries = audit_entries(tmp_path)
    assert [(e["tool"], e["outcome"]) for e in entries] == [("current_datetime", "auto"), ("create_note", "approved")]
    assert not [e for e in entries if e["tool"] == "network_guard"]      # nothing tried to phone home
    assert len(requests) == 5
    tool_names = {t["function"]["name"] for t in requests[0]["tools"]}
    assert {"find_files", "read_file", "create_note", "ask_user"} <= tool_names
    assert not (tmp_path / "data" / "jarvis.pid").exists()               # cleaned up on exit


def test_declined_write_changes_nothing(tmp_path):
    with FakeOllama([call("create_note", title="Shopping", content="milk"), say("Very good, sir.")]) as fake:
        result = run_jarvis(tmp_path, fake, "save a note\nno\n/stop\n")
    assert "Cancelled. Nothing was changed." in result.stdout
    assert not (tmp_path / "data" / "notes" / "shopping.md").exists()
    assert audit_entries(tmp_path)[0]["outcome"] == "declined"


def test_dry_run_flag_changes_nothing(tmp_path):
    with FakeOllama([call("create_note", title="Shopping", content="milk"), say("A dry run, sir.")]) as fake:
        result = run_jarvis(tmp_path, fake, "save a note\n/stop\n", "--dry-run")
    assert "DRY RUN is on" in result.stdout and "[DRY RUN] create_note would do this" in result.stdout
    assert not (tmp_path / "data" / "notes" / "shopping.md").exists()
    assert audit_entries(tmp_path)[0]["outcome"] == "dry_run"


def test_refuses_to_start_with_a_non_local_model_host(tmp_path):
    config_path = write_config(tmp_path, "http://203.0.113.9:11434")
    result = subprocess.run(
        [PYTHON, "-m", "jarvis", "--config", str(config_path)],
        input="hello\n", capture_output=True, text=True, env=subprocess_env(), timeout=30,
    )
    assert result.returncode == 2 and "only talks to localhost" in result.stdout


def test_missing_model_server_gives_a_helpful_message(tmp_path):
    with FakeOllama([]) as fake:
        url = fake.url
    config_path = write_config(tmp_path, url)                    # server is now gone
    result = subprocess.run(
        [PYTHON, "-m", "jarvis", "--config", str(config_path)],
        input="hello\n", capture_output=True, text=True, env=subprocess_env(), timeout=30,
    )
    assert result.returncode == 1 and "can't reach the local model server" in result.stdout


def test_audit_verify_and_tools_commands(tmp_path):
    with FakeOllama([call("current_datetime"), say("Tuesday.")]) as fake:
        run_jarvis(tmp_path, fake, "day?\n/stop\n")
        config_path = str(tmp_path / "config.toml")
    verify = subprocess.run([PYTHON, "-m", "jarvis", "--config", config_path, "audit", "verify"], capture_output=True, text=True, env=subprocess_env())
    assert verify.returncode == 0 and "intact: 1 entries" in verify.stdout
    listing = subprocess.run([PYTHON, "-m", "jarvis", "--config", config_path, "tools"], capture_output=True, text=True, env=subprocess_env())
    assert "create_note" in listing.stdout and "[asks first]" in listing.stdout and "[automatic]" in listing.stdout


# ---- Operating-system level proof: a network namespace with NO internet at all

@pytest.mark.skipif(not IN_NETNS, reason="only runs inside the no-network namespace")
def test_inside_namespace_there_really_is_no_network():
    """Bypass Jarvis's own guard: the operating system itself has no route out."""
    import socket

    with socket.socket() as sock:
        sock.settimeout(2)
        with pytest.raises(OSError):
            netguard._original["connect"](sock, ("93.184.216.34", 80))


@pytest.mark.skipif(IN_NETNS, reason="already inside the namespace")
@pytest.mark.skipif(shutil.which("unshare") is None, reason="needs Linux 'unshare' (on macOS use scripts/offline_check.sh)")
def test_conversation_works_with_networking_removed_by_the_operating_system():
    probe = subprocess.run(["unshare", "-rn", "true"], capture_output=True)
    if probe.returncode != 0:
        pytest.skip("this system does not allow unprivileged network namespaces")
    env = dict(os.environ, JARVIS_IN_NETNS="1")
    result = subprocess.run(
        ["unshare", "-rn", PYTHON, "-m", "pytest", "-q", "-p", "no:cacheprovider", "tests/test_offline_conversation.py"],
        capture_output=True, text=True, env=env, cwd=JARVIS_DIR, timeout=180,
    )
    assert result.returncode == 0, result.stdout + result.stderr
    assert "7 passed" in result.stdout and "failed" not in result.stdout
