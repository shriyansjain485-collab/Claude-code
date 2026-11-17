"""clipbot — clip the best moments of live streams and videos, fast.

  python -m clipbot live  <stream url | rtmp/srt/m3u8 | file>
  python -m clipbot vod   <video url | file>
  python -m clipbot hunt  "<topic>"      find live streams on a topic and clip them
"""

from __future__ import annotations

import argparse


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog="clipbot", description=__doc__,
                                formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = p.add_subparsers(dest="mode", required=True)

    def common(sp: argparse.ArgumentParser) -> None:
        sp.add_argument("source", help="URL (Twitch, YouTube, Kick, … anything yt-dlp supports) or a local file")
        sp.add_argument("--out", default="clips", help="output folder (default: clips/)")
        sp.add_argument("--pre", type=float, default=20, help="seconds kept before the peak (default 20)")
        sp.add_argument("--post", type=float, default=10, help="seconds kept after the peak (default 10)")
        sp.add_argument("--vertical", action="store_true",
                        help="export 1080x1920 for Reels/TikTok/Shorts (re-encodes; slower than the default copy)")
        sp.add_argument("--workers", type=int, default=4, help="clips cut in parallel (default 4)")
        sp.add_argument("--audio-weight", type=float, default=1.0, help="weight of the loudness signal")
        sp.add_argument("--ytdlp-arg", action="append", metavar="ARG",
                        help="extra argument passed to yt-dlp/streamlink, e.g. --ytdlp-arg=--cookies-from-browser=chrome")

    vod = sub.add_parser("vod", help="find and cut the top moments of a finished stream or video")
    common(vod)
    vod.add_argument("--top", type=int, default=10, help="number of clips (default 10)")
    vod.add_argument("--min-gap", type=int, default=60, help="minimum seconds between clips (default 60)")
    vod.add_argument("--min-score", type=float, default=1.0, help="skip moments below this hype score (default 1.0)")
    vod.add_argument("--replay-weight", type=float, default=1.5,
                     help="weight of YouTube's 'Most replayed' data when available (default 1.5)")
    vod.add_argument("--full-download", action="store_true",
                     help="download the whole video once, then cut locally (faster for many clips of a short video)")
    vod.add_argument("--keep-work", action="store_true", help="keep downloaded audio in clips/<name>/.work")

    live = sub.add_parser("live", help="watch a live stream and clip hype moments as they happen")
    common(live)
    live.add_argument("--threshold", type=float, default=2.5,
                      help="hype score that triggers a clip; lower = more clips (default 2.5)")
    live.add_argument("--cooldown", type=float, default=30, help="minimum seconds between auto clips (default 30)")
    live.add_argument("--top", type=int, default=0,
                      help="keep only the N best auto clips, deleting weaker ones as better moments happen (default: keep all)")
    live.add_argument("--warmup", type=int, default=60, help="seconds to learn the stream's normal level first (default 60)")
    live.add_argument("--buffer", type=int, default=300, help="seconds of stream kept on disk (default 300)")
    live.add_argument("--quality", default="best", help="stream quality, e.g. best, 1080p, 720p (default best)")
    live.add_argument("--channel", help="Twitch channel whose chat to watch (auto-detected from twitch.tv URLs)")
    live.add_argument("--no-chat", action="store_true", help="don't use Twitch chat")
    live.add_argument("--chat-weight", type=float, default=1.5, help="weight of the chat-activity signal (default 1.5)")
    live.add_argument("--on-clip", metavar="CMD",
                      help="command run for each new clip; {file} is replaced with its path")
    live.add_argument("--keep-buffer", action="store_true", help="keep the rolling buffer when the bot stops")
    live.add_argument("--name", help="fixed output folder name inside --out (default: <channel>_<date>)")

    hunt = sub.add_parser("hunt", help="find live streams about a topic and keep the best clips ready")
    hunt.add_argument("topic", help='what to look for, e.g. "fortnite", "startup pitch", "chess"')
    hunt.add_argument("--sites", default="youtube,twitch", help="where to search (default youtube,twitch)")
    hunt.add_argument("--max-streams", type=int, default=3, help="streams clipped at the same time (default 3)")
    hunt.add_argument("--min-viewers", type=int, default=20, help="skip streams with fewer viewers (default 20)")
    hunt.add_argument("--language", help="only streams in this language code, e.g. en (Twitch reports it)")
    hunt.add_argument("--only", action="append", metavar="CHANNEL",
                      help="only clip these channels (repeat; use for creators who allowed clipping)")
    hunt.add_argument("--exclude", action="append", metavar="CHANNEL", help="never clip this channel (repeat)")
    hunt.add_argument("--rescan", type=int, default=300, help="seconds between searches for new streams (default 300)")
    hunt.add_argument("--search-limit", type=int, default=20, help="results checked per site per search (default 20)")
    hunt.add_argument("--top-per-stream", type=int, default=5, help="best clips kept per stream (default 5)")
    hunt.add_argument("--board-size", type=int, default=25, help="clips listed in READY.md (default 25)")
    hunt.add_argument("--threshold", type=float, default=2.5, help="hype score that triggers a clip (default 2.5)")
    hunt.add_argument("--warmup", type=int, default=60, help="seconds to learn each stream's normal level (default 60)")
    hunt.add_argument("--quality", default="720p", help="recording quality per stream (default 720p)")
    hunt.add_argument("--pre", type=float, default=20, help="seconds kept before the peak (default 20)")
    hunt.add_argument("--post", type=float, default=10, help="seconds kept after the peak (default 10)")
    hunt.add_argument("--vertical", action="store_true", help="export 1080x1920 clips (uses much more CPU)")
    hunt.add_argument("--out", default="clips", help="output folder (default: clips/)")
    hunt.add_argument("--ytdlp-arg", action="append", metavar="ARG", help="extra argument passed to yt-dlp/streamlink")
    return p


def main(argv: list[str] | None = None) -> None:
    args = build_parser().parse_args(argv)
    try:
        if args.mode == "vod":
            from .vod import clip_vod
            clip_vod(args)
        elif args.mode == "hunt":
            from .hunt import clip_hunt
            clip_hunt(args)
        else:
            from .live import clip_live
            clip_live(args)
    except RuntimeError as exc:
        raise SystemExit(f"clipbot: {exc}")
    except KeyboardInterrupt:
        raise SystemExit(130)


if __name__ == "__main__":
    main()
