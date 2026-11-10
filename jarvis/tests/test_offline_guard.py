"""The offline guarantee: nothing but localhost, ever."""

import os
import socket
import subprocess
import textwrap
import urllib.request

import pytest

from conftest import JARVIS_DIR, PYTHON, SRC
from jarvis.safety import netguard
from jarvis.safety.netguard import OutboundConnectionBlocked

PUBLIC_IP = "93.184.216.34"


@pytest.mark.expects_blocked
def test_tcp_connection_to_the_internet_is_blocked():
    with socket.socket() as sock:
        with pytest.raises(OutboundConnectionBlocked):
            sock.connect((PUBLIC_IP, 80))
    with socket.socket() as sock:
        with pytest.raises(OutboundConnectionBlocked):
            sock.connect_ex((PUBLIC_IP, 443))
    with pytest.raises(OutboundConnectionBlocked):
        socket.create_connection((PUBLIC_IP, 80), timeout=1)
    assert any(PUBLIC_IP in attempt for attempt in netguard.blocked_attempts)


@pytest.mark.expects_blocked
def test_local_network_addresses_are_blocked_too():
    for host in ("192.168.1.1", "10.0.0.1", "0.0.0.0", "169.254.169.254"):
        with socket.socket(socket.AF_INET) as sock:
            with pytest.raises(OutboundConnectionBlocked):
                sock.connect((host, 80))


@pytest.mark.expects_blocked
def test_name_lookups_are_blocked():
    for lookup in (
        lambda: socket.getaddrinfo("example.com", 443),
        lambda: socket.gethostbyname("example.com"),
        lambda: socket.gethostbyname_ex("example.com"),
        lambda: socket.create_connection(("ollama.com", 443), timeout=1),
    ):
        with pytest.raises(OutboundConnectionBlocked):
            lookup()


@pytest.mark.expects_blocked
def test_udp_is_blocked():
    with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as sock:
        with pytest.raises(OutboundConnectionBlocked):
            sock.sendto(b"x", ("8.8.8.8", 53))


@pytest.mark.expects_blocked
def test_ordinary_http_libraries_are_blocked():
    with pytest.raises(Exception) as caught:
        urllib.request.urlopen("http://example.com/", timeout=1)
    assert "offline guard" in str(caught.value)


def test_localhost_still_works():
    server = socket.socket()
    server.bind(("127.0.0.1", 0))
    server.listen(1)
    try:
        socket.create_connection(("127.0.0.1", server.getsockname()[1]), timeout=2).close()
        socket.getaddrinfo("localhost", 80)
    finally:
        server.close()


@pytest.mark.parametrize("host", ["127.0.0.1", "localhost", "::1", "127.8.9.1", "LOCALHOST", "[::1]", None])
def test_loopback_detection_accepts(host):
    assert netguard.is_loopback_host(host)


@pytest.mark.parametrize(
    "host",
    ["8.8.8.8", "example.com", "0.0.0.0", "192.168.0.5", "127.0.0.1.evil.com", "localhost.evil.com", "::ffff:8.8.8.8", "2130706433x", 5],
)
def test_loopback_detection_rejects(host):
    assert not netguard.is_loopback_host(host)


def test_telemetry_opt_outs_are_set():
    for key, value in netguard.NO_TELEMETRY_ENV.items():
        assert os.environ.get(key) == value


def test_guard_is_installed_before_anything_else_at_startup():
    text = (SRC / "jarvis" / "__main__.py").read_text(encoding="utf-8")
    assert text.index("netguard.install()") < text.index("from jarvis.cli import main")


def _run_pytest_on(tmp_path, body: str) -> subprocess.CompletedProcess:
    test_file = tmp_path / "test_sneaky.py"
    test_file.write_text(textwrap.dedent(body), encoding="utf-8")
    env = dict(os.environ, PYTHONPATH=f"{SRC}{os.pathsep}{JARVIS_DIR / 'tests'}")
    return subprocess.run(
        [PYTHON, "-m", "pytest", "-q", "-p", "offline_plugin", "-p", "no:cacheprovider", "--rootdir", str(tmp_path), str(test_file)],
        capture_output=True, text=True, env=env, cwd=tmp_path, timeout=60,
    )


def test_the_suite_fails_if_any_code_tries_an_outbound_connection(tmp_path):
    """Code that phones home and hides the error still fails the test run."""
    result = _run_pytest_on(tmp_path, """
        import socket

        def test_sneaky_code():
            try:
                socket.create_connection(("93.184.216.34", 80), timeout=1)
            except Exception:
                pass          # the code swallows the error...
    """)
    assert result.returncode != 0
    assert "tried to open an outbound network connection" in result.stdout


def test_the_same_check_passes_for_well_behaved_code(tmp_path):
    result = _run_pytest_on(tmp_path, """
        def test_well_behaved():
            assert 1 + 1 == 2
    """)
    assert result.returncode == 0, result.stdout
