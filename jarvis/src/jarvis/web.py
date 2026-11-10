"""The browser window: a small web page served ONLY to this computer.

Start with `./run.sh --ui` and open the address it prints.

Safety properties:
- The server binds to 127.0.0.1. That address is fixed in code, not a setting.
- Every request must carry a secret token created at start-up, so other
  programs or web pages on this computer cannot drive Jarvis.
- The Host and Origin headers are checked, which stops other websites from
  reaching it through the browser.
- The page loads nothing from the internet (no fonts, scripts or images).
- Approvals work exactly as in the terminal: a change is applied only after
  you click the explicit "Yes, apply" button for that specific change.
"""

from __future__ import annotations

import hmac
import json
import secrets
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from jarvis import __version__
from jarvis.agent import Agent, UserIO
from jarvis.config import Config
from jarvis.llm import Cancelled, ModelError
from jarvis.safety import killswitch
from jarvis.safety.audit import AuditLog
from jarvis.tools.base import Tier, Tool
from jarvis.tools.registry import Registry

BIND_ADDRESS = "127.0.0.1"   # never anything else
MAX_BODY_BYTES = 100_000
MAX_MESSAGE_CHARS = 8000
APPROVAL_TIMEOUT_SECONDS = 600
PAGE = Path(__file__).resolve().parent / "ui" / "index.html"

SECURITY_HEADERS = {
    "Content-Security-Policy": (
        "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; "
        "img-src 'self' data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"
    ),
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "no-referrer",
    "Cache-Control": "no-store",
}


class _Turn:
    """One message being answered: its event stream and any pending approval."""

    def __init__(self, emit):
        self.emit = emit
        self.cancelled = False
        self.approval_id: str | None = None
        self.approval_answer = False
        self.approval_event = threading.Event()


class WebApp:
    def __init__(self, config: Config, registry: Registry, client, audit: AuditLog):
        self.config = config
        self.registry = registry
        self.client = client
        self.audit = audit
        self.token = secrets.token_urlsafe(32)
        self._busy = threading.Lock()
        self._turn: _Turn | None = None
        self.agent = Agent(
            config, client, registry, audit,
            UserIO(approve=self._approve, notify=self._notify, on_text=self._on_text),
        )

    # ---- callbacks from the agent (run on the thread answering the message)

    def _on_text(self, text: str) -> None:
        if self._turn:
            self._turn.emit({"type": "text", "text": text})

    def _notify(self, text: str) -> None:
        if self._turn:
            self._turn.emit({"type": "notice", "text": text})

    def _approve(self, tool: Tool, preview: str, sources_read: list[str]) -> bool:
        turn = self._turn
        if turn is None or turn.cancelled:
            return False
        turn.approval_id = secrets.token_urlsafe(16)
        turn.approval_answer = False
        turn.approval_event.clear()
        turn.emit({
            "type": "approval", "id": turn.approval_id, "tool": tool.name,
            "preview": preview, "sources": sources_read,
        })
        turn.approval_event.wait(APPROVAL_TIMEOUT_SECONDS)   # no answer = not approved
        approved = turn.approval_answer and not turn.cancelled
        turn.approval_id = None
        turn.emit({"type": "approval_result", "approved": approved})
        return approved

    # ---- actions called by the HTTP handler

    def state(self) -> dict:
        return {
            "name": self.config.assistant_name,
            "address": self.config.address_user_as,
            "version": __version__,
            "model": self.config.model_name,
            "dry_run": self.agent.dry_run,
            "busy": self._busy.locked(),
            "allowed_folders": [str(folder) for folder in self.config.allowed_folders],
            "tools": [
                {
                    "name": tool.name,
                    "asks_first": tool.tier is Tier.WRITE,
                    "online": tool.requires_network,
                    "description": tool.description.splitlines()[0],
                }
                for tool in self.registry.all()
            ],
        }

    def recent_audit(self, count: int = 30) -> list[dict]:
        keys = ("time", "tool", "outcome", "inputs", "result")
        return [{key: entry.get(key) for key in keys} for entry in self.audit.entries()[-count:]]

    def answer(self, text: str, emit) -> bool:
        """Answer one message, sending events through `emit`. False if busy."""
        if not self._busy.acquire(blocking=False):
            return False
        turn = _Turn(emit)
        self._turn = turn
        self.client.reset_interrupt()
        try:
            reply = self.agent.handle(text)
            emit({"type": "done", "text": reply})
        except Cancelled:
            self.agent.messages.append({"role": "assistant", "content": "(The user cancelled this.)"})
            emit({"type": "stopped", "text": f"Stopped, {self.config.address_user_as}."})
        except ModelError as error:
            emit({"type": "error", "text": str(error)})
        except Exception as error:   # never leave the page hanging
            emit({"type": "error", "text": f"Something went wrong ({type(error).__name__})."})
        finally:
            self._turn = None
            self._busy.release()
        return True

    def resolve_approval(self, approval_id: object, approve: object) -> bool:
        turn = self._turn
        if turn is None or not turn.approval_id or not isinstance(approval_id, str):
            return False
        if not hmac.compare_digest(turn.approval_id, approval_id):
            return False            # an old or made-up approval: ignored
        turn.approval_answer = approve is True
        turn.approval_event.set()
        return True

    def cancel(self) -> None:
        """The Stop button: stop the model and decline anything pending."""
        turn = self._turn
        if turn is not None:
            turn.cancelled = True
            turn.approval_event.set()
        self.client.interrupt()

    def set_dry_run(self, on: object) -> bool:
        self.agent.dry_run = on is True
        return self.agent.dry_run


