#!/usr/bin/env python3
"""Clips-channel pipeline: fetch a source video, cut vertical Shorts with burned-in
captions, upload approved ones to YouTube, and pull weekly channel stats.

    shorts.py fetch  <youtube-url> --rights own|licensed|permission|cc-by [--note "..."]
    shorts.py cut    <video-id> --start 12:30 --end 13:05 --slug my-clip --hook "Text"
    shorts.py auth
    shorts.py upload content/approved/<file>.md
    shorts.py stats  [--days 7]

Working files (videos, captions) live in work/clips/<video-id>/ and are not committed.
"""
import argparse
import datetime as dt
import json
import os
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
WORK = ROOT / "work" / "clips"
APPROVED = ROOT / "content" / "approved"
REPORT_DATA = ROOT / "reports" / "data"
CONFIG = Path(os.environ.get("SHORTS_CONFIG_DIR", Path.home() / ".config" / "shorts-agent"))
SCOPES = [
    "https://www.googleapis.com/auth/youtube.upload",
    "https://www.googleapis.com/auth/youtube.readonly",
    "https://www.googleapis.com/auth/yt-analytics.readonly",
    "https://www.googleapis.com/auth/yt-analytics-monetary.readonly",
]
RIGHTS = ("own", "licensed", "permission", "cc-by")
MAX_SHORT_SECONDS = 180


def die(msg):
    sys.exit(f"error: {msg}")


def parse_time(value):
    """'90', '1:30' or '0:01:30.5' -> seconds."""
    seconds = 0.0
    for part in str(value).split(":"):
        seconds = seconds * 60 + float(part)
    return seconds


def stamp(seconds):
    return f"{int(seconds // 60):02d}:{seconds % 60:04.1f}"


# ---------------------------------------------------------------- captions

def load_words(json3_path):
    """YouTube json3 captions -> [(start_s, end_s, word)], word-timed where available."""
    events = json.loads(Path(json3_path).read_text(encoding="utf-8")).get("events", [])
    words = []
    for ev in events:
        segs = [s for s in ev.get("segs", []) if s.get("utf8", "").strip()]
        if not segs:
            continue
        ev_start = ev.get("tStartMs", 0) / 1000
        ev_end = ev_start + ev.get("dDurationMs", 0) / 1000
        for i, seg in enumerate(segs):
            seg_start = ev_start + seg.get("tOffsetMs", 0) / 1000
            seg_end = ev_start + segs[i + 1].get("tOffsetMs", 0) / 1000 if i + 1 < len(segs) else ev_end
            tokens = seg["utf8"].split()
            step = max(seg_end - seg_start, 0.01) / len(tokens)
            for j, token in enumerate(tokens):
                words.append([seg_start + j * step, seg_start + (j + 1) * step, token])
    words.sort(key=lambda w: w[0])
    # Auto-captions overlap between rolling events; clamp each word to the next one's start.
    for cur, nxt in zip(words, words[1:]):
        cur[1] = max(min(cur[1], nxt[0]), cur[0] + 0.01)
    return [tuple(w) for w in words]


def write_transcript(words, path, line_seconds=8.0):
    lines, line, line_start = [], [], None
    for start, _end, word in words:
        if line_start is None:
            line_start = start
        if start - line_start >= line_seconds and line:
            lines.append(f"[{stamp(line_start)}] {' '.join(line)}")
            line, line_start = [], start
        line.append(word)
    if line:
        lines.append(f"[{stamp(line_start)}] {' '.join(line)}")
    Path(path).write_text("\n".join(lines) + "\n", encoding="utf-8")


def ass_time(seconds):
    seconds = max(seconds, 0)
    h, rem = divmod(seconds, 3600)
    m, s = divmod(rem, 60)
    return f"{int(h)}:{int(m):02d}:{s:05.2f}"


def ass_text(text):
    return text.replace("\\", "").replace("{", "(").replace("}", ")").replace("\n", " ")


