# Jarvis — Plan

A personal assistant in the style of Jarvis that runs **entirely on your Mac**,
works with **Wi-Fi off**, and cannot do anything you haven't approved.

> **Status:** approved on 2026-11-10. **Milestone 1 is built** (see README.md).
> Confirmed: 16 GB M4 Mac; "daily needs" = notes, reminders, briefing,
> remembered facts, date/time/maths; default model `qwen3.5:9b`.
>
> **Change from the original brief:** you chose to run the model on a
> **remote/cloud VM** instead of on the Mac. That breaks the offline guarantee
> (Jarvis needs the internet, and what you type is sent to the VM). The design
> keeps Jarvis itself talking only to `127.0.0.1`: the VM is reached through
> an encrypted SSH tunnel (README §5). Running the model on the Mac remains
> the default and works with no code change.
>
> **Added on request:** a browser UI (`./run.sh --ui`), served by Jarvis
> itself on `127.0.0.1` only, with a secret token. This replaces the earlier
> "Jarvis itself opens no server" statement in §6.

---

## 0. What I understood from your answers

| Topic | Your answer | What it means for the build |
|---|---|---|
| Computer | Mac, Apple Silicon, 16 GB+ | Plan for **16 GB** (the tightest case). The model must fit in ~8 GB so macOS and your apps keep the rest. |
| Interface | Text now, voice later | Milestones 1–3 are terminal chat. Voice is milestone 4. |
| Main uses | Daily needs, find & summarise files, draft emails/documents | See "Assumptions" below for what "daily needs" covers. |
| Skill level | Beginner | Every setup step is a copy-paste command with an explanation. One command to start, one to stop. |
| Name / address | "Jarvis", calls you "sir" | Both are settings in `config.toml`, so you can change them without touching code. |

### Assumptions (please correct any of these when you approve)

1. **"Daily needs" means:** notes, reminders, a morning briefing, remembering
   facts you tell it ("remember my dentist is Dr Rao"), and date/time/maths.
   If you meant something else (e.g. to-do lists, habit tracking, a shopping
   list), tell me.
2. **Everything lives in a new `jarvis/` folder inside this repository.**
   The rest of the repo (the brand & socials material) is not touched.
3. **Your personal data (notes, drafts, reminders, audit log) lives in
   `jarvis/data/`**, which is excluded from git so it never gets pushed.
4. **Exact RAM:** if your Mac has **24 GB or more**, tell me. I would then
   recommend a larger, smarter model.

### One thing to know about how I work

I'm building in a **Linux cloud workspace**, not on your Mac. I write the code
and run the tests here, using a small fake "model" on localhost so the tests
don't need a 6 GB download. Then I push to git. You pull the code onto your Mac
and do the one-time setup: Python, Ollama and the model, each of which I'll
ask about first. A few checks are Mac-only (e.g. the OS-level network block in
§6), and I'll give you the exact command for those.

---

## 1. Architecture

```
 You (terminal)                    (later: microphone → wake word → speech-to-text)
     │
     ▼
 ┌──────────────┐   prompt + tool list    ┌─────────────────────────────┐
 │  Chat loop   │ ──────────────────────▶ │ Ollama on 127.0.0.1:11434   │
 │  (cli.py)    │ ◀────────────────────── │ model: qwen3.5:9b (swappable)│
 └──────┬───────┘   reply or tool call    └─────────────────────────────┘
        │ tool call
        ▼
 ┌─────────────────────── Safety gate (agent.py) ────────────────────────┐
 │ 1. Is it a known tool?           unknown → refuse                     │
 │ 2. Validate inputs vs schema     invalid → ask model once, then ask you│
 │ 3. Permission tier               READ → run │ WRITE → show diff, ask "yes"│
 │ 4. Path allowlist / command allowlist / forbidden-action check         │
 │ 5. Dry-run? → show, don't apply                                        │
 │ 6. Append to audit log (always, including refusals)                    │
 └───────┬────────────────────────────────────────────────────────────────┘
         ▼
   Tool modules (files, notes, reminders, briefing, drafts, clock, …)
         │ results are wrapped as UNTRUSTED DATA before going back to the model
         ▼
   Local storage: markdown files in jarvis/data/ (you can open and edit them)
```

