# Clips pipeline

Two ways to run it: the **web dashboard** (below), or the `shorts-clipper`
agent via `/clip` in Claude Code. Both drive `shorts.py` and share the same
files, so you can mix them.

## Web dashboard

```bash
python tools/shorts/web.py
```

Then open http://127.0.0.1:8765. Paste a link and your rights basis, pick a
moment (by hand with the player, or with **Suggest moments**), cut it, watch
it, approve it, post it, and pull the week's numbers.

- It runs only on your computer and is not reachable from the internet. Don't
  host it publicly: it has no login and it holds your YouTube sign-in.
- **Suggest moments** calls the Claude API, which is billed per use. Set
  `ANTHROPIC_API_KEY` before starting the dashboard. Without it everything
  else still works.
- Posting defaults to **private** so you can check the video on YouTube first.

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
