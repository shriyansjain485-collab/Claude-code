#!/usr/bin/env python3
"""Local web dashboard for the clips channel.

    python tools/shorts/web.py          then open http://127.0.0.1:8765

Runs on your own computer only (it binds to 127.0.0.1): the videos, the YouTube
sign-in and the approval clicks all stay on this machine. It drives shorts.py.
"""
import datetime as dt
import json
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path

from flask import Flask, abort, jsonify, request, send_file

import shorts as S

HERE = Path(__file__).resolve().parent
STAGES = {
    "draft": S.ROOT / "content" / "drafts",
    "approved": S.ROOT / "content" / "approved",
    "published": S.ROOT / "content" / "published",
}
ID_RE = re.compile(r"^[\w-]{1,64}$")
FILE_RE = re.compile(r"^[\w.-]+_clips_youtube_[\w.-]+\.md$")
MODEL = os.environ.get("SHORTS_MODEL", "claude-opus-5-5")

app = Flask(__name__, static_folder=None)


class Fail(Exception):
    pass


@app.errorhandler(Fail)
def on_fail(err):
    return jsonify(error=str(err)), 400


@app.before_request
def local_only():
    # Refuse requests that reach this server under another hostname (DNS rebinding).
    if request.host.split(":")[0] not in ("127.0.0.1", "localhost"):
        abort(403)


def run(*args):
    proc = subprocess.run([sys.executable, str(HERE / "shorts.py"), *map(str, args)],
                          capture_output=True, text=True)
    if proc.returncode:
        lines = (proc.stderr or proc.stdout).strip().splitlines()
        raise Fail(lines[-1].removeprefix("error: ") if lines else "command failed")
    return proc.stdout.strip()


def body(*required):
    data = request.get_json()  # 415 unless JSON, so plain cross-site forms can't call this
    for key in required:
        if not str(data.get(key, "")).strip():
            raise Fail(f"'{key}' is required")
    return data


def one_line(value):
    return " ".join(str(value or "").split())


def clip_path(stage, name):
    if stage not in STAGES or not FILE_RE.match(name or ""):
        raise Fail("unknown clip")
    path = STAGES[stage] / name
    if not path.is_file():
        raise Fail("clip file not found")
    return path


def read_clip(stage, path):
    try:
        front, sections, _text = S.read_draft(path)
    except SystemExit:
        return None
    return {"file": path.name, "stage": stage, **front,
            "description": sections.get("description", ""),
            "why": sections.get("why this could spread", ""),
            "has_video": (S.ROOT / front.get("video_file", "-")).is_file()}


def set_status(path, target_stage, status):
    text = re.sub(r"^status:.*$", f"status: {status}", path.read_text(encoding="utf-8"), count=1, flags=re.M)
    target = STAGES[target_stage] / path.name
    target.write_text(text, encoding="utf-8")
    path.unlink()
    return target


def source_dir(video_id):
    if not ID_RE.match(video_id or "") or not (S.WORK / video_id / "meta.json").is_file():
        raise Fail("unknown source video")
    return S.WORK / video_id


def captions(folder):
    subs = sorted(folder.glob("source.*.json3"), key=lambda p: "orig" not in p.name)
    return S.load_words(subs[0]) if subs else []


# ---------------------------------------------------------------- pages and files

@app.get("/")
def index():
    return send_file(HERE / "web" / "index.html")


@app.get("/media/source/<video_id>")
def media_source(video_id):
    return send_file(source_dir(video_id) / "source.mp4", conditional=True)


@app.get("/media/clip/<stage>/<name>")
def media_clip(stage, name):
    front, _sections, _text = S.read_draft(clip_path(stage, name))
    video = (S.ROOT / front.get("video_file", "")).resolve()
    if S.WORK.resolve() not in video.parents or not video.is_file():
        abort(404)
    return send_file(video, conditional=True)


# ---------------------------------------------------------------- API

