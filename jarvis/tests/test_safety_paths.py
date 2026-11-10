import os
from pathlib import Path

import pytest

from jarvis.safety.paths import PathNotAllowed, PathPolicy, is_sensitive


@pytest.fixture
def policy(tmp_path):
    (tmp_path / "ok").mkdir()
    (tmp_path / "other").mkdir()
    (tmp_path / "ok" / "a.txt").write_text("a")
    (tmp_path / "other" / "b.txt").write_text("b")
    return PathPolicy([tmp_path / "ok"])


def test_inside_allowlist_is_allowed(policy, tmp_path):
    assert policy.check(tmp_path / "ok" / "a.txt") == (tmp_path / "ok" / "a.txt").resolve()
    assert policy.check("a.txt") == (tmp_path / "ok" / "a.txt").resolve()   # relative → first allowed folder


@pytest.mark.parametrize("path", ["/etc/passwd", "/", "~", "~/.ssh/id_rsa", "/tmp", "../other/b.txt", "..", "a\x00b"])
def test_outside_allowlist_is_refused(policy, path):
    with pytest.raises(PathNotAllowed):
        policy.check(path)


def test_dotdot_escape_is_refused(policy, tmp_path):
    with pytest.raises(PathNotAllowed):
        policy.check(str(tmp_path / "ok" / ".." / "other" / "b.txt"))


def test_sibling_folder_with_same_prefix_is_refused(tmp_path):
    (tmp_path / "ok").mkdir()
    (tmp_path / "ok-secret").mkdir()
    with pytest.raises(PathNotAllowed):
        PathPolicy([tmp_path / "ok"]).check(tmp_path / "ok-secret" / "x.txt")


def test_symlink_escape_is_refused(policy, tmp_path):
    os.symlink(tmp_path / "other" / "b.txt", tmp_path / "ok" / "link.txt")
    os.symlink(tmp_path / "other", tmp_path / "ok" / "linkdir")
    with pytest.raises(PathNotAllowed):
        policy.check(tmp_path / "ok" / "link.txt")
    with pytest.raises(PathNotAllowed):
        policy.check(tmp_path / "ok" / "linkdir" / "b.txt")


@pytest.mark.parametrize(
    "name",
    [".env", ".env.local", "key.pem", "id_rsa", "id_ed25519.pub", "vault.kdbx", ".ssh/config", ".aws/credentials",
     "login.keychain-db", "my-passwords.csv", ".netrc", "audit.log", ".git/config"],
)
def test_sensitive_files_are_refused_even_inside_the_allowlist(policy, tmp_path, name):
    assert is_sensitive(Path(name))
    with pytest.raises(PathNotAllowed, match="sensitive"):
        policy.check(tmp_path / "ok" / name)


def test_ordinary_names_are_not_sensitive():
    for name in ("notes.md", "environment-report.txt", "keynote-ideas.md", "sub/plan.txt"):
        assert not is_sensitive(Path(name))


def test_empty_allowlist_allows_nothing(tmp_path):
    with pytest.raises(PathNotAllowed):
        PathPolicy([]).check(tmp_path / "x.txt")