**Key design decisions**

- **The model never touches your computer directly.** It can only *propose* a
  tool call. Plain Python code checks every proposal and then runs it, asks
  you, or refuses it.
- **A network guard is installed at startup:** the first thing Jarvis does is
  block every outbound connection except to `127.0.0.1` (localhost). If any
  library tries to "phone home", it fails loudly and is logged.
- **Memory is plain markdown** (`notes/*.md`, `reminders.md`, `memory.md`) so
  you can read and edit it in any text editor. SQLite isn't needed at this size;
  we can add it later for search speed if notes grow into the thousands.

---

## 2. Model choice (the "brain")

**Runtime: [Ollama](https://ollama.com)**. It is the most widely used local
runtime on Mac, supports tool calling, uses Apple Silicon's GPU, and serves on
localhost only by default.

| Role | Model (Ollama tag) | Download | Why |
|---|---|---|---|
| **Recommended default** | `qwen3.5:9b` (Q4_K_M) | **6.6 GB** | Listed with the *tools* capability in Ollama's library. Vendor-reported BFCL-V4 (function calling) 66.1. Fits a 16 GB Mac with room to spare. |
| Alternative to compare | `gemma4:e4b` (Q4_K_M) | ~6.6 GB | Google's 2026 small model with native function calling. One informal test found it slightly more reliable at tool calls than qwen3 8B, but the sample was tiny. |
| Lighter fallback | `qwen3:4b` | ~2.5 GB | Use this if replies are too slow on your Mac. Weaker at tool calling. |
| **Not recommended on 16 GB** | anything 14B+ (e.g. `gemma4:26b` ≈ 16 GB) | — | Won't fit alongside macOS, or will be very slow. |

- Benchmarks for small models are mostly vendor-reported or informal blog tests,
  so I'll also include `scripts/eval_tools.py`: about 20 realistic requests
  ("find my tax PDF", "remind me Tuesday at 9") that score how often a model
  calls the right tool with valid arguments. Run it on your Mac and keep the
  winner. Comparing two models means downloading both (~13 GB), so the
  comparison is optional.
- **Speed (estimate, not measured):** a 9B model at Q4 on an M-series Mac
  typically gives roughly 15–30 words per second. We'll measure on your Mac.
- "Thinking" mode is **off** by default for speed (`think = false` in config).
- **Swappable:** change `model = "..."` in `config.toml`.
- **Offline safeguard:** Ollama also offers *cloud* models (tags containing
  `cloud`), which run on Ollama's servers. Jarvis **refuses to start** if the
  configured model name contains `cloud`, and it checks that the model is
  already downloaded locally.

---

## 3. File layout

```
jarvis/
  PLAN.md                 this file
  README.md               setup, usage, adding a tool, troubleshooting
  run.sh                  ONE command to start (checks Ollama, starts it on localhost if needed)
  stop.sh                 ONE command to stop Jarvis immediately from another terminal
  config.example.toml     copied to config.toml on first run; config.toml is yours to edit
  pyproject.toml
  requirements-dev.lock   test tools pinned with SHA-256 hashes
  src/jarvis/
    __main__.py           `python -m jarvis`
    cli.py                terminal chat loop, Ctrl+C handling, approval prompts
    agent.py              model ↔ safety gate ↔ tools loop
    llm.py                tiny Ollama client (localhost only, stdlib http)
    config.py             loads + validates config.toml
    personality.py        system prompt built from config (name, "sir", tone)
    schema.py             typed-input validator (types, enums, lengths, patterns)
    safety/
      netguard.py         blocks all non-localhost connections + sets no-telemetry env vars
      paths.py            folder allowlist, symlink escape check, sensitive-file denylist
      permissions.py      READ / WRITE tiers, approval flow, dry-run
      forbidden.py        never-allowed actions (payments, passwords, deletion, system settings)
      injection.py        flags instructions hidden inside files/notes
      commands.py         fixed allowlist of system commands (no shell, validated args)
      audit.py            append-only, hash-chained audit log
      killswitch.py       pidfile, signal handling, stop.sh support
    tools/
      base.py             Tool definition: name, description, input schema, tier, run(), preview()
      registry.py         registers tools; rejects unsafe or online-only tools unless enabled
      clock.py            date/time, simple maths (safe parser, no eval)          [M1]
      files.py            find_files, read_file (txt, md; pdf/docx in M3)          [M1, M3]
      notes.py            search_notes, read_note, create_note, append_to_note     [M1]
      memory.py           remember_fact, recall                                    [M2]
      reminders.py        add / list / complete reminders                          [M2]
      briefing.py         daily briefing                                           [M2]
      drafts.py           draft_email, draft_document, edit_draft (never sends)    [M3]
    voice/                wake word, speech-to-text, text-to-speech                [M4]
  tests/
    conftest.py           AUTOUSE network blocker: any non-localhost connection fails the test
    fake_ollama.py        local stand-in model server for tests
    test_<tool>.py        one per tool
    test_safety_*.py      tiers, allowlist, forbidden, injection, audit, dry-run, kill switch
    test_offline_*.py     offline guarantee tests (see §6)
  scripts/
    eval_tools.py         compare models on tool-calling accuracy
    verify_downloads.sh   checks Ollama's code signature and model digests
  data/                   (git-ignored) notes/, reminders.md, memory.md, drafts/, audit.log
```

---

## 4. Dependencies (each needs your OK before I install it)

**Approach: the core uses only Python's standard library.** No third-party
packages are needed to *run* Jarvis in milestones 1–3. That means less to
download, less to trust, and nothing that can phone home. I'll write a small
input validator (~150 lines, heavily tested) rather than pull in pydantic,
whose compiled parts would make hash-pinning differ between my Linux workspace
and your Mac.

| What | Why | Size (approx.) | Source | When |
|---|---|---|---|---|
| **Python 3.11+** | runs Jarvis | ~30–45 MB | If you don't have it: [uv](https://docs.astral.sh/uv/) (Astral) installs Python **inside your home folder, no admin password**. The python.org installer is the alternative, but it installs system-wide. | M1, on your Mac |
| **Ollama** | runs the model locally | a few hundred MB (I'll confirm the exact size before you install) | ollama.com or its official GitHub releases. We'll verify the Apple code signature. | M1, on your Mac |
| **qwen3.5:9b** | the brain | 6.6 GB | Ollama's official registry. Ollama verifies each file's SHA-256 digest. | M1, on your Mac |
| **pytest** (+ pluggy, iniconfig, packaging) | running tests only | ~1.5 MB, pure Python | PyPI, installed with `--require-hashes` | M1 |
| **pypdf** | read PDFs | ~0.3 MB, pure Python | PyPI, hash-pinned | M3 (optional) |
| *(no package)* | read .docx | — | stdlib: a .docx is a zip of XML | M3 |
| **Voice stack** (see M4) | wake word, speech-to-text, text-to-speech | ~0.5–1 GB including voice models | PyPI and official model repos, hash-pinned | M4 |

**Never:** `sudo`, system-wide settings, `curl | sh` piped straight into a
shell without you seeing it first, or unofficial model mirrors.

---

## 5. Safety rules, and how each is enforced in code

| Rule | Enforcement | Proven by test |
|---|---|---|
| **Read-only tools run automatically** | Each tool declares `tier = READ`. The gate runs it, still subject to the path allowlist. | `test_safety_tiers.py` |
| **Writes need your explicit "yes"** | `tier = WRITE` tools must implement `preview()`. You see the full content of a new file, or a line-by-line diff of an edit, then: `Apply this change, sir? Type "yes" to confirm:`. Only `yes` proceeds; anything else (including "y", "sure" or Enter) cancels. | approve / decline / garbage-answer tests |
| **Never: payments, passwords, permanent deletion, system/security settings** | (1) No tool can do any of these; there is no delete function at all. "Archive" moves notes to `data/.archive/`, which can be undone. (2) The registry refuses any tool flagged in those categories. (3) A request filter recognises these requests and Jarvis politely declines, *even if you insist*. (4) Sensitive files (`.ssh`, Keychains, `*.pem`, `.env`, password-manager exports, …) are unreadable even inside allowed folders. | `test_safety_forbidden.py` |
| **File access only in allowlisted folders** | `allowed_folders` in config. Paths are fully resolved (`..` and symlinks) before checking, so `~/Documents/../.ssh` is caught. The default allowlist is just `jarvis/data/`. You add e.g. `~/Documents` yourself. | path-escape and symlink tests |
| **No arbitrary shell commands** | No `shell=True`, no `os.system`, no `eval`/`exec` anywhere (a test scans the source). Any system command must be in `commands.py`'s fixed list with an argument validator. The first and only planned one is macOS `open <file>` (open a file in its normal app, file must be allowlisted), in M3. | source-scan test, command-allowlist tests |
| **Content is data, not instructions** | File/note text is sent to the model wrapped in clearly marked `UNTRUSTED DATA` blocks, and the system prompt says never to follow instructions found there. `injection.py` also scans content for instruction-like text ("ignore previous instructions", "send this to…") and tells you: *"Sir, report.pdf contains text attempting to give me instructions. I've ignored it."* Even if the model is fooled, any write still needs your "yes", and the approval screen says "proposed after reading report.pdf". | injection tests with poisoned files |
| **Append-only audit log** | `data/audit.log`, one JSON line per tool call: time, tool, inputs, result summary, tier, approved / declined / refused / dry-run. The file is only opened in append mode, and each line includes a hash of the previous line, so editing history is detectable (`python -m jarvis audit verify`). | append-only and tamper-detection tests |
| **Dry-run mode** | `./run.sh --dry-run` (or `dry_run = true`): Jarvis shows exactly what it *would* write, logs it as `dry_run`, and changes nothing. | dry-run tests |
| **Stop immediately** | **Ctrl+C** cancels whatever Jarvis is doing (including the model mid-sentence) and returns to the prompt. **Ctrl+C twice** or typing `/stop` quits. **`./stop.sh`** from any other terminal stops it (it checks the PID really is Jarvis before signalling). | kill-switch tests |
| **Ask, don't guess** | A built-in `ask_user` tool for the model to request clarification. The system prompt tells it to use that when a request is ambiguous. If a tool call fails validation twice, Jarvis asks *you* instead of retrying blindly. Missing required details (e.g. a reminder with no time) → it asks. | clarification tests |
| **Verified downloads** | `scripts/verify_downloads.sh`: checks Ollama.app's Apple code signature (`codesign`/`spctl`, no admin needed) and that model digests match Ollama's official registry. Python packages are installed with `--require-hashes` from PyPI. | run once on your Mac |
| **Voice (M4)** | The mic is processed only for the wake word until it fires. Audio stays in memory and is never written to disk (a test checks no audio files appear). A visible `● LISTENING` indicator shows in the terminal. | voice tests |

---

## 6. Offline guarantee

**At runtime, Jarvis connects to nothing except Ollama on `127.0.0.1`.**

1. **In-process guard** (`netguard.py`, installed before anything else is
   imported): socket connections and DNS lookups to anything other than
   `127.0.0.1` / `::1` raise an error and are logged.
2. **No telemetry anywhere:** Jarvis has none. At startup it also sets the
   standard opt-out variables (`DO_NOT_TRACK=1`, `HF_HUB_OFFLINE=1`,
   `HF_HUB_DISABLE_TELEMETRY=1`, …) for any library added later. For Ollama:
   `run.sh` starts the command-line server bound to `OLLAMA_HOST=127.0.0.1`
   instead of relying on the menu-bar app. During setup we'll turn off its
   auto-update and cloud features in whatever form your installed version
   offers (I'll check the current settings then rather than guess now).
3. **Local servers bind to localhost only.** Jarvis itself opens no server.
   Ollama is told to use `127.0.0.1`, and Jarvis refuses to start if Ollama is
   reachable on a non-local address.
4. **Online tools are off by default.** The tool framework has a
   `requires_network` flag. Such tools are refused unless you set
   `allow_online_tools = true`, and they're labelled `⚠ BREAKS OFFLINE MODE`
   in `/tools` and at startup. **I'm not planning to build any online tools.**

**Tests**

- `conftest.py` blocks the network for **every** test. Any code path that tries
  an outbound connection fails the suite.
- `test_offline_guard.py`: deliberately tries to reach a public address and
  DNS, and asserts both are blocked and logged.
- `test_offline_conversation.py`: starts Jarvis as a real subprocess with
  networking blocked, has a full conversation (including a tool call and an
  approved write) against the local fake model, and checks it works.
- **OS-level check, no admin needed:** on Linux (my workspace) the same
  conversation test also runs in a network namespace with no internet at all
  (`unshare -rn`). On your Mac, `scripts/offline_check.sh` runs Jarvis under
  macOS's built-in sandbox with outbound network denied.
- **Final acceptance (you, on your Mac):** turn Wi-Fi off → `./run.sh` → chat.

---

## 7. Personality (config.toml)

```toml
[assistant]
name = "Jarvis"
address_user_as = "sir"
style = "concise, polite, a little dry wit; never sycophantic; asks rather than guesses"

[model]
name = "qwen3.5:9b"
host = "http://127.0.0.1:11434"   # must be localhost; anything else is rejected
think = false
temperature = 0.3

[safety]
allowed_folders = ["./data"]       # add e.g. "~/Documents" yourself
dry_run = false
allow_online_tools = false         # ⚠ true breaks offline mode
```

---

## 8. Milestones

Each milestone ends with: how to run it, all tests passing, a git commit, a
push, and a short summary for you. I'll stop and ask before any milestone
that needs a new dependency or download.

| # | Milestone | You'll be able to… | Needs your OK for |
|---|---|---|---|
| **M1** | **Core + text chat + 3 tools.** Safety gate, validator, tiers, allowlist, audit log, dry-run, kill switch, network guard, forbidden-action filter. Tools: `clock` (date/time/maths), `files` (find + read .txt/.md, so Jarvis can summarise), `notes` (search/read/create/append, with approval). Offline tests. README v1. | `./run.sh`, chat with Jarvis, ask "find my notes about the trip and summarise them", save a note with a "yes". | pytest (dev only). On your Mac: Python (if missing), Ollama, `qwen3.5:9b`. |
| **M2** | **Daily needs.** Reminders (shown at startup and whenever due while Jarvis is open), `remember`/`recall` facts, `/briefing` (date, today's reminders, recent notes, open drafts). | "Remind me Thursday 9am to call the bank", "Good morning, Jarvis" → briefing. | nothing new |
| **M3** | **Drafts + richer files.** `draft_email` and `draft_document` save to `data/drafts/` as markdown. Jarvis **never sends** anything. Edit drafts with a diff + approval. PDF and .docx reading. Allowlisted `open` command. Optional `eval_tools.py` model comparison. | "Draft a polite email to my landlord about the boiler", then open it in your mail app and send it yourself. | pypdf (optional, 0.3 MB) |
| **M4** | **Voice.** Wake word "Hey Jarvis" via openWakeWord (it ships a pretrained *hey jarvis* model). Speech-to-text via faster-whisper (`base.en` ~140 MB or `small.en` ~470 MB). Text-to-speech via Piper (e.g. a British voice, ~60 MB). Mic via sounddevice. Before starting I'll re-check that each project is still maintained (Piper moved to a new home in 2025) and confirm exact sizes and licences. | `./run.sh --voice`: say "Hey Jarvis…" with a visible listening indicator. Text chat still works alongside. | the voice packages + voice models (~0.5–1 GB) |
| **M5** | **Polish + acceptance.** Optional macOS notifications for reminders (allowlisted `osascript` with a fixed template), README final pass, Wi-Fi-off acceptance checklist. | Everything in "Done means". | nothing new |

---

## 9. "Done means" checklist

- [ ] `./run.sh` starts Jarvis with Wi-Fi off and you can hold a conversation.
- [ ] Every tool has passing tests, including safety and offline tests.
- [ ] README covers setup, daily use, how to add a tool, and troubleshooting.

---

## 10. Questions for you when approving

1. Is the **"daily needs"** interpretation right (notes, reminders, briefing, remembered facts, date/time/maths)?
2. Exact **RAM** (16 GB, or more)? And which chip (M1/M2/M3/M4)?
3. Do you already have **Python 3.11+** on your Mac (`python3 --version` in Terminal)? If not, OK to use **uv** to install it in your home folder?
4. OK with **`qwen3.5:9b`** (6.6 GB) as the default model?

Reply **"approved"** (with any changes) and I'll start Milestone 1.
