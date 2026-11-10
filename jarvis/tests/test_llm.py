import pytest

from fake_ollama import FakeOllama, call, say
from jarvis.config import Config, ConfigError
from jarvis.llm import ModelError, OllamaClient


def client_for(fake, tmp_path, **overrides):
    return OllamaClient(Config(base_dir=tmp_path, model_name="test-model", model_host=fake.url, timeout_seconds=10, **overrides))


def test_streamed_text_reply(tmp_path):
    with FakeOllama([say("Good morning, sir.")]) as fake:
        pieces = []
        reply = client_for(fake, tmp_path).chat([{"role": "user", "content": "hi"}], [], pieces.append)
        assert reply.content == "Good morning, sir." and reply.tool_calls == []
        assert "".join(pieces) == "Good morning, sir." and len(pieces) > 1
        request = fake.requests[0]
        assert request["model"] == "test-model" and request["stream"] is True and request["think"] is False


def test_tool_call_reply(tmp_path):
    with FakeOllama([call("calculate", expression="2+2")]) as fake:
        reply = client_for(fake, tmp_path).chat([{"role": "user", "content": "2+2?"}], [{"type": "function"}])
        assert reply.tool_calls == [{"name": "calculate", "arguments": {"expression": "2+2"}}]
        assert fake.requests[0]["tools"] == [{"type": "function"}]


def test_check_ready_passes_when_model_is_installed(tmp_path):
    with FakeOllama([]) as fake:
        client_for(fake, tmp_path).check_ready()


def test_missing_model_explains_the_one_time_download(tmp_path):
    with FakeOllama([], models=["other:latest"]) as fake:
        with pytest.raises(ModelError, match="ollama pull test-model"):
            client_for(fake, tmp_path).check_ready()


def test_server_not_running_gives_a_helpful_message(tmp_path):
    with FakeOllama([]) as fake:
        url = fake.url
    client = OllamaClient(Config(base_dir=tmp_path, model_name="m", model_host=url))
    with pytest.raises(ModelError, match="run.sh"):
        client.check_ready()


def test_client_refuses_non_local_hosts_and_cloud_models(tmp_path):
    with pytest.raises(ConfigError):
        OllamaClient(Config(base_dir=tmp_path, model_host="http://203.0.113.5:11434"))
    with pytest.raises(ConfigError):
        OllamaClient(Config(base_dir=tmp_path, model_name="qwen3.5:cloud"))
