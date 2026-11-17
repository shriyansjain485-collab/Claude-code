# clipbot

Clips the best moments of **live streams** while they're happening, and the top
moments of **finished streams and videos**, as fast as possible.

Only clip streams and videos you own or have permission to use (your own
channel, a creator who has agreed, a podcast you appeared on). Reposting other
people's content without permission can get your accounts struck.

## Install

Needs Python 3.10+ and ffmpeg.

```bash
pip install -r clipbot/requirements.txt
```

```bash
sudo apt install ffmpeg        # macOS: brew install ffmpeg
```

`streamlink` is optional. When it's installed, live mode uses it for lower
latency and Twitch ad skipping; otherwise it falls back to yt-dlp.

## Live: clip moments as they happen

```bash
python -m clipbot live https://twitch.tv/yourchannel
```

- Records a rolling 5-minute buffer of the stream (stream copy, almost no CPU).
- Scores every second as it arrives:
  - **audio**: sudden jumps in loudness (screams, laughter, cheering), measured
    against the stream's own recent level, so quiet and loud streamers both work
  - **Twitch chat**: message rate, with extra weight for hype messages (`KEKW`,
    `CLIP IT`, `?????`, `W`, 💀…). Read-only and anonymous: no login, never posts.
- When the score spikes, it waits for the reaction to finish, then cuts 20s
  before to 10s after the peak. The clip is on disk 1–2 seconds after that
  post-roll finishes recording.
- **Press Enter** at any time to clip the last 30 seconds by hand.
- Ctrl+C stops it. You get a ranked list, and a `manifest.json` that updates as clips are made.

Useful options:

| Option | What it does |
|---|---|
| `--threshold 2.0` | more clips (default 2.5; higher means only the biggest moments) |
| `--top 10` | keep only the 10 best moments; weaker clips are deleted as better ones happen |
| `--vertical` | export 1080×1920 for Reels/TikTok/Shorts (re-encodes, so it takes longer) |
| `--pre 25 --post 8` | how much to keep before and after the peak |
| `--on-clip "cmd {file}"` | run a command for each new clip, e.g. upload it or send a notification |
| `--quality 720p` | lighter recording |

Works with Twitch, YouTube Live, Kick and anything else streamlink or yt-dlp can
read. It also takes a direct `rtmp://`, `srt://` or `.m3u8` feed, such as your
own OBS output, and plays a local file back in real time for testing.

## VOD / video: find the top moments of something already recorded

```bash
python -m clipbot vod "https://www.youtube.com/watch?v=..." --top 10
```

```bash
python -m clipbot vod recording.mp4 --top 5 --vertical
```

Fast path for URLs:

1. Downloads **audio only**, a fraction of the video's size.
2. Scans the whole thing in ffmpeg. A 3-hour stream takes seconds.
3. On YouTube, also uses the **"Most replayed"** graph when the video has one.
4. Downloads **only the clip sections** in parallel, never the full VOD. Use
   `--full-download` when you want many clips from a short video.

Local files are cut with stream copy, which takes well under a second per clip.

## Output

```
clips/<stream-name>/
  01_1-23-45_score6.2.mp4     rank_timestamp_score
  02_0-41-10_score5.1.mp4
  manifest.json               times, scores, links to the moment in the source
```

`clips/` is git-ignored. To turn clips into posts, run `/clip` in Claude Code
(see `.claude/skills/clip/SKILL.md`). It runs the bot, then drafts captions in
`content/drafts/` for you to approve. Nothing is posted automatically.

## Tuning tips

- Too many clips: raise `--threshold`, or use `--top`.
- Missing moments in a calm or talky stream: lower `--threshold` to 2.0 or less.
  In VOD mode, use `--min-score 0.5`.
- Gameplay with constant music: chat is the stronger signal, so raise `--chat-weight`.
- Clips cut at keyframes in copy mode, so a clip can start up to about 2s early.
  Use `--vertical` (re-encode) for frame-exact cuts.
