"""Live mode: record a rolling buffer of the stream, score every second as it arrives,
and cut a clip within a second or two of a hype moment ending."""

from __future__ import annotations

import json
import shlex
import shutil
import signal
import subprocess
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path

from . import media, scoring, sources
from .chat import TwitchChat

RATE = 8000           # PCM sample rate used for metering
BYTES_PER_SEC = RATE * 2
SEGMENT_SECONDS = 2


class LiveClipper:
    def __init__(self, args):
        self.args = args
        self.extra = args.ytdlp_arg or []
        channel = args.channel or sources.twitch_channel(args.source)
        stamp = datetime.now().strftime("%Y-%m-%d_%H%M")
        base = channel or sources.slug(Path(args.source).stem if not sources.is_url(args.source)
                                       else args.source.split("://", 1)[-1])
        name = getattr(args, "name", None)
        self.out_dir = Path(args.out) / (sources.slug(name) if name else f"{sources.slug(base)}_{stamp}")
        self.buf_dir = self.out_dir / ".buffer"
        self.buf_dir.mkdir(parents=True, exist_ok=True)
        self.chat = TwitchChat(channel) if channel and not args.no_chat else None

        self.median = scoring.RollingMedian(60)
        self.audio_z = scoring.RollingZ(600)
        self.chat_z = scoring.RollingZ(600)
        self.recent_lift: list[float] = []
        self.armed: dict | None = None
        self.cooldown_until = 0.0
        self.pending: list[dict] = []
        self.clips: list[dict] = []
        try:  # resuming into an existing folder (e.g. hunt mode re-finding a stream)
            previous = json.loads((self.out_dir / "manifest.json").read_text())["clips"]
            self.clips = [c for c in previous if Path(c["file"]).exists()]
        except (OSError, ValueError, KeyError):
            pass
        self.deleted: set[str] = set()
        self.lock = threading.Lock()
        self.pool = ThreadPoolExecutor(max_workers=args.workers)
        self.t = 0  # seconds of stream processed
        self.procs: list[subprocess.Popen] = []

    # ---------------------------------------------------------------- pipeline
    def start(self) -> subprocess.Popen:
        reader_cmd, input_args = sources.live_reader(self.args.source, self.args.quality, self.extra)
        stdin = None
        if reader_cmd:
            media.require(reader_cmd[0])
            reader = subprocess.Popen(reader_cmd, stdout=subprocess.PIPE)
            self.procs.append(reader)
            stdin = reader.stdout
        cmd = ["ffmpeg", "-hide_banner", "-loglevel", "error", "-fflags", "+genpts", *input_args,
               # 1) rolling buffer of 2 s segments, stream copy (no re-encode, near-zero CPU)
               "-map", "0:v?", "-map", "0:a?", "-c", "copy", "-f", "segment",
               "-segment_time", str(SEGMENT_SECONDS), "-segment_list", str(self.buf_dir / "list.csv"),
               "-segment_list_type", "csv", str(self.buf_dir / "seg_%06d.ts"),
               # 2) mono 8 kHz PCM to stdout for real-time hype metering
               "-map", "0:a:0", "-vn", "-ac", "1", "-ar", str(RATE), "-f", "s16le",
               "-flush_packets", "1", "pipe:1"]
        ffmpeg = subprocess.Popen(cmd, stdin=stdin, stdout=subprocess.PIPE)
        if stdin:
            stdin.close()
        self.procs.append(ffmpeg)
        return ffmpeg

    def segments(self) -> list[tuple[Path, float, float]]:
        try:
            lines = (self.buf_dir / "list.csv").read_text().splitlines()
        except FileNotFoundError:
            return []
        segs = []
        for line in lines:
            name, start, end = line.rsplit(",", 2)
            if name not in self.deleted:
                segs.append((self.buf_dir / name, float(start), float(end)))
        return segs

    # ---------------------------------------------------------------- scoring
    def score_second(self, chunk: bytes) -> float:
        loud = media.pcm_db(chunk)
        lift = loud - self.median.push(loud)
        self.recent_lift = (self.recent_lift + [lift])[-3:]
        signals = [([self.audio_z.push(sum(self.recent_lift) / len(self.recent_lift))], self.args.audio_weight)]
        if self.chat and self.chat.connected:
            signals.append(([self.chat_z.push(self.chat.activity())], self.args.chat_weight))
        return scoring.combine(signals)[0]

    def detect(self, score: float) -> None:
        a, t = self.args, self.t
        if self.armed is None:
            if score >= a.threshold and t >= a.warmup and t >= self.cooldown_until:
                self.armed = {"start": t, "peak": t, "score": score}
            return
        if score > self.armed["score"]:
            self.armed.update(peak=t, score=score)
        if score < a.threshold * 0.6 or t - self.armed["start"] >= 12:
            peak = self.armed["peak"]
            self.queue(peak - a.pre, peak + a.post, self.armed["score"], peak, "auto")
            self.cooldown_until = peak + a.cooldown
            self.armed = None

    def queue(self, start: float, end: float, score: float, moment: float, kind: str) -> None:
        with self.lock:
            self.pending.append({"start": max(0.0, start), "end": end, "score": score,
                                 "moment": moment, "kind": kind, "queued_wall": time.time()})
        print(f"  ⚡ {kind} moment at {scoring.hms(moment)} (score {score:.1f}) — clipping…", flush=True)

    # ---------------------------------------------------------------- cutting
    def flush_pending(self, final: bool = False) -> None:
        segs = self.segments()
        recorded = segs[-1][2] if segs else 0.0
        with self.lock:
            ready = [p for p in self.pending if final or recorded >= p["end"] + 0.25]
            self.pending = [p for p in self.pending if p not in ready]
        for p in ready:
            p["end"] = min(p["end"], recorded)
            needed = [s for s in segs if s[2] > p["start"] and s[1] < p["end"]]
            if needed and p["end"] - p["start"] >= 3:
                self.pool.submit(self.cut, p, needed)

    def cut(self, p: dict, needed: list[tuple[Path, float, float]]) -> None:
        name = (f"{datetime.now():%m%d-%H%M%S}_{scoring.hms(p['moment']).replace(':', '-')}"
                f"_{p['kind']}_score{p['score']:.1f}.mp4")
        out = self.out_dir / name
        began = time.time()
        try:
            media.concat_segments([s[0] for s in needed], p["start"] - needed[0][1],
                                  p["end"] - p["start"], out, vertical=self.args.vertical)
        except Exception as exc:  # keep the bot running if one cut fails
            print(f"  ✗ clip at {scoring.hms(p['moment'])} failed: {exc}", file=sys.stderr, flush=True)
            return
        clip = {"file": str(out), "moment": scoring.hms(p["moment"]), "start": round(p["start"], 2),
                "end": round(p["end"], 2), "score": round(p["score"], 2), "kind": p["kind"],
                "clipped_at": datetime.now(timezone.utc).isoformat(timespec="seconds")}
        dropped = None
        with self.lock:
            self.clips.append(clip)
            if self.args.top and len(self.clips) > self.args.top:
                dropped = min((c for c in self.clips if c["kind"] == "auto"), key=lambda c: c["score"], default=None)
                if dropped:
                    self.clips.remove(dropped)
            self.write_manifest()
        if dropped is not None:
            Path(dropped["file"]).unlink(missing_ok=True)
        if dropped is clip:
            print(f"  · moment at {clip['moment']} didn't make the top {self.args.top}", flush=True)
            return
        print(f"  ✂ {out.name}  (cut in {time.time() - began:.1f}s)", flush=True)
        if self.args.on_clip:
            cmd = [part.replace("{file}", str(out)) for part in shlex.split(self.args.on_clip)]
            subprocess.Popen(cmd)

    def write_manifest(self) -> None:
        ranked = sorted(self.clips, key=lambda c: -c["score"])
        for rank, c in enumerate(ranked, 1):
            c["rank"] = rank
        manifest = {"source": self.args.source, "mode": "live", "clips": ranked}
        (self.out_dir / "manifest.json").write_text(json.dumps(manifest, indent=2))

    def prune_buffer(self) -> None:
        keep_from = self.t - self.args.buffer
        with self.lock:
            if self.pending:
                keep_from = min(keep_from, min(p["start"] for p in self.pending) - SEGMENT_SECONDS)
        for path, _, end in self.segments()[:-2]:
            if end < keep_from:
                path.unlink(missing_ok=True)
                self.deleted.add(path.name)

    # ---------------------------------------------------------------- manual clips
    def watch_keyboard(self) -> None:
        if not sys.stdin.isatty():
            return

        def loop():
            for _ in sys.stdin:
                now = self.t
                self.queue(now - self.args.pre - self.args.post, now + 3, 99.0, now, "manual")
        threading.Thread(target=loop, daemon=True).start()

    # ---------------------------------------------------------------- main loop
    def run(self) -> list[dict]:
        media.require("ffmpeg")

        def on_term(*_):  # stop cleanly under systemd/docker/timeout, not just Ctrl+C
            raise KeyboardInterrupt
        signal.signal(signal.SIGTERM, on_term)
        if self.chat:
            self.chat.start()
        ffmpeg = self.start()
        self.watch_keyboard()
        print(f"● Watching {self.args.source}\n  clips → {self.out_dir}/\n"
              f"  signals: audio{' + Twitch chat (#' + self.chat.channel + ')' if self.chat else ''}"
              f"{'' if not sys.stdin.isatty() else '  ·  press Enter to clip the last ' + str(int(self.args.pre + self.args.post)) + 's'}"
              f"  ·  Ctrl+C to stop", flush=True)
        buf = b""
        last_status = time.time()
        try:
            while True:
                data = ffmpeg.stdout.read1(BYTES_PER_SEC) if hasattr(ffmpeg.stdout, "read1") else ffmpeg.stdout.read(BYTES_PER_SEC)
                if not data:
                    break
                buf += data
                while len(buf) >= BYTES_PER_SEC:
                    chunk, buf = buf[:BYTES_PER_SEC], buf[BYTES_PER_SEC:]
                    score = self.score_second(chunk)
                    self.detect(score)
                    self.t += 1
                    if self.t % 5 == 0:
                        self.flush_pending()
                        self.prune_buffer()
                if self.pending:
                    self.flush_pending()
                if time.time() - last_status > 60:
                    last_status = time.time()
                    chat = f", chat {'on' if self.chat.connected else 'connecting…'}" if self.chat else ""
                    print(f"  … {scoring.hms(self.t)} watched, {len(self.clips)} clips{chat}", flush=True)
        except KeyboardInterrupt:
            print("\n■ Stopping…", flush=True)
        finally:
            for proc in reversed(self.procs):
                if proc.poll() is None:
                    proc.terminate()
            for proc in self.procs:
                try:
                    proc.wait(timeout=10)
                except subprocess.TimeoutExpired:
                    proc.kill()
            if self.armed:
                peak = self.armed["peak"]
                self.queue(peak - self.args.pre, peak + self.args.post, self.armed["score"], peak, "auto")
            self.flush_pending(final=True)
            self.pool.shutdown(wait=True)
            if self.chat:
                self.chat.stop()
            if not self.args.keep_buffer:
                shutil.rmtree(self.buf_dir, ignore_errors=True)
        with self.lock:
            self.write_manifest()
        ranked = sorted(self.clips, key=lambda c: -c["score"])
        print(f"\n✓ {len(ranked)} clips from {scoring.hms(self.t)} of stream → {self.out_dir}/")
        for c in ranked:
            print(f"  #{c['rank']:<2} {c['moment']}  score {c['score']:>5}  {Path(c['file']).name}")
        return ranked


def clip_live(args) -> list[dict]:
    return LiveClipper(args).run()