def build_ass(words, start, end, hook, path, hook_seconds=3.0):
    """Caption chunks of up to 3 words, plus the hook as a title card at the top."""
    header = (
        "[Script Info]\nScriptType: v4.00+\nPlayResX: 1080\nPlayResY: 1920\nWrapStyle: 0\n\n"
        "[V4+ Styles]\n"
        "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, "
        "Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, "
        "Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\n"
        # Captions sit above the bottom ~25% of the frame, the hook below the top ~15% (Shorts UI).
        "Style: Cap,Inter,84,&H00FFFFFF,&H00FFFFFF,&H00000000,&H80000000,1,0,0,0,100,100,0,0,1,6,2,2,80,80,560,1\n"
        "Style: Hook,Inter,68,&H00000000,&H00000000,&H00FFFFFF,&H00FFFFFF,1,0,0,0,100,100,0,0,3,14,0,8,90,90,300,1\n\n"
        "[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n"
    )
    lines = []
    if hook:
        lines.append(f"Dialogue: 1,{ass_time(0)},{ass_time(hook_seconds)},Hook,,0,0,0,,{ass_text(hook)}")
    chunk = []
    clip_words = [w for w in words if w[0] >= start and w[0] < end]
    for i, word in enumerate(clip_words):
        chunk.append(word)
        nxt = clip_words[i + 1] if i + 1 < len(clip_words) else None
        full = len(chunk) == 3 or sum(len(w[2]) for w in chunk) >= 16
        pause = nxt is not None and nxt[0] - word[1] > 0.6
        if nxt is None or full or pause or word[2][-1] in ".?!":
            c_start = chunk[0][0] - start
            c_end = min(chunk[-1][1], nxt[0] if nxt else end, end) - start
            text = ass_text(" ".join(w[2] for w in chunk)).upper()
            lines.append(f"Dialogue: 0,{ass_time(c_start)},{ass_time(max(c_end, c_start + 0.15))},Cap,,0,0,0,,{text}")
            chunk = []
    Path(path).write_text(header + "\n".join(lines) + "\n", encoding="utf-8")


# ---------------------------------------------------------------- fetch

def cmd_fetch(args):
    try:
        import yt_dlp
    except ImportError:
        die("yt-dlp is not installed. Run: pip install -r tools/shorts/requirements.txt")
    if args.rights != "own" and args.rights != "cc-by" and not args.note:
        die("--note is required for licensed/permission sources: say who granted it and where "
            "(e.g. 'clipping programme terms at <url>' or 'email from <creator> on <date>').")

    with yt_dlp.YoutubeDL({"quiet": True, "skip_download": True}) as ydl:
        info = ydl.extract_info(args.url, download=False)
    video_id = info["id"]
    if args.rights == "cc-by" and "creative commons" not in (info.get("license") or "").lower():
        die(f"YouTube lists this video's licence as {info.get('license') or 'Standard YouTube Licence'!r}, "
            "not Creative Commons. Use a different --rights basis only if you really have one.")

    out = WORK / video_id
    out.mkdir(parents=True, exist_ok=True)
    lang = (info.get("language") or "en").split("-")[0]
    opts = {
        "quiet": True,
        "outtmpl": str(out / "source.%(ext)s"),
        "format": "bv*[height<=1080]+ba/b[height<=1080]/b",
        "merge_output_format": "mp4",
        "writesubtitles": True,
        "writeautomaticsub": True,
        "subtitleslangs": [lang, f"{lang}-orig", "en"],
        "subtitlesformat": "json3",
    }
    with yt_dlp.YoutubeDL(opts) as ydl:
        ydl.download([args.url])

    meta = {
        "video_id": video_id,
        "url": info.get("webpage_url", args.url),
        "title": info.get("title"),
        "channel": info.get("channel") or info.get("uploader"),
        "channel_url": info.get("channel_url"),
        "duration": info.get("duration"),
        "license": info.get("license"),
        "rights": args.rights,
        "rights_note": args.note or "",
        "fetched": dt.date.today().isoformat(),
    }
    (out / "meta.json").write_text(json.dumps(meta, indent=2), encoding="utf-8")

    subs = sorted(out.glob("source.*.json3"), key=lambda p: "orig" not in p.name)
    if subs:
        write_transcript(load_words(subs[0]), out / "transcript.txt")
        print(f"transcript: {out / 'transcript.txt'}")
    else:
        print("no captions found on YouTube; transcribe source.mp4 before picking moments "
              "(see the clip skill).")
    print(f"video id:   {video_id}\nfolder:     {out}")


# ---------------------------------------------------------------- cut

