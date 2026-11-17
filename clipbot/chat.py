"""Read-only Twitch chat listener. Chat spikes ("KEKW", "CLIP IT", "?????") are the
best signal that something clip-worthy just happened. Anonymous login: no account,
no token, and it never sends a message."""

from __future__ import annotations

import random
import re
import socket
import ssl
import threading
import time
from collections import Counter

HYPE = re.compile(
    r"\b(clip(\s*it|\s*that)?|kekw|lul|lmao+|omegalul|pog(gers|champ|u)?|w+|l+|no\s*way|"
    r"holy|wtf|omg|insane|lets\s*go+|ez|gg)\b|\?{3,}|!{3,}|😂|🤣|💀|🔥",
    re.I,
)


class TwitchChat(threading.Thread):
    def __init__(self, channel: str):
        super().__init__(daemon=True)
        self.channel = channel.lower().lstrip("#")
        self.weights: Counter[int] = Counter()  # wall-clock second -> weighted messages
        self.lock = threading.Lock()
        self.connected = False
        self.error: str | None = None
        self._stop = threading.Event()

    def run(self) -> None:
        while not self._stop.is_set():
            try:
                self._listen()
            except OSError as exc:
                self.connected = False
                self.error = str(exc)
                time.sleep(5)

    def _listen(self) -> None:
        raw = socket.create_connection(("irc.chat.twitch.tv", 6697), timeout=30)
        sock = ssl.create_default_context().wrap_socket(raw, server_hostname="irc.chat.twitch.tv")
        nick = f"justinfan{random.randint(10000, 99999)}"
        sock.sendall(f"NICK {nick}\r\nJOIN #{self.channel}\r\n".encode())
        self.connected = True
        buf = b""
        while not self._stop.is_set():
            data = sock.recv(4096)
            if not data:
                raise OSError("chat connection closed")
            buf += data
            *lines, buf = buf.split(b"\r\n")
            for line in lines:
                text = line.decode("utf-8", "replace")
                if text.startswith("PING"):
                    sock.sendall(b"PONG :tmi.twitch.tv\r\n")
                elif " PRIVMSG " in text:
                    message = text.split(" :", 1)[1] if " :" in text else ""
                    weight = 1.0 + 1.5 * min(3, len(HYPE.findall(message)))
                    with self.lock:
                        self.weights[int(time.time())] += weight

    def activity(self, seconds: int = 5) -> float:
        """Weighted messages per second over the last few seconds."""
        now = int(time.time())
        with self.lock:
            total = sum(self.weights.get(now - i, 0.0) for i in range(seconds))
            for old in [k for k in self.weights if k < now - 120]:
                del self.weights[old]
        return total / seconds

    def stop(self) -> None:
        self._stop.set()
