# Clips pipeline (`shorts.py`)

The `shorts-clipper` agent drives this script; you rarely run it by hand.

## One-time setup (on your own computer)

1. Install [ffmpeg](https://ffmpeg.org/download.html) and Python 3.10+, then:
   ```bash
   pip install -r tools/shorts/requirements.txt
   ```
2. In [Google Cloud Console](https://console.cloud.google.com/): create a project,
   enable **YouTube Data API v3** and **YouTube Analytics API**, create an OAuth
   client of type **Desktop app**, and download its JSON to
   `~/.config/shorts-agent/client_secret.json`.
3. Sign in as the clips channel:
   ```bash
   python tools/shorts/shorts.py auth
   ```
   The token is stored in `~/.config/shorts-agent/`, never in this repo.

Until Google has audited your API project, videos uploaded through the API are
locked to **private**. Request the audit ("YouTube API Services - Audit and Quota
Extension Form") or flip each video to public in YouTube Studio. The default quota
also allows only about 6 uploads a day.

## Commands

| Command | What it does |
|---|---|
| `fetch <url> --rights <basis> [--note "..."]` | Downloads the video and captions to `work/clips/<id>/`, writes `transcript.txt` and `meta.json`. Refuses `cc-by` if YouTube doesn't list a Creative Commons licence. |
| `cut <id> --start 12:30 --end 13:05 --slug <slug> --hook "..."` | 1080x1920 clip with word-timed burned-in captions and a 3-second hook title. `--mode blur` keeps the whole frame; `--focus 0..1` moves the crop. |
| `upload content/approved/<file>.md` | Uploads the clip. Refuses anything not in `content/approved/` with `status: approved`. |
| `stats --days 7` | Writes channel, per-video and (if monetised) revenue numbers to `reports/data/`. |

`work/` is git-ignored: videos stay on the machine that made them, so fetch, cut
and upload have to run on the same machine.