def cmd_cut(args):
    folder = WORK / args.video_id
    source = next(iter(sorted(folder.glob("source.mp4")) or sorted(folder.glob("source.*"))), None)
    if source is None or source.suffix in (".json3", ".txt"):
        die(f"no source video in {folder}; run fetch first")
    start, end = parse_time(args.start), parse_time(args.end)
    if end <= start:
        die("--end must be after --start")
    if end - start > MAX_SHORT_SECONDS:
        die(f"clip is {end - start:.0f}s; Shorts must be {MAX_SHORT_SECONDS}s or less")

    out_dir = folder / "out"
    out_dir.mkdir(exist_ok=True)
    slug = re.sub(r"[^a-z0-9-]+", "-", args.slug.lower()).strip("-")
    subs = sorted(folder.glob("source.*.json3"), key=lambda p: "orig" not in p.name)
    words = load_words(subs[0]) if subs else []
    ass_name = f"{slug}.ass"
    build_ass(words, start, end, args.hook, out_dir / ass_name)

    if args.mode == "crop":
        # Fill the frame; --focus 0..1 picks which horizontal part of the source to keep.
        vf = f"scale=-2:1920,crop=1080:1920:(iw-1080)*{args.focus}:0"
    else:
        # Whole frame visible over a blurred copy of itself.
        vf = ("split[a][b];[a]scale=-2:1920,crop=1080:1920,boxblur=24:4[bg];"
              "[b]scale=1080:-2[fg];[bg][fg]overlay=0:(H-h)/2")
    vf += f",ass={ass_name},format=yuv420p"
    out_file = out_dir / f"{slug}.mp4"
    cmd = ["ffmpeg", "-y", "-loglevel", "error", "-ss", str(start), "-to", str(end), "-i", str(source),
           "-filter_complex", vf, "-r", "30", "-c:v", "libx264", "-preset", "medium", "-crf", "20",
           "-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart", out_file.name]
    subprocess.run(cmd, cwd=out_dir, check=True)
    print(f"clip: {out_file.relative_to(ROOT)}  ({end - start:.1f}s, {'captions' if words else 'NO captions'})")


# ---------------------------------------------------------------- YouTube API

def credentials():
    try:
        from google.auth.transport.requests import Request
        from google.oauth2.credentials import Credentials
    except ImportError:
        die("Google client libraries missing. Run: pip install -r tools/shorts/requirements.txt")
    token = CONFIG / "token.json"
    if not token.exists():
        die(f"not signed in to YouTube. Run: python tools/shorts/shorts.py auth")
    creds = Credentials.from_authorized_user_file(str(token), SCOPES)
    if not creds.valid:
        creds.refresh(Request())
        token.write_text(creds.to_json())
    return creds


def cmd_auth(_args):
    from google_auth_oauthlib.flow import InstalledAppFlow
    secret = CONFIG / "client_secret.json"
    if not secret.exists():
        die(f"put your Google OAuth client file at {secret} (see tools/shorts/README.md)")
    creds = InstalledAppFlow.from_client_secrets_file(str(secret), SCOPES).run_local_server(port=0)
    (CONFIG / "token.json").write_text(creds.to_json())
    os.chmod(CONFIG / "token.json", 0o600)
    print("signed in; token saved outside the repo at", CONFIG / "token.json")


def read_draft(path):
    text = Path(path).read_text(encoding="utf-8")
    match = re.match(r"---\n(.*?)\n---\n(.*)", text, re.S)
    if not match:
        die(f"{path} has no front matter")
    front = {}
    for line in match.group(1).splitlines():
        if ":" in line:
            key, value = line.split(":", 1)
            front[key.strip()] = value.strip().strip('"')
    sections = {m.group(1).strip().lower(): m.group(2).strip()
                for m in re.finditer(r"^## (.+?)\n(.*?)(?=^## |\Z)", match.group(2), re.S | re.M)}
    return front, sections, text


def cmd_upload(args):
    path = Path(args.draft).resolve()
    front, sections, text = read_draft(path)
    # The approval gate: only files the owner moved to content/approved/ can be uploaded.
    if path.parent != APPROVED.resolve() or front.get("status") != "approved":
        die("refusing to upload: the file must be in content/approved/ with 'status: approved'. "
            "Only the owner approves clips.")
    if front.get("youtube_url"):
        die(f"already uploaded: {front['youtube_url']}")
    if front.get("rights") not in RIGHTS:
        die(f"'rights:' must be one of {RIGHTS}")
    video = ROOT / front.get("video_file", "")
    if not video.is_file():
        die(f"video_file not found: {video}")
    title = front.get("title", "")
    if not title or len(title) > 100:
        die("title is required and must be 100 characters or fewer")
    description = sections.get("description", "")
    if front.get("rights") != "own" and front.get("source_url", "") not in description:
        die("the Description section must credit the source and include source_url")

    from googleapiclient.discovery import build
    from googleapiclient.http import MediaFileUpload
    youtube = build("youtube", "v3", credentials=credentials())
    body = {
        "snippet": {"title": title, "description": description, "categoryId": front.get("category_id", "22"),
                    "tags": [t.strip() for t in front.get("tags", "").split(",") if t.strip()]},
        "status": {"privacyStatus": args.privacy, "selfDeclaredMadeForKids": False},
    }
    request = youtube.videos().insert(part="snippet,status", body=body,
                                      media_body=MediaFileUpload(str(video), chunksize=-1, resumable=True))
    response = None
    while response is None:
        _status, response = request.next_chunk()
    url = f"https://www.youtube.com/shorts/{response['id']}"
    stamp_line = f"youtube_url: {url}\nuploaded: {dt.date.today().isoformat()} ({args.privacy})\n---\n"
    path.write_text(text.replace("\n---\n", "\n" + stamp_line, 1), encoding="utf-8")
    print(f"uploaded ({args.privacy}): {url}")


