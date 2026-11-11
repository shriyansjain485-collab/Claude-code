---
name: clip
description: Turn YouTube links into Shorts for the clips channel. Fetches a video the owner has rights to clip, picks the strongest moments, cuts vertical clips with captions and hook titles, drafts titles and descriptions, uploads the approved ones, or produces the channel's weekly report. Use when the owner pastes a YouTube link to clip, says "approve", or asks how the clips channel is doing.
argument-hint: "<youtube-url ...> [rights basis] | approve <clip|all> | report | setup"
---

# Clips channel

Input: `$ARGUMENTS`. Pick a mode:

- **One or more YouTube links** → fetch, pick moments, cut, draft.
- **`approve <clip | all>`** → move to `content/approved/`, upload, log as published.
- **`report`** → pull stats and write the weekly clips report.
- **`setup`** → fill in `brand/clips-channel.md` and walk through
  `tools/shorts/README.md` (ffmpeg, Python packages, Google OAuth sign-in).

## Steps for links

1. Read `brand/clips-channel.md`. If it is mostly `TODO`, run `setup` first.
2. For each link, confirm the rights basis. If the creator is in the profile's
   approved sources, use that row. Otherwise ask once: "Is this your video, do
   you have the creator's permission or a clipping-programme licence, or is it
   Creative Commons?" No basis, no clip; offer to draft a permission request
   to the creator instead.
3. Check the tools work (`ffmpeg -version`, `python tools/shorts/shorts.py -h`).
   In a cloud session YouTube may be blocked by the network policy and the cut
   videos disappear with the session, so say so and recommend running on the
   owner's computer.
4. Delegate to the `shorts-clipper` agent (or follow its rules directly) for
   fetch → pick → cut → draft.
5. If a video has no captions, transcribe `work/clips/<id>/source.mp4` first
   (for example with `faster-whisper`, word timestamps on) and save the result
   as `source.en.json3` in YouTube's json3 shape so `cut` can caption it.
6. Show the owner a table: rank, hook, source timestamps, length, clip path,
   title. Ask which to approve. Revise hooks, cuts or titles on request.

## Approve and upload

Only on the owner's explicit approval of named clips (or "all" for the batch
just shown). Move the file to `content/approved/`, set `status: approved`, run
`upload`, then move it to `content/published/` with the link. If the upload
comes back private, explain the API-audit note in `tools/shorts/README.md`.

## Report

Run `python tools/shorts/shorts.py stats --days 7`, then follow the weekly
report section of the `shorts-clipper` agent. Revenue comes only from the stats
file; if it's missing, the channel isn't monetised yet.
