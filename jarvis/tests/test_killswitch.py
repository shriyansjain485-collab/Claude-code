"""Rule 6: one command stops the assistant immediately."""

import os
import signal
import subprocess
import time

from conftest import PYTHON, subprocess_env, write_config
from fake_ollama import FakeOllama, say
from jarvis.safety import killswitch


def start_jarvis(tmp_path, fake):
    config_path = write_config(tmp_path, fake.url)
    process = subprocess.Popen(
        [PYTHON, "-m", "jarvis", "--config", str(config_path)],
        stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True,
        env=subprocess_env(), cwd=tmp_path,
    )
    pidfile = tmp_path / "data" / "jarvis.pid"
    deadline = time.monotonic() + 15
    while not pidfile.exists() and time.monotonic() < deadline:
        time.sleep(0.05)
    assert pidfile.exists(), "Jarvis did not start"
    return process, config_path


def stop_command(config_path):
    return subprocess.run(
        [PYTHON, "-m", "jarvis", "--config", str(config_path), "stop"],
        capture_output=True, text=True, env=subprocess_env(), timeout=30,
    )


def test_stop_command_ends_a_running_jarvis_at_once(tmp_path):
    with FakeOllama([]) as fake:
        process, config_path = start_jarvis(tmp_path, fake)
        try:
            started = time.monotonic()
            result = stop_command(config_path)
            process.wait(timeout=5)
            assert time.monotonic() - started < 5
            assert result.returncode == 0 and "stopped" in result.stdout.lower()
            assert process.returncode is not None
            assert not (tmp_path / "data" / "jarvis.pid").exists()
        finally:
            process.kill()


def test_stop_works_even_while_the_model_is_mid_answer(tmp_path):
    with FakeOllama([say("a very slow answer", delay=30)]) as fake:
        process, config_path = start_jarvis(tmp_path, fake)
        try:
            process.stdin.write("tell me a long story\n")
            process.stdin.flush()
            while not fake.requests:
                time.sleep(0.05)
            result = stop_command(config_path)
            process.wait(timeout=5)
            assert result.returncode == 0
        finally:
            process.kill()


def test_ctrl_c_cancels_the_current_action_but_keeps_jarvis_running(tmp_path):
    with FakeOllama([say("a very slow answer", delay=30), say("Still here, sir.")]) as fake:
        process, config_path = start_jarvis(tmp_path, fake)
        try:
            process.stdin.write("tell me a long story\n")
            process.stdin.flush()
            while not fake.requests:
                time.sleep(0.05)
            time.sleep(0.2)
            process.send_signal(signal.SIGINT)              # Ctrl+C
            output, _ = process.communicate("are you there?\n/stop\n", timeout=20)
            assert "Stopped, sir." in output
            assert "Still here, sir." in output and "Goodbye, sir." in output
            assert process.returncode == 0
        finally:
            process.kill()


def test_stop_when_nothing_is_running(tmp_path):
    result = stop_command(write_config(tmp_path, "http://127.0.0.1:9"))
    assert result.returncode == 1 and "does not appear to be running" in result.stdout


def test_stop_never_kills_a_process_that_is_not_jarvis(tmp_path):
    bystander = subprocess.Popen(["sleep", "30"])
    try:
        (tmp_path / "jarvis.pid").write_text(f"{bystander.pid}\n", encoding="utf-8")
        stopped, message = killswitch.stop_running(tmp_path)
        assert stopped is False and "not Jarvis" in message
        assert bystander.poll() is None                     # still alive
    finally:
        bystander.kill()


def test_stale_or_garbage_pidfile_is_handled(tmp_path):
    (tmp_path / "jarvis.pid").write_text("not-a-number\n", encoding="utf-8")
    assert killswitch.stop_running(tmp_path)[0] is False
    (tmp_path / "jarvis.pid").write_text(f"{os.getpid()}\n", encoding="utf-8")
    assert killswitch.stop_running(tmp_path)[0] is False    # never stops itself
