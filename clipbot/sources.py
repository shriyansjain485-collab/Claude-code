"""Getting media in: yt-dlp for VODs/videos, streamlink or yt-dlp for live streams."""

from __future__ import annotations

import json
import re
import shutil
import subprocess
from pathlib import Path
from urllib.parse import urlparse

from .media import run


def is_url(source: str) -> bool:
    return bool(re.match(r"^[a-z][a-z0-9+.-]*://", source, re.I))


def slug(text: str, limit: int = 60) -> str:
    s = re.sub(r"[^a-zA-Z0-9]+", "-", text).strip("-").lower()
    return s[:limit].strip("-") or "stream"


def twitch_channel(url: str) -> str | None:
    """'https://twitch.tv/somechannel' -> 'somechannel' (live channel pages only)."""
    parsed = urlparse(url)
    if "twitch.tv" not in parsed.netloc:
        return None
    parts = [p for p in parsed.path.split("/") if p]
    if len(parts) == 1 and parts[0] not in {"videos", "directory", "search"}:
        return parts[0].lower()
    return None


def ytdlp_info(url: str, extra: list[str]) -> dict:
    result = subprocess.run(["yt-dlp", "-J", "--no-warnings", "--no-playlist", *extra, url],
                            capture_output=True, text=True)
    if result.returncode != 0:
        raise RuntimeError(f"yt-dlp could not read {url}: {result.stderr.strip()[-500:]}")
    return json.loads(result.stdout)


def heatmap_series(info: dict, duration: int) -> list[float] | None:
    """YouTube's 'Most replayed' graph as a per-second series, if the video has one."""
    heat = info.get("heatmap") or []
    if not heat or duration <= 0:
        return None
    series = [0.0] * duration
    for seg in heat:
        for t in range(int(seg["start_time"]), min(duration, int(seg["end_time"]) + 1)):
            series[t] = max(series[t], float(seg.get("value", 0)))
    return series


def download_audio(url: str, workdir: Path, extra: list[str]) -> Path:
    """Audio only: a fraction of the video's size, so analysis starts fast."""
    workdir.mkdir(parents=True, exist_ok=True)
    template = str(workdir / "audio.%(ext)s")
    run(["yt-dlp", "--no-playlist", "--no-warnings", "-N", "8",
         "-f", "bestaudio/Audio_Only/audio_only/worst", "-o", template, *extra, url])
    files = sorted(workdir.glob("audio.*"))
    if not files:
        raise RuntimeError("yt-dlp did not produce an audio file")
    return files[0]


VIDEO_FORMAT = "bv*[height<=1080]+ba/b[height<=1080]/bv*+ba/b"


def download_section(url: str, start: float, end: float, out: Path, extra: list[str]) -> Path:
    """Download only the seconds we need (no full-VOD download)."""
    out.parent.mkdir(parents=True, exist_ok=True)
    run(["yt-dlp", "--no-playlist", "--no-warnings", "-N", "4", "-f", VIDEO_FORMAT,
         "--download-sections", f"*{start:.2f}-{end:.2f}", "--merge-output-format", "mp4",
         "-o", str(out), "--force-overwrites", *extra, url])
    return out


def download_full(url: str, workdir: Path, extra: list[str]) -> Path:
    workdir.mkdir(parents=True, exist_ok=True)
    run(["yt-dlp", "--no-playlist", "--no-warnings", "-N", "8", "-f", VIDEO_FORMAT,
         "--merge-output-format", "mp4", "-o", str(workdir / "full.%(ext)s"), *extra, url])
    return sorted(workdir.glob("full.*"))[0]


def live_reader(source: str, quality: str, extra: list[str]) -> tuple[list[str] | None, list[str]]:
    """How to read a live source.

    Returns (reader_cmd, ffmpeg_input_args). If reader_cmd is set, its stdout (MPEG-TS)
    is piped into ffmpeg; otherwise ffmpeg opens the source itself.
    """
    if not is_url(source):  # local file: replay it in real time (handy for testing)
        return None, ["-re", "-i", source]
    scheme = urlparse(source).scheme.lower()
    if scheme in {"rtmp", "rtmps", "srt", "udp", "rtsp"} or source.split("?")[0].endswith(".m3u8"):
        return None, ["-i", source]
    if shutil.which("streamlink"):
        cmd = ["streamlink", "--stdout", "--loglevel", "error", "--hls-live-edge", "2"]
        if "twitch.tv" in source:
            cmd += ["--twitch-disable-ads", "--twitch-low-latency"]
        return cmd + [*extra, source, quality], ["-i", "pipe:0"]
    height = re.sub(r"\D", "", quality) or "1080"
    fmt = "best" if quality == "best" else f"best[height<={height}]/best"
    return ["yt-dlp", "-q", "--no-warnings", "--no-part", "-f", fmt, "--hls-use-mpegts",
            "-o", "-", *extra, source], ["-i", "pipe:0"]