def cmd_stats(args):
    from googleapiclient.discovery import build
    from googleapiclient.errors import HttpError
    creds = credentials()
    end = dt.date.today() - dt.timedelta(days=1)
    start = end - dt.timedelta(days=args.days - 1)
    analytics = build("youtubeAnalytics", "v2", credentials=creds)
    base = "views,estimatedMinutesWatched,averageViewPercentage,likes,shares,comments,subscribersGained,subscribersLost"

    def query(metrics, **extra):
        return analytics.reports().query(ids="channel==MINE", startDate=start.isoformat(),
                                         endDate=end.isoformat(), metrics=metrics, **extra).execute()

    def rows(result):
        names = [h["name"] for h in result.get("columnHeaders", [])]
        return [dict(zip(names, row)) for row in result.get("rows", [])]

    report = {"period": {"start": start.isoformat(), "end": end.isoformat()}}
    report["channel"] = (rows(query(base)) or [{}])[0]
    try:
        report["revenue"] = (rows(query("estimatedRevenue")) or [{}])[0]
    except HttpError:
        report["revenue"] = None  # channel not monetised (or revenue scope not granted)
    report["videos"] = rows(query("views,estimatedMinutesWatched,averageViewPercentage,likes,shares,subscribersGained",
                                  dimensions="video", sort="-views", maxResults=50))
    youtube = build("youtube", "v3", credentials=creds)
    channel = youtube.channels().list(part="statistics", mine=True).execute()["items"][0]["statistics"]
    report["totals"] = {"subscribers": channel.get("subscriberCount"), "views": channel.get("viewCount"),
                        "videos": channel.get("videoCount")}
    ids = [v["video"] for v in report["videos"]]
    if ids:
        titles = {i["id"]: i["snippet"]["title"]
                  for i in youtube.videos().list(part="snippet", id=",".join(ids)).execute()["items"]}
        for video in report["videos"]:
            video["title"] = titles.get(video["video"])
    REPORT_DATA.mkdir(parents=True, exist_ok=True)
    out = REPORT_DATA / f"{dt.date.today().isoformat()}_clips_youtube.json"
    out.write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(f"stats for {start} to {end}: {out.relative_to(ROOT)}")


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="command", required=True)

    p = sub.add_parser("fetch", help="download a source video and its captions")
    p.add_argument("url")
    p.add_argument("--rights", required=True, choices=RIGHTS, help="your basis for reusing this video")
    p.add_argument("--note", help="who granted the rights and where (required for licensed/permission)")
    p.set_defaults(func=cmd_fetch)

    p = sub.add_parser("cut", help="cut one vertical clip with burned-in captions")
    p.add_argument("video_id")
    p.add_argument("--start", required=True)
    p.add_argument("--end", required=True)
    p.add_argument("--slug", required=True)
    p.add_argument("--hook", default="", help="title text shown for the first 3 seconds")
    p.add_argument("--mode", choices=("crop", "blur"), default="crop")
    p.add_argument("--focus", type=float, default=0.5, help="crop mode: 0 = left edge, 0.5 = centre, 1 = right")
    p.set_defaults(func=cmd_cut)

    p = sub.add_parser("auth", help="sign in to the YouTube channel (run once, on your own machine)")
    p.set_defaults(func=cmd_auth)

    p = sub.add_parser("upload", help="upload an approved clip")
    p.add_argument("draft")
    p.add_argument("--privacy", choices=("private", "unlisted", "public"), default="public")
    p.set_defaults(func=cmd_upload)

    p = sub.add_parser("stats", help="pull channel and per-video stats for the weekly report")
    p.add_argument("--days", type=int, default=7)
    p.set_defaults(func=cmd_stats)

    args = parser.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
