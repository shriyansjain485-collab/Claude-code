"""VOD / video mode: find the top moments of a finished stream or any video and cut them."""

from __future__ import annotations

import json
import shutil
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path

from . import media, scoring, sources


def clip_vod(args) -> list[dict]:
    t0 = time.time()
    extra = args.ytdlp_arg or []
    remote = sources.is_url(args.source)
    media.require("ffmpeg", *(["yt-dlp"] if remote else []))

    info: dict = {}
    if remote:
        print("• Reading video info…", flush=True)
        info = sources.ytdlp_info(args.source, extra)
        if info.get("is_live"):
            raise SystemExit("That stream is live right now. Use: python -m clipbot live <url>")
        name = sources.slug(f"{info.get('uploader') or ''} {info.get('title') or info.get('id')}")
    else:
        if not Path(args.source).exists():
            raise SystemExit(f"File not found: {args.source}")
        name = sources.slug(Path(args.source).stem)

    out_dir = Path(args.out) / name
    work = out_dir / ".work"
    out_dir.mkdir(parents=True, exist_ok=True)

    if remote:
        print("• Downloading audio only (fast)…", flush=True)
        audio = sources.download_audio(args.source, work, extra)
    else:
        audio = Path(args.source)

    print(f"• Scanning audio for hype… ({time.time() - t0:.0f}s)", flush=True)
    loud = media.loudness_series(audio)
    signals = [(scoring.audio_excitement(loud), args.audio_weight)]
    heat = sources.heatmap_series(info, len(loud)) if info else None
    if heat:
        print("• Using YouTube 'Most replayed' data too", flush=True)
        signals.append((scoring.zscores(heat), args.replay_weight))
    score = scoring.combine(signals)

    pre, post = args.pre, args.post
    peaks = scoring.pick_peaks(score, args.top, min_gap=max(args.min_gap, int(pre + post)),
                               min_score=args.min_score)
    if not peaks:
        print("No standout moments found. Try --min-score 0.5.")
        return []
    peaks.sort(key=lambda p: p[0])  # chronological for cutting; ranked in manifest
    ranked = {idx: rank for rank, (idx, _) in enumerate(sorted(peaks, key=lambda p: -p[1]), 1)}

    full = None
    if remote and args.full_download:
        print("• Downloading full video…", flush=True)
        full = sources.download_full(args.source, work, extra)

    print(f"• Cutting {len(peaks)} clips… ({time.time() - t0:.0f}s)", flush=True)

    def make(peak: tuple[int, float]) -> dict:
        idx, s = peak
        start = max(0.0, idx - pre)
        end = min(float(len(loud)), idx + post)
        rank = ranked[idx]
        out = out_dir / f"{rank:02d}_{scoring.hms(idx).replace(':', '-')}_score{s:.1f}.mp4"
        if remote and not full:
            if args.vertical:
                raw = work / f"raw_{idx}.mp4"
                sources.download_section(args.source, start, end, raw, extra)
                media.make_vertical(raw, out)
            else:
                sources.download_section(args.source, start, end, out, extra)
        else:
            media.cut(full or args.source, start, end - start, out, vertical=args.vertical)
        return {"rank": rank, "file": str(out), "moment": scoring.hms(idx), "start": round(start, 2),
                "end": round(end, 2), "score": round(s, 2),
                "source_link": _timestamp_link(args.source, start) if remote else None}

    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        clips = sorted(pool.map(make, peaks), key=lambda c: c["rank"])

    if not args.keep_work:
        shutil.rmtree(work, ignore_errors=True)
    manifest = {"source": args.source, "title": info.get("title"), "mode": "vod",
                "created_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
                "clips": clips}
    (out_dir / "manifest.json").write_text(json.dumps(manifest, indent=2))

    print(f"\n✓ {len(clips)} clips in {time.time() - t0:.0f}s → {out_dir}/")
    for c in clips:
        print(f"  #{c['rank']:<2} {c['moment']}  score {c['score']:>4}  {Path(c['file']).name}")
    return clips


def _timestamp_link(url: str, start: float) -> str:
    sep = "&" if "?" in url else "?"
    if "twitch.tv" in url:
        s = int(start)
        return f"{url}{sep}t={s // 3600}h{s % 3600 // 60}m{s % 60}s"
    return f"{url}{sep}t={int(start)}"
