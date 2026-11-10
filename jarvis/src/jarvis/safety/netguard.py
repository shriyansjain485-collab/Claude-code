"""Network guard: blocks every connection that is not to this computer.

Once `install()` has run, any attempt by any Python code in this process to
connect to, or look up, an address other than localhost raises
`OutboundConnectionBlocked` and is recorded in `blocked_attempts`.

It also sets the standard "no telemetry / stay offline" environment variables
so that libraries added later (e.g. for voice) do not phone home.
"""

from __future__ import annotations

import ipaddress
import os
import socket
from typing import Callable

LOOPBACK_NAMES = {"localhost", "localhost.localdomain", "ip6-localhost"}

# Opt-outs honoured by common libraries. Harmless if the library is absent.
NO_TELEMETRY_ENV = {
    "DO_NOT_TRACK": "1",
    "HF_HUB_OFFLINE": "1",
    "HF_HUB_DISABLE_TELEMETRY": "1",
    "TRANSFORMERS_OFFLINE": "1",
    "HF_DATASETS_OFFLINE": "1",
    "PIP_DISABLE_PIP_VERSION_CHECK": "1",
    "ANONYMIZED_TELEMETRY": "False",
    "OLLAMA_NO_CLOUD": "1",
}


class OutboundConnectionBlocked(ConnectionError):
    """Raised when code tries to reach anything other than localhost."""


blocked_attempts: list[str] = []
_listeners: list[Callable[[str], None]] = []
_installed = False
_original: dict[str, object] = {}


def is_loopback_host(host: object) -> bool:
    """True if `host` can only ever mean this computer."""
    if host is None or host == "" or host == b"":
        # In getaddrinfo, None means "this machine".
        return True
    if isinstance(host, bytes):
        try:
            host = host.decode("ascii")
        except UnicodeDecodeError:
            return False
    if not isinstance(host, str):
        return False
    name = host.strip().lower().rstrip(".")
    if name in LOOPBACK_NAMES:
        return True
    try:
        ip = ipaddress.ip_address(name.split("%", 1)[0].strip("[]"))
    except ValueError:
        return False
    if isinstance(ip, ipaddress.IPv6Address) and ip.ipv4_mapped:
        ip = ip.ipv4_mapped
    return ip.is_loopback


def add_listener(callback: Callable[[str], None]) -> None:
    """Call `callback(description)` whenever a connection is blocked."""
    _listeners.append(callback)


def remove_listener(callback: Callable[[str], None]) -> None:
    if callback in _listeners:
        _listeners.remove(callback)


def _block(what: str) -> None:
    blocked_attempts.append(what)
    for callback in list(_listeners):
        try:
            callback(what)
        except Exception:
            pass
    raise OutboundConnectionBlocked(
        f"Blocked by Jarvis offline guard: {what}. "
        "Only connections to this computer (localhost) are allowed."
    )


def _check_address(sock: socket.socket, address: object, action: str) -> None:
    family = sock.family
    if family == getattr(socket, "AF_UNIX", object()):
        return  # a file on this computer, not the network
    if family in (socket.AF_INET, socket.AF_INET6):
        host = address[0] if isinstance(address, tuple) and address else address
        if is_loopback_host(host) and host not in (None, "", b""):
            return
        _block(f"{action} to {address!r}")
    _block(f"{action} using unsupported socket family {family!r}")


def install() -> None:
    """Install the guard. Safe to call more than once."""
    global _installed
    for key, value in NO_TELEMETRY_ENV.items():
        os.environ[key] = value
    if _installed:
        return

    real_connect = socket.socket.connect
    real_connect_ex = socket.socket.connect_ex
    real_sendto = socket.socket.sendto
    real_getaddrinfo = socket.getaddrinfo
    real_gethostbyname = socket.gethostbyname
    real_gethostbyname_ex = socket.gethostbyname_ex
    _original.update(
        connect=real_connect,
        connect_ex=real_connect_ex,
        sendto=real_sendto,
        getaddrinfo=real_getaddrinfo,
        gethostbyname=real_gethostbyname,
        gethostbyname_ex=real_gethostbyname_ex,
    )

    def connect(self, address):
        _check_address(self, address, "connection")
        return real_connect(self, address)

    def connect_ex(self, address):
        _check_address(self, address, "connection")
        return real_connect_ex(self, address)

    def sendto(self, data, *args):
        _check_address(self, args[-1] if args else None, "send")
        return real_sendto(self, data, *args)

    def getaddrinfo(host, *args, **kwargs):
        if not is_loopback_host(host):
            _block(f"name lookup for {host!r}")
        return real_getaddrinfo(host, *args, **kwargs)

    def gethostbyname(host):
        if not is_loopback_host(host):
            _block(f"name lookup for {host!r}")
        return real_gethostbyname(host)

    def gethostbyname_ex(host):
        if not is_loopback_host(host):
            _block(f"name lookup for {host!r}")
        return real_gethostbyname_ex(host)

    socket.socket.connect = connect
    socket.socket.connect_ex = connect_ex
    socket.socket.sendto = sendto
    socket.getaddrinfo = getaddrinfo
    socket.gethostbyname = gethostbyname
    socket.gethostbyname_ex = gethostbyname_ex
    _installed = True


def is_installed() -> bool:
    return _installed
