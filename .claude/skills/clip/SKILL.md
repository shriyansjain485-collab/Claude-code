---
name: clip
description: Clip the top moments of a live stream (while it's live), a finished stream/video, or live streams it finds on a topic, with clipbot, then turn the best clips into short-form post drafts for the personal or company brand. Use when the owner asks to clip a stream, find highlights, or make shorts from a video.
argument-hint: "<personal|company> <stream or video URL | file | topic> [live|vod|hunt] [--top N] [--vertical]"
---

# Clip a stream or video

Input: `$ARGUMENTS`. If the brand is missing, ask which one.

1. **Rights check.** Confirm the source belongs to the owner or that they have
   permission to clip it. If it's someone else's content, stop and say why.
2. **Setup.** If `yt-dlp` or `ffmpeg` is missing, install them following
   `clipbot/README.md` (`pip install -r clipbot/requirements.txt`).
3. **Run the bot** from the repo root:
   - Live stream: `python -m clipbot live <url> [--top N] [--vertical]`. Run it in
     the background, since it keeps going until the stream ends or is stopped.
     Report clips as they appear in `clips/<name>/manifest.json`.
   - A topic instead of a URL ("find chess streams and clip them"):
     `python -m clipbot hunt "<topic>" [--only CHANNEL …]`. Run it in the
     background. The ranked list of ready clips is `clips/<topic>/READY.md`.
     Twitch search needs `TWITCH_CLIENT_ID` and `TWITCH_CLIENT_SECRET` (see
     `clipbot/README.md`).
   - Finished stream or video: `python -m clipbot vod <url|file> --top 10`
   - Add `--vertical` when the clips are meant for Reels, TikTok or Shorts.
4. **Review.** List the clips by rank, with timestamp, score and length. If the
   video has a transcript (`vidiq_video_transcript` for YouTube, or the owner
   pastes one), say what happens in each clip. Never guess what's in a clip you
   can't see or hear. Ask the owner to watch the clips and pick which ones to use.
5. **Draft posts** for the clips the owner picks, using the `reels-producer`
   agent (Reels) or `content-creator` agent (other platforms). Save each draft to
   `content/drafts/` with the usual front matter, and put the clip path in
   `visual:`. Include hook text for the first second, the on-screen caption, the
   post caption and the cover frame.
6. **Never publish or upload.** The owner approves each draft, following the
   rules in `CLAUDE.md`.
