import os

import pytest

from jarvis.tools.base import Tier, ToolError


@pytest.fixture
def library(docs, tmp_path):
    (docs / "trip-plan.md").write_text("# Trip\nFlights to Lisbon in March. Budget 900.", encoding="utf-8")
    (docs / "recipes.txt").write_text("Pasta with lemon and basil.", encoding="utf-8")
    (docs / "sub").mkdir()
    (docs / "sub" / "lisbon-hotels.txt").write_text("Hotel list for the trip.", encoding="utf-8")
    (docs / "photo.jpg").write_bytes(b"\xff\xd8\x00\x00binary")
    (docs / ".env").write_text("SECRET=1", encoding="utf-8")
    (docs / ".ssh").mkdir()
    (docs / ".ssh" / "id_rsa").write_text("PRIVATE KEY lisbon", encoding="utf-8")
    (docs / "server.pem").write_text("PRIVATE lisbon", encoding="utf-8")
    outside = tmp_path / "outside"
    outside.mkdir()
    (outside / "secret.txt").write_text("lisbon secret outside the allowlist", encoding="utf-8")
    return docs


def test_tiers(tools):
    assert tools["find_files"].tier is Tier.READ
    assert tools["read_file"].tier is Tier.READ


def test_find_by_content_and_name(tools, ctx, library):
    result = tools["find_files"].run({"query": "lisbon"}, ctx)
    assert "trip-plan.md" in result.text and "lisbon-hotels.txt" in result.text
    assert "recipes.txt" not in result.text
    assert result.untrusted is True


def test_find_requires_all_words(tools, ctx, library):
    result = tools["find_files"].run({"query": "lisbon budget"}, ctx)
    assert "trip-plan.md" in result.text and "lisbon-hotels" not in result.text


def test_find_no_match(tools, ctx, library):
    assert "No files matching" in tools["find_files"].run({"query": "zebra"}, ctx).text


def test_find_never_returns_sensitive_hidden_or_outside_files(tools, ctx, library):
    text = tools["find_files"].run({"query": "lisbon"}, ctx).text
    assert "id_rsa" not in text and "server.pem" not in text and "secret.txt" not in text
    assert ".env" not in tools["find_files"].run({"query": "env"}, ctx).text


def test_find_does_not_follow_symlinks_out_of_the_allowlist(tools, ctx, library, tmp_path):
    os.symlink(tmp_path / "outside" / "secret.txt", library / "link.txt")
    os.symlink(tmp_path / "outside", library / "linkdir")
    text = tools["find_files"].run({"query": "lisbon"}, ctx).text
    assert "link.txt" not in text and "linkdir" not in text and "secret" not in text


def test_find_in_folder_outside_allowlist_is_refused(tools, ctx, library, tmp_path):
    with pytest.raises(ToolError, match="outside the folders allowed"):
        tools["find_files"].run({"query": "x", "folder": str(tmp_path / "outside")}, ctx)


def test_read_file(tools, ctx, library):
    result = tools["read_file"].run({"path": str(library / "trip-plan.md")}, ctx)
    assert "Flights to Lisbon" in result.text
    assert result.untrusted is True and result.source.endswith("trip-plan.md")


def test_read_file_truncates(tools, ctx, library):
    (library / "long.txt").write_text("a" * 5000, encoding="utf-8")
    result = tools["read_file"].run({"path": str(library / "long.txt"), "max_chars": 200}, ctx)
    assert "first 200 of 5000 characters" in result.text


@pytest.mark.parametrize(
    "relative, message",
    [
        ("../outside/secret.txt", "outside the folders allowed"),
        ("docs/../../outside/secret.txt", "outside the folders allowed"),
        (".env", "sensitive"),
        (".ssh/id_rsa", "sensitive"),
        ("server.pem", "sensitive"),
        ("photo.jpg", "can only read"),
        ("missing.txt", "no file"),
        ("sub", "folder, not a file"),
    ],
)
def test_read_file_refusals(tools, ctx, library, relative, message):
    with pytest.raises(ToolError, match=message):
        tools["read_file"].run({"path": str(library / relative)}, ctx)


def test_read_file_refuses_absolute_system_paths(tools, ctx, library):
    for path in ("/etc/passwd", "~/.ssh/id_rsa", "/"):
        with pytest.raises(ToolError):
            tools["read_file"].run({"path": path}, ctx)


def test_read_file_refuses_symlink_to_outside(tools, ctx, library, tmp_path):
    os.symlink(tmp_path / "outside" / "secret.txt", library / "innocent.txt")
    with pytest.raises(ToolError, match="outside the folders allowed"):
        tools["read_file"].run({"path": str(library / "innocent.txt")}, ctx)


def test_binary_file_with_text_extension_is_refused(tools, ctx, library):
    (library / "fake.txt").write_bytes(b"\x00\x01\x02binary")
    with pytest.raises(ToolError, match="not a text file"):
        tools["read_file"].run({"path": str(library / "fake.txt")}, ctx)