def make_server(app: WebApp, port: int) -> ThreadingHTTPServer:
    class Handler(BaseHTTPRequestHandler):
        server_version = "Jarvis"
        sys_version = ""

        def log_message(self, *args):
            pass

        # ---- helpers

        def _send(self, status: int, body: bytes, content_type: str) -> None:
            self.send_response(status)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(body)))
            for key, value in SECURITY_HEADERS.items():
                self.send_header(key, value)
            self.end_headers()
            self.wfile.write(body)

        def _json(self, status: int, data: object) -> None:
            self._send(status, json.dumps(data, default=str).encode("utf-8"), "application/json")

        def _local_names(self) -> set[str]:
            actual = self.server.server_address[1]
            return {f"127.0.0.1:{actual}", f"localhost:{actual}"}

        def _guard(self, needs_token: bool) -> bool:
            """Reject anything that is not our own page on this computer."""
            if self.client_address[0] != "127.0.0.1":
                self._json(403, {"error": "local connections only"})
                return False
            if self.headers.get("Host", "") not in self._local_names():
                self._json(403, {"error": "bad host"})
                return False
            origin = self.headers.get("Origin")
            if origin is not None and origin not in {f"http://{name}" for name in self._local_names()}:
                self._json(403, {"error": "bad origin"})
                return False
            if needs_token:
                given = self.headers.get("X-Jarvis-Token", "")
                if not hmac.compare_digest(given.encode(), app.token.encode()):
                    self._json(401, {"error": "missing or wrong token: open the address printed in the terminal"})
                    return False
            return True

        def _body(self) -> dict | None:
            if self.headers.get("Content-Type", "").split(";")[0].strip() != "application/json":
                self._json(415, {"error": "json only"})
                return None
            try:
                length = int(self.headers.get("Content-Length", "0"))
            except ValueError:
                length = -1
            if not 0 <= length <= MAX_BODY_BYTES:
                self._json(413, {"error": "too large"})
                return None
            try:
                data = json.loads(self.rfile.read(length) or b"{}")
            except ValueError:
                data = None
            if not isinstance(data, dict):
                self._json(400, {"error": "bad json"})
                return None
            return data

        # ---- routes

        def do_GET(self):
            if self.path in ("/", "/index.html"):
                if self._guard(needs_token=False):
                    self._send(200, PAGE.read_bytes(), "text/html; charset=utf-8")
                return
            if self.path in ("/app.js", "/app.css"):
                if self._guard(needs_token=False):
                    kind = "text/javascript" if self.path.endswith(".js") else "text/css"
                    self._send(200, (PAGE.parent / self.path[1:]).read_bytes(), f"{kind}; charset=utf-8")
                return
            if not self._guard(needs_token=True):
                return
            if self.path == "/api/state":
                self._json(200, app.state())
            elif self.path == "/api/audit":
                self._json(200, {"entries": app.recent_audit()})
            else:
                self._json(404, {"error": "not found"})

        def do_POST(self):
            if not self._guard(needs_token=True):
                return
            data = self._body()
            if data is None:
                return
            if self.path == "/api/message":
                self._message(data)
            elif self.path == "/api/approve":
                self._json(200, {"ok": app.resolve_approval(data.get("id"), data.get("approve"))})
            elif self.path == "/api/cancel":
                app.cancel()
                self._json(200, {"ok": True})
            elif self.path == "/api/dry-run":
                self._json(200, {"dry_run": app.set_dry_run(data.get("on"))})
            elif self.path == "/api/shutdown":
                self._json(200, {"ok": True})
                app.cancel()
                threading.Thread(target=self.server.shutdown, daemon=True).start()
            else:
                self._json(404, {"error": "not found"})

        def _message(self, data: dict) -> None:
            text = data.get("text")
            if not isinstance(text, str) or not text.strip() or len(text) > MAX_MESSAGE_CHARS:
                self._json(400, {"error": "empty or too long"})
                return
            if app.state()["busy"]:
                self._json(409, {"error": "busy"})
                return
            self.send_response(200)
            self.send_header("Content-Type", "application/x-ndjson")
            for key, value in SECURITY_HEADERS.items():
                self.send_header(key, value)
            self.end_headers()

            def emit(event: dict) -> None:
                try:
                    self.wfile.write(json.dumps(event).encode("utf-8") + b"\n")
                    self.wfile.flush()
                except OSError:
                    app.cancel()    # the page went away: stop working

            if not app.answer(text.strip(), emit):
                emit({"type": "error", "text": "I am still busy with the previous request."})

    server = ThreadingHTTPServer((BIND_ADDRESS, port), Handler)
    server.daemon_threads = True
    return server


def serve(config: Config) -> int:
    from jarvis.cli import prepare

    prepared = prepare(config)
    if prepared is None:
        return 1
    registry, client, audit = prepared
    app = WebApp(config, registry, client, audit)
    try:
        server = make_server(app, config.ui_port)
    except OSError as error:
        print(f"Could not open port {config.ui_port} ({error}). Is Jarvis already running? Try ./stop.sh", flush=True)
        killswitch.remove_pidfile(config.data_dir)
        return 1
    url = f"http://{BIND_ADDRESS}:{server.server_address[1]}/#token={app.token}"
    print(f"{config.assistant_name} v{__version__}  ·  model: {config.model_name}  ·  offline guard: ON", flush=True)
    print("Open this address in your browser (hold Cmd and click it):\n", flush=True)
    print(f"    {url}\n", flush=True)
    print("It only works on this computer. Press Ctrl+C here, or run ./stop.sh, to stop.", flush=True)
    try:
        server.serve_forever(poll_interval=0.2)
    except KeyboardInterrupt:
        pass
    finally:
        app.cancel()
        server.server_close()
        client.cancel()
        killswitch.remove_pidfile(config.data_dir)
    print(f"Goodbye, {config.address_user_as}.", flush=True)
    return 0