@app.get("/api/state")
def state():
    sources = []
    for meta in sorted(S.WORK.glob("*/meta.json"), key=lambda p: p.stat().st_mtime, reverse=True):
        info = json.loads(meta.read_text(encoding="utf-8"))
        info["has_transcript"] = (meta.parent / "transcript.txt").is_file()
        sources.append(info)
    clips = [clip for stage, folder in STAGES.items()
             for path in sorted(folder.glob("*_clips_youtube_*.md"), reverse=True)
             if (clip := read_clip(stage, path))]
    reports = sorted(S.REPORT_DATA.glob("*_clips_youtube.json"))
    try:
        import anthropic  # noqa: F401
        ai = True
    except ImportError:
        ai = False
    return jsonify(
        sources=sources, clips=clips,
        stats=json.loads(reports[-1].read_text(encoding="utf-8")) if reports else None,
        setup={"ffmpeg": bool(shutil.which("ffmpeg")),
               "oauth_client": (S.CONFIG / "client_secret.json").is_file(),
               "signed_in": (S.CONFIG / "token.json").is_file(),
               "ai": ai},
    )


@app.post("/api/fetch")
def api_fetch():
    data = body("url", "rights")
    if data["rights"] not in S.RIGHTS:
        raise Fail("pick a rights basis")
    if not re.match(r"^https://(www\.|m\.)?(youtube\.com|youtu\.be)/", data["url"].strip()):
        raise Fail("that doesn't look like a YouTube link")
    args = ["fetch", data["url"].strip(), "--rights", data["rights"]]
    if one_line(data.get("note")):
        args += ["--note", one_line(data["note"])]
    return jsonify(output=run(*args))


@app.get("/api/transcript/<video_id>")
def api_transcript(video_id):
    path = source_dir(video_id) / "transcript.txt"
    return jsonify(transcript=path.read_text(encoding="utf-8") if path.is_file() else "")


@app.post("/api/suggest/<video_id>")
def api_suggest(video_id):
    """Ask Claude for the moments most worth clipping. Returns suggestions; nothing is cut."""
    folder = source_dir(video_id)
    words = captions(folder)
    if not words:
        raise Fail("this video has no captions to read; pick the moment by hand with the player")
    try:
        import anthropic
        from pydantic import BaseModel
    except ImportError:
        raise Fail("install the 'anthropic' package to get suggestions")

    class Moment(BaseModel):
        start: str
        end: str
        hook: str
        title: str
        summary: str
        why: str

    class Moments(BaseModel):
        moments: list[Moment]

    fine = folder / "transcript.fine.txt"
    S.write_transcript(words, fine, line_seconds=3.0)
    meta = json.loads((folder / "meta.json").read_text(encoding="utf-8"))
    prompt = (
        f'This is the timestamped transcript of the video "{meta.get("title")}" by {meta.get("channel")}. '
        "I run a YouTube Shorts channel and have the right to clip this video. Pick up to 6 moments that "
        "would work best as standalone Shorts, best first.\n\n"
        "A good moment makes sense to someone who has seen nothing else from the video, opens on its "
        "strongest line, carries one idea with a payoff (a surprising claim, a story with a turn, a clear "
        "how-to, a sharp disagreement, a laugh), ends on that payoff, and runs 20 to 45 seconds (never "
        "over 60). Start and end on sentence boundaries. Never choose a cut that makes the speaker appear "
        "to say something they did not mean. If the video has fewer than 6 strong moments, return fewer.\n\n"
        "For each moment give: start and end as timestamps in the transcript's own MM:SS.s format; hook, "
        "an on-screen title of at most 6 words that is true to the clip; title, a YouTube title under 80 "
        "characters, not in all caps; summary, one plain sentence saying what the clip is about, for the "
        "description; why, one sentence on who would share it and why. Use only what the transcript "
        "says: no invented numbers, names or claims.\n\n"
        f"<transcript>\n{fine.read_text(encoding='utf-8')}</transcript>"
    )
    try:
        response = anthropic.Anthropic().messages.parse(
            model=MODEL, max_tokens=16000, output_format=Moments,
            messages=[{"role": "user", "content": prompt}],
        )
    except anthropic.AuthenticationError:
        raise Fail("no Claude API credentials found: set ANTHROPIC_API_KEY, then restart the dashboard")
    except anthropic.APIConnectionError:
        raise Fail("could not reach the Claude API (is ANTHROPIC_API_KEY set, and are you online?)")
    except anthropic.APIStatusError as err:
        raise Fail(f"Claude API error {err.status_code}: {err.message}")
    except TypeError as err:  # the SDK raises this when no credentials resolve at all
        raise Fail("no Claude API credentials found: set ANTHROPIC_API_KEY, then restart the dashboard") from err
    if response.stop_reason == "refusal" or response.parsed_output is None:
        raise Fail("Claude returned no suggestions for this transcript; pick the moment by hand")
    return jsonify(moments=[m.model_dump() for m in response.parsed_output.moments])


