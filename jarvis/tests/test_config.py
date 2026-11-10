from pathlib import Path

import pytest

from jarvis import config as cfg

JARVIS_DIR = Path(__file__).resolve().parents[1]


def test_example_config_loads_with_safe_defaults(tmp_path):
    (tmp_path / "config.example.toml").write_text((JARVIS_DIR / "config.example.toml").read_text(encoding="utf-8"), encoding="utf-8")
    config = cfg.load(tmp_path / "config.toml")          # created from the example on first run
    assert (tmp_path / "config.toml").exists()
    assert config.assistant_name == "Jarvis" and config.address_user_as == "sir"
    assert config.model_name == "qwen3.5:9b" and config.model_host == "http://127.0.0.1:11434"
    assert config.dry_run is False and config.allow_online_tools is False
    assert config.allowed_folders == [(tmp_path / "data").resolve()]
    assert config.audit_path == (tmp_path / "data" / "audit.log").resolve()


def test_model_and_personality_are_swappable(tmp_path):
    config = cfg.parse(
        {"assistant": {"name": "Friday", "address_user_as": "boss"}, "model": {"name": "gemma4:e4b"}}, tmp_path
    )
    assert (config.assistant_name, config.address_user_as, config.model_name) == ("Friday", "boss", "gemma4:e4b")


@pytest.mark.parametrize(
    "host",
    ["http://192.168.1.20:11434", "http://example.com:11434", "http://0.0.0.0:11434", "https://127.0.0.1:11434",
     "http://127.0.0.1.evil.com:11434", "ollama.com", "http://[::ffff:8.8.8.8]:11434", ""],
)
def test_model_host_must_be_localhost(tmp_path, host):
    with pytest.raises(cfg.ConfigError):
        cfg.parse({"model": {"host": host}}, tmp_path)


@pytest.mark.parametrize("host", ["http://127.0.0.1:11434", "http://localhost:11434", "http://[::1]:11434", "http://127.0.0.1:11434/"])
def test_localhost_hosts_are_accepted(tmp_path, host):
    assert cfg.parse({"model": {"host": host}}, tmp_path).model_host.startswith("http://")


@pytest.mark.parametrize("name", ["qwen3.5:cloud", "gpt-oss:120b-cloud", "Some-CLOUD-model"])
def test_cloud_models_are_refused(tmp_path, name):
    with pytest.raises(cfg.ConfigError, match="CLOUD"):
        cfg.parse({"model": {"name": name}}, tmp_path)


@pytest.mark.parametrize("folders", [["/"], ["~"], "~/Documents", [""], [5]])
def test_allowlist_cannot_be_the_whole_disk_or_home(tmp_path, folders):
    with pytest.raises(cfg.ConfigError):
        cfg.parse({"safety": {"allowed_folders": folders}}, tmp_path)


@pytest.mark.parametrize(
    "data",
    [{"safety": {"dry_run": "yes"}}, {"model": {"temperature": 9}}, {"model": {"context_tokens": 5}}, {"assistant": "Jarvis"}],
)
def test_wrong_types_give_a_clear_error(tmp_path, data):
    with pytest.raises(cfg.ConfigError):
        cfg.parse(data, tmp_path)


def test_typo_in_file_gives_a_clear_error(tmp_path):
    (tmp_path / "config.toml").write_text("[model\nname = ", encoding="utf-8")
    with pytest.raises(cfg.ConfigError, match="typo"):
        cfg.load(tmp_path / "config.toml")
