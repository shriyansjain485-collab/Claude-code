"""ffmpeg helpers: loudness metering and fast clip cutting."""

from __future__ import annotations

import math
import re
import shutil
import subprocess
from array import array
from pathlib import Path

SILENCE_DB = -70.0

# 9:16 for Reels / TikTok / Shorts: the full frame centred over a blurred, cropped copy of itself.
VERTICAL_FILTER = (
    "[0:v]split=2[bgsrc][fgsrc];"
    "[bgsrc]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,boxblur=20:2[bg];"
    "[fgsrc]scale=1080:-2[fg];"
    "[bg][fg]overlay=(W-w)/2:(H-h)/2,setsar=1[v]"
)


def require(*binaries: str) -> None:
    missing = [b for b in binaries if shutil.which(b) is None]
    if missing:
        raise SystemExit(f"Missing required program(s): {', '.join(missing)}. See clipbot/README.md.")


def run(cmd: list[str], quiet: bool = True) -> None:
    result = subprocess.run(cmd, stdout=subprocess.DEVNULL if quiet else None, stderr=subprocess.PIPE, text=True)
    if result.returncode != 0:
        raise RuntimeError(f"{cmd[0]} failed ({result.returncode}): {result.stderr.strip()[-800:]}")


def loudness_series(path: str | Path) -> list[float]:
    """Per-second RMS loudness in dBFS for a whole file. Runs in ffmpeg (C), so a
    multi-hour stream takes seconds, not minutes."""
    af = (
        "aformat=channel_layouts=mono,aresample=16000,asetnsamples=n=16000:p=0,"
        "astats=metadata=1:reset=1:measure_perchannel=none:measure_overall=RMS_level,"
        "ametadata=mode=print:key=lavfi.astats.Overall.RMS_level:file=-"
    )
    cmd = ["ffmpeg", "-nostats", "-hide_banner", "-loglevel", "error", "-i", str(path),
           "-vn", "-sn", "-dn", "-af", af, "-f", "null", "-"]
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        raise RuntimeError(f"ffmpeg could not read audio from {path}: {result.stderr.strip()[-500:]}")
    values = []
    for match in re.finditer(r"RMS_level=(\S+)", result.stdout):
        try:
            v = float(match.group(1))
        except ValueError:
            v = SILENCE_DB
        values.append(max(v, SILENCE_DB) if math.isfinite(v) else SILENCE_DB)
    if not values:
        raise RuntimeError(f"No audio found in {path}")
    return values


def pcm_db(chunk: bytes) -> float:
    """RMS level in dBFS of a chunk of signed 16-bit mono PCM."""
    samples = array("h")
    samples.frombytes(chunk[: len(chunk) - len(chunk) % 2])
    if not samples:
        return SILENCE_DB
    mean_sq = sum(s * s for s in samples) / len(samples)
    if mean_sq <= 0:
        return SILENCE_DB
    return max(SILENCE_DB, 10 * math.log10(mean_sq / (32768.0 ** 2)))


def cut(src: str | Path, start: float, duration: float, out: Path, vertical: bool = False,
        input_args: list[str] | None = None) -> Path:
    """Cut [start, start+duration] from src. Default is stream copy (no re-encode),
    which takes well under a second; vertical re-encodes to 1080x1920."""
    out.parent.mkdir(parents=True, exist_ok=True)
    cmd = ["ffmpeg", "-y", "-hide_banner", "-loglevel", "error", *(input_args or []),
           "-ss", f"{max(0.0, start):.3f}", "-i", str(src), "-t", f"{duration:.3f}"]
    if vertical:
        cmd += ["-filter_complex", VERTICAL_FILTER, "-map", "[v]", "-map", "0:a?",
                "-c:v", "libx264", "-preset", "veryfast", "-crf", "21", "-pix_fmt", "yuv420p",
                "-c:a", "aac", "-b:a", "160k"]
    else:
        cmd += ["-map", "0:v?", "-map", "0:a?", "-c", "copy", "-avoid_negative_ts", "make_zero"]
    cmd += ["-movflags", "+faststart", str(out)]
    run(cmd)
    return out


def make_vertical(src: Path, out: Path) -> Path:
    return cut(src, 0, 10**6, out, vertical=True)


def concat_segments(segments: list[Path], offset: float, duration: float, out: Path,
                    vertical: bool = False) -> Path:
    """Join live-buffer .ts segments and trim to the moment."""
    listing = out.with_suffix(".txt")
    listing.write_text("".join(f"file '{p.resolve()}'\n" for p in segments))
    try:
        return cut(listing, offset, duration, out, vertical, input_args=["-f", "concat", "-safe", "0"])
    finally:
        listing.unlink(missing_ok=True)
