"""Talks to the local model server (Ollama) on this computer.

Uses only Python's built-in HTTP client, and only ever a localhost address
(checked in config.py and again by the network guard).
"""

from __future__ import annotations

import http.client
import json
from dataclasses import dataclass, field
from typing import Callable
from urllib.parse import urlsplit

from jarvis.config import Config, check_model_host, check_model_name


class ModelError(Exception):
    """The local model could not answer. The message explains what to do."""


@dataclass
class ModelReply:
    content: str = ""
    tool_calls: list[dict] = field(default_factory=list)  # [{"name": str, "arguments": object}]
    raw_tool_calls: list[dict] = field(default_factory=list)


class OllamaClient:
    def __init__(self, config: Config):
        self.host = check_model_host(config.model_host)
        self.model = check_model_name(config.model_name)
        self.config = config
        parts = urlsplit(self.host)
        self._address = (parts.hostname, parts.port or 80)
        self._connection: http.client.HTTPConnection | None = None

    def _connect(self, timeout: float) -> http.client.HTTPConnection:
        connection = http.client.HTTPConnection(*self._address, timeout=timeout)
        self._connection = connection
        return connection

    def cancel(self) -> None:
        """Drop the connection, which makes the model stop generating."""
        connection, self._connection = self._connection, None
        if connection is not None:
            try:
                connection.close()
            except Exception:
                pass

    def _unreachable(self, error: Exception) -> ModelError:
        return ModelError(
            f"I can't reach the local model server at {self.host} ({error}). "
            "Start it with ./run.sh, or run 'ollama serve' in another terminal."
        )

    def installed_models(self) -> list[str]:
        connection = self._connect(timeout=5)
        try:
            connection.request("GET", "/api/tags")
            response = connection.getresponse()
            body = response.read()
        except (OSError, http.client.HTTPException) as error:
            raise self._unreachable(error) from None
        finally:
            self.cancel()
        if response.status != 200:
            raise ModelError(f"The model server answered with an error ({response.status}).")
        try:
            return [str(model.get("name", "")) for model in json.loads(body).get("models", [])]
        except (ValueError, AttributeError):
            raise ModelError("The model server sent a reply I could not understand.") from None

    def check_ready(self) -> None:
        """Confirm the server is up and the configured model is on this computer."""
        installed = self.installed_models()
        wanted = self.model if ":" in self.model else f"{self.model}:latest"
        if wanted not in installed and self.model not in installed:
            listed = ", ".join(installed) or "none"
            raise ModelError(
                f"The model '{self.model}' is not downloaded yet (found: {listed}). "
                f"One-time download while online:  ollama pull {self.model}"
            )

    def chat(
        self,
        messages: list[dict],
        tools: list[dict],
        on_text: Callable[[str], None] | None = None,
    ) -> ModelReply:
        payload = {
            "model": self.model,
            "messages": messages,
            "tools": tools,
            "stream": True,
            "think": self.config.think,
            "options": {
                "temperature": self.config.temperature,
                "num_ctx": self.config.context_tokens,
            },
        }
        reply = ModelReply()
        connection = self._connect(timeout=self.config.timeout_seconds)
        try:
            connection.request(
                "POST",
                "/api/chat",
                body=json.dumps(payload).encode("utf-8"),
                headers={"Content-Type": "application/json"},
            )
            response = connection.getresponse()
            if response.status != 200:
                detail = response.read(2000).decode("utf-8", errors="replace")
                raise ModelError(f"The model server refused the request ({response.status}): {detail}")
            for line in response:
                line = line.strip()
                if not line:
                    continue
                try:
                    chunk = json.loads(line)
                except ValueError:
                    continue
                if chunk.get("error"):
                    raise ModelError(f"The model reported an error: {chunk['error']}")
                message = chunk.get("message") or {}
                text = message.get("content") or ""
                if text:
                    reply.content += text
                    if on_text:
                        on_text(text)
                for call in message.get("tool_calls") or []:
                    function = (call or {}).get("function") or {}
                    reply.raw_tool_calls.append(call)
                    reply.tool_calls.append(
                        {"name": function.get("name"), "arguments": function.get("arguments")}
                    )
                if chunk.get("done"):
                    break
        except (OSError, http.client.HTTPException) as error:
            raise self._unreachable(error) from None
        finally:
            self.cancel()
        return reply
