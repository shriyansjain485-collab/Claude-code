"""Hunt mode: keep finding live streams on a topic, clip each one, and keep a ranked
board of the best clips across all of them ready to use."""

from __future__ import annotations

import json
import signal
import subprocess
import sys
import time
from datetime import datetime
from pathlib import Path

from . import discover, sources


def clip_hunt(args) -> None:
    topic = args.topic
    root = Path(args.out) / sources.slug(topic)
    logs = root / ".logs"
    logs.mkdir(parents=True, exist_ok=True)
    sites = [s.strip().lower() for s in args.sites.split(",") if s.strip()]
    only = {c.lower() for c in (args.only or [])}
    exclude = {c.lower() for c in (args.exclude or [])}
    languages = {l.strip().lower() for l in (args.language or "").split(",") if l.strip()}
    queries = [topic, *(args.also or [])]

    running: dict[str, tuple[subprocess.Popen, discover.LiveStream]] = {}
    failures: dict[str, int] = {}
    announced: set[str] = set()
    next_scan = 0.0

    def on_term(*_):
        raise KeyboardInterrupt
    signal.signal(signal.SIGTERM, on_term)

    if args.start_at:
        start = datetime.strptime(args.start_at, "%Y-%m-%d %H:%M")
        wait = (start - datetime.now()).total_seconds()
        if wait > 0:
            print(f"◷ Waiting until {start:%a %d %b %H:%M} to start hunting (Ctrl+C to cancel)…", flush=True)
            try:
                while (start - datetime.now()).total_seconds() > 0:
                    time.sleep(min(30, max(1, (start - datetime.now()).total_seconds())))
            except KeyboardInterrupt:
                print("\n■ Cancelled before start.")
                return

    print(f"● Hunting live streams about {' / '.join(repr(q) for q in queries)} on {', '.join(sites)}"
          f"{' · languages ' + ','.join(sorted(languages)) if languages else ''}\n"
          f"  up to {args.max_streams} at once · rescan every {args.rescan}s · ready clips → {root}/READY.md\n"
          f"  Ctrl+C to stop", flush=True)
    try:
        while True:
            # streams that ended (or failed) free their slot
            for key, (proc, stream) in list(running.items()):
                if proc.poll() is not None:
                    del running[key]
                    if proc.returncode not in (0, 130):
                        failures[key] = failures.get(key, 0) + 1
                    print(f"  ○ {stream.site}/{stream.channel} stopped", flush=True)

            if time.time() >= next_scan:
                next_scan = time.time() + args.rescan
                by_key: dict[str, discover.LiveStream] = {}
                for query in queries:
                    for s in discover.find_live(query, sites, limit=args.search_limit, extra=args.ytdlp_arg):
                        by_key.setdefault(s.key, s)
                found = sorted(by_key.values(), key=lambda s: -s.viewers)
                candidates = [s for s in found
                              if s.key not in running and failures.get(s.key, 0) < 3
                              and s.viewers >= args.min_viewers
                              and (not only or s.channel.lower() in only)
                              and s.channel.lower() not in exclude
                              and (not languages or not s.language or s.language.lower() in languages)]
                print(f"  ⌕ {datetime.now():%H:%M} found {len(found)} live, "
                      f"{len(candidates)} new eligible, watching {len(running)}", flush=True)
                for stream in candidates[: max(0, args.max_streams - len(running))]:
                    running[stream.key] = (start_clipper(stream, root, logs, args), stream)
                    print(f"  ▶ {stream.site}/{stream.channel} ({stream.viewers:,} watching) — {stream.title[:70]}",
                          flush=True)

            for clip in update_board(root, args.board_size):
                if clip["file"] not in announced:
                    announced.add(clip["file"])
                    print(f"  ✂ {clip['stream']}  {clip['moment']}  score {clip['score']}  → {clip['file']}",
                          flush=True)
            time.sleep(5)
    except KeyboardInterrupt:
        print("\n■ Stopping all streams…", flush=True)
    finally:
        for proc, _ in running.values():
            if proc.poll() is None:
                proc.terminate()  # each clipper saves its pending clips on SIGTERM
        for proc, _ in running.values():
            try:
                proc.wait(timeout=60)
            except subprocess.TimeoutExpired:
                proc.kill()
    board = update_board(root, args.board_size)
    print(f"\n✓ {len(board)} clips ready → {root}/READY.md")


def start_clipper(stream: discover.LiveStream, root: Path, logs: Path, args) -> subprocess.Popen:
    name = sources.slug(f"{stream.site}-{stream.channel}")
    folder = root / name
    folder.mkdir(parents=True, exist_ok=True)
    (folder / "stream.json").write_text(json.dumps(stream.to_dict(), indent=2))
    cmd = [sys.executable, "-m", "clipbot", "live", stream.url, "--out", str(root), "--name", name,
           "--top", str(args.top_per_stream), "--threshold", str(args.threshold),
           "--quality", args.quality, "--pre", str(args.pre), "--post", str(args.post),
           "--warmup", str(args.warmup), "--workers", "1"]
    if args.vertical:
        cmd.append("--vertical")
    for extra in args.ytdlp_arg or []:
        cmd.append(f"--ytdlp-arg={extra}")
    log = open(logs / f"{name}.log", "a")
    return subprocess.Popen(cmd, stdin=subprocess.DEVNULL, stdout=log, stderr=subprocess.STDOUT)


def update_board(root: Path, size: int) -> list[dict]:
    """Rank every clip from every stream and write READY.md / ready.json."""
    clips = []
    for manifest in root.glob("*/manifest.json"):
        try:
            data = json.loads(manifest.read_text())
            meta = json.loads((manifest.parent / "stream.json").read_text())
        except (OSError, ValueError):
            continue
        for c in data.get("clips", []):
            if Path(c["file"]).exists():
                clips.append({**c, "stream": f"{meta['site']}/{meta['channel']}", "title": meta.get("title", ""),
                              "url": meta.get("url", "")})
    clips.sort(key=lambda c: -c["score"])
    clips = clips[:size]
    lines = [f"# Ready clips: {root.name}", "",
             f"Updated {datetime.now():%Y-%m-%d %H:%M}. Best first. Check that you have permission to "
             "use a clip before posting it.", "",
             "| # | Score | Stream | Moment | Clip |", "|---|---|---|---|---|"]
    for i, c in enumerate(clips, 1):
        lines.append(f"| {i} | {c['score']} | [{c['stream']}]({c['url']}) | {c['moment']} | `{c['file']}` |")
    (root / "READY.md").write_text("\n".join(lines) + "\n")
    (root / "ready.json").write_text(json.dumps(clips, indent=2))
    return clips