@app.post("/api/cut")
def api_cut():
    data = body("video_id", "start", "end", "title")
    folder = source_dir(data["video_id"])
    meta = json.loads((folder / "meta.json").read_text(encoding="utf-8"))
    title = one_line(data["title"])[:100]
    slug = re.sub(r"[^a-z0-9]+", "-", title.lower()).strip("-")[:50] or "clip"
    name = f"{dt.date.today().isoformat()}_clips_youtube_{slug}.md"
    if any((d / name).exists() for d in STAGES.values()):
        raise Fail("a clip with this title already exists today; change the title")
    try:
        start, end = S.parse_time(data["start"]), S.parse_time(data["end"])
    except ValueError:
        raise Fail("times look like 12:30 or 12:30.5")
    mode = data.get("mode") if data.get("mode") in ("crop", "blur") else "crop"
    focus = min(max(float(data.get("focus", 0.5)), 0.0), 1.0)
    run("cut", data["video_id"], "--start", start, "--end", end, "--slug", slug,
        "--hook", one_line(data.get("hook")), "--mode", mode, "--focus", focus)

    summary = one_line(data.get("summary")) or title
    credit = f'Clipped from "{one_line(meta.get("title"))}" by {one_line(meta.get("channel"))}: {meta.get("url")}'
    draft = f"""---
brand: clips
platform: youtube
pillar: clips
goal: awareness
scheduled_for: TBD
status: draft
visual: none
title: {title}
tags: {one_line(data.get("tags"))}
video_file: work/clips/{data["video_id"]}/out/{slug}.mp4
source_url: {meta.get("url")}
source_channel: {one_line(meta.get("channel"))}
source_start: {S.stamp(start)}
source_end: {S.stamp(end)}
rights: {meta.get("rights")}
rights_note: {one_line(meta.get("rights_note"))}
---

## Description
{summary}
{credit}
#shorts

## Why this could spread
{one_line(data.get("why")) or "[DETAIL?]"}

## Value added
Hook title, burned-in captions, tight edit.
"""
    STAGES["draft"].mkdir(parents=True, exist_ok=True)
    (STAGES["draft"] / name).write_text(draft, encoding="utf-8")
    return jsonify(file=name)


@app.post("/api/approve")
def api_approve():
    """The owner's click in the dashboard is the approval CLAUDE.md requires."""
    path = clip_path("draft", body("file")["file"])
    STAGES["approved"].mkdir(parents=True, exist_ok=True)
    set_status(path, "approved", "approved")
    return jsonify(ok=True)


@app.post("/api/unapprove")
def api_unapprove():
    set_status(clip_path("approved", body("file")["file"]), "draft", "draft")
    return jsonify(ok=True)


@app.post("/api/upload")
def api_upload():
    data = body("file")
    path = clip_path("approved", data["file"])
    privacy = data.get("privacy") if data.get("privacy") in ("private", "unlisted", "public") else "private"
    output = run("upload", path, "--privacy", privacy)
    STAGES["published"].mkdir(parents=True, exist_ok=True)
    set_status(path, "published", "published")
    return jsonify(output=output)


@app.post("/api/discard")
def api_discard():
    path = clip_path("draft", body("file")["file"])
    front, _sections, _text = S.read_draft(path)
    video = (S.ROOT / front.get("video_file", "-")).resolve()
    if S.WORK.resolve() in video.parents:
        video.unlink(missing_ok=True)
        video.with_suffix(".ass").unlink(missing_ok=True)
    path.unlink()
    return jsonify(ok=True)


@app.post("/api/stats")
def api_stats():
    days = int(body().get("days", 7))
    return jsonify(output=run("stats", "--days", min(max(days, 1), 90)))


if __name__ == "__main__":
    port = int(os.environ.get("SHORTS_PORT", "8765"))
    print(f"Clips dashboard: http://127.0.0.1:{port}")
    app.run(host="127.0.0.1", port=port, threaded=True)
