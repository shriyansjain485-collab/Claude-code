"""A stand-in for the Ollama model server, for tests.

It listens on 127.0.0.1 only and replies from a script, so tests need no
multi-gigabyte model download. It speaks the same /api/tags and /api/chat
(streaming) protocol that jarvis.llm uses.
"""

from __future__ import annotations

import json
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer


def say(text: str, delay: float = 0.0) -> dict:
    return {"content": text, "tool_calls": [], "delay": delay}


def call(name: str, **arguments) -> dict:
    return {"content": "", "tool_calls": [{"name": name, "arguments": arguments}], "delay": 0.0}


class FakeOllama:
    def __init__(self, script: list[dict], models: list[str] | None = None):
        self.script = list(script)
        self.models = models if models is not None else ["test-model:latest"]
        self.requests: list[dict] = []
        self._lock = threading.Lock()
        fake = self

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *args):
                pass

            def do_GET(self):
                if self.path != "/api/tags":
                    self.send_error(404)
                    return
                body = json.dumps({"models": [{"name": m} for m in fake.models]}).encode()
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)

            def do_POST(self):
                length = int(self.headers.get("Content-Length", "0"))
                request = json.loads(self.rfile.read(length) or b"{}")
                with fake._lock:
                    fake.requests.append(request)
                    step = fake.script.pop(0) if fake.script else say("(script finished)")
                self.send_response(200)
                self.send_header("Content-Type", "application/x-ndjson")
                self.end_headers()
                try:
                    if step.get("delay"):
                        time.sleep(step["delay"])
                    words = step["content"].split(" ") if step["content"] else []
                    for index, word in enumerate(words):
                        piece = word if index == 0 else " " + word
                        self._send({"message": {"role": "assistant", "content": piece}, "done": False})
                    final = {"role": "assistant", "content": ""}
                    if step["tool_calls"]:
                        final["tool_calls"] = [{"function": c} for c in step["tool_calls"]]
                    self._send({"message": final, "done": True})
                except (BrokenPipeError, ConnectionResetError):
                    pass

            def _send(self, chunk: dict):
                self.wfile.write(json.dumps(chunk).encode() + b"\n")
                self.wfile.flush()

        self.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.server.daemon_threads = True
        self.port = self.server.server_address[1]
        self.url = f"http://127.0.0.1:{self.port}"
        self._thread = threading.Thread(target=self.server.serve_forever, daemon=True)

    def __enter__(self):
        self._thread.start()
        return self

    def __exit__(self, *exc):
        self.server.shutdown()
        self.server.server_close()
