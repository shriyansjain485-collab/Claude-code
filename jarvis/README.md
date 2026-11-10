# Jarvis

A personal assistant that runs on your own Mac, talks to a local AI model, and
cannot change anything without your "yes".

**Status: Milestone 1 of 5.** Text chat in the terminal with three abilities:
date/time and arithmetic, finding and reading your files, and notes. Reminders,
briefings, drafts and voice come in later milestones (see `PLAN.md`).

---

## 1. Setup (one time, needs internet)

Open the **Terminal** app. Each grey box below is one command: paste it and
press Enter. None of them need an admin password. If one asks for a password,
stop and ask before continuing.

### Step 1: Get the code

If you haven't already, clone the repository and go into the `jarvis` folder:

```bash
git clone https://github.com/shriyansjain485-collab/Claude-code.git
```

```bash
cd Claude-code/jarvis
```

### Step 2: Python 3.11 or newer

Check what you have:

```bash
python3 --version
```

If it says 3.11 or higher, skip to step 3. Otherwise install **uv**, a
well-known Python installer from Astral (about 40 MB including Python, all
inside your home folder). Look at the installer first if you like, at
<https://docs.astral.sh/uv/getting-started/installation/>, then:

```bash
curl -LsSf https://astral.sh/uv/install.sh -o /tmp/uv-install.sh
```

```bash
less /tmp/uv-install.sh
```

```bash
sh /tmp/uv-install.sh
```

Close and reopen Terminal, go back to the `jarvis` folder, then create a
private Python for Jarvis in `.venv/`:

```bash
uv venv --python 3.12 .venv
```

### Step 3: Ollama (runs the AI model)

Download the Mac app from <https://ollama.com/download> and drag it to
Applications. Open it once so it installs the `ollama` command, then:

1. In Ollama's settings, turn **off** automatic updates and any cloud or
   "expose to network" option your version shows.
2. Quit the Ollama menu-bar app. `./run.sh` starts the model server itself,
   locked to this computer only.

### Step 4: Download the model (6.6 GB)

```bash
ollama pull qwen3.5:9b
```

### Step 5: Check the downloads are genuine

```bash
./scripts/verify_downloads.sh
```

This checks Ollama's Apple signature and re-computes every model file's
SHA-256 checksum.

**Setup is done. You can now turn Wi-Fi off.**

---

## 2. Daily use

Start Jarvis:

```bash
./run.sh
```

Then just type. For example:

- `what's the date today?`
- `what is 18% of 2,400?`
- `find my files about the Lisbon trip and summarise them`
- `save a note called Shopping: milk, eggs, bread`
- `add coffee to my shopping note`

| To do this | Do this |
|---|---|
| Cancel what Jarvis is doing right now | **Ctrl+C** |
| Quit | type `/stop`, or press Ctrl+C twice |
| **Stop it immediately from another window** | `./stop.sh` |
| See what it can do | `/tools` |
| Preview changes without making any | `./run.sh --dry-run`, or type `/dry-run` |
| See the last 30 actions it took | `PYTHONPATH=src .venv/bin/python -m jarvis audit` |
| Check nobody edited the action log | `PYTHONPATH=src .venv/bin/python -m jarvis audit verify` |

### When Jarvis wants to change something

It shows you exactly what will be written and waits:

```
────────────────────────────────────────────────────────────
APPROVAL NEEDED  (create_note)
────────────────────────────────────────────────────────────
CREATE new note: /Users/you/Claude-code/jarvis/data/notes/shopping.md
  + # Shopping
  +
  + milk, eggs, bread
────────────────────────────────────────────────────────────
Apply this change, sir? Type "yes" to confirm (anything else cancels):
```

Only the word `yes` applies it. Enter, `y`, `ok` and everything else cancel.

### Where your things are

Everything is a plain file in `jarvis/data/` that you can open and edit:

| File | What it is |
|---|---|
| `data/notes/*.md` | your notes, one file each |
| `data/audit.log` | every action Jarvis took or refused, one line each |

`data/` and `config.toml` are never sent to git.

---

## 3. Settings (`config.toml`)

Created on first run from `config.example.toml`. Open it in any text editor.

| Setting | What it does |
|---|---|
| `[assistant] name`, `address_user_as`, `style` | the personality: "Jarvis", "sir", dry wit |
| `[model] name` | which model to use. Swap it here, e.g. `gemma4:e4b` |
| `[model] think` | `true` = more careful but much slower |
| `[safety] allowed_folders` | the **only** folders Jarvis can search and read |
| `[safety] dry_run` | `true` = never change anything, only show |
| `[safety] allow_online_tools` | leave `false`. `true` breaks offline mode |

To let Jarvis see your Documents folder:

```toml
allowed_folders = ["./data", "~/Documents"]
```

Your whole home folder or whole disk is refused on purpose.

---

## 4. What keeps you safe

| Rule | How it is enforced |
|---|---|
| Reading is automatic, changing needs your "yes" | Every tool is tagged read or write. Write tools must show a preview first. |
| Never: payments, passwords, permanent deletion, system settings | No tool can do these. There is no delete tool at all. Tools tagged with these categories cannot be loaded. |
| Only allowed folders | Paths are fully resolved first, so `..` and shortcuts (symlinks) cannot escape. Keys, `.env` files and password stores are refused even inside allowed folders. |
| No shell commands | One fixed command exists (`ps`, used by `./stop.sh`). Nothing else can run. |
| Files are data, not orders | File and note text reaches the model inside "UNTRUSTED DATA" markers. If a file tries to give orders, Jarvis warns you and logs it. Any write still needs your "yes". |
| Audit log | `data/audit.log` records time, tool, inputs, result and approval for every call. Each line carries a checksum of the one before, so edits are detectable. |
| Offline | At startup, before anything else loads, Jarvis blocks every connection that isn't to this computer. Blocked attempts are logged. |
| Invalid requests from the model | Every tool call is checked against the tool's schema. After two bad calls Jarvis asks you instead of guessing. |

---

## 5. Model on a remote VM (optional, **breaks offline mode**)

By default the model runs on your Mac and nothing leaves it. If you would
rather run the model on a server you rent, be aware of what changes:

- Jarvis then **needs the internet** and does not work with Wi-Fi off.
- Everything you type, and any file text Jarvis reads, **is sent to that server**.
- Whoever runs the server can see it.

Your files, notes, audit log and all the safety rules stay on your Mac.

Ollama has no password protection, so never open its port to the internet.
Use an encrypted SSH tunnel instead, which makes the server's Ollama appear on
your Mac's own `127.0.0.1`:

1. On the VM: install Ollama, run `ollama pull qwen3.5:9b`, and leave Ollama
   listening on its default `127.0.0.1:11434`.
2. On your Mac, in a separate Terminal window (replace `you@your-vm`):

   ```bash
   ssh -N -L 11434:127.0.0.1:11434 you@your-vm
   ```

3. In another window, start Jarvis as usual with `./run.sh`.

`config.toml` stays unchanged, because Jarvis still talks to `127.0.0.1`.
Jarvis refuses any other model address, so the tunnel is the only supported
way to use a remote model.

---

## 6. Running the tests

One-time install of the test tool (pytest, about 2 MB, checksums verified):

```bash
uv pip install --python .venv/bin/python --require-hashes -r requirements-dev.lock
```

Run all tests:

```bash
.venv/bin/python -m pytest -q
```

The tests use a small stand-in model on localhost, so they need no model
download and run in about 20 seconds. Every test runs with the network
blocked; any code that tries to reach the internet fails the run.

Extra check on a Mac: run the same tests inside Apple's sandbox with
networking denied by macOS itself. (This script was written on Linux and has
not yet been run on a Mac; tell me if it misbehaves.)

```bash
./scripts/offline_check.sh
```

---

## 7. Adding a new tool

A tool is one small Python file. Example: a tool that counts the words in a note.

**1. Create `src/jarvis/tools/wordcount.py`:**

```python
from jarvis.tools.base import Tier, Tool, ToolContext, ToolResult
from jarvis.tools.notes import _existing


def _count_words(args: dict, ctx: ToolContext) -> ToolResult:
    path = _existing(ctx, args["title"])          # raises a clear error if missing
    words = len(path.read_text(encoding="utf-8").split())
    return ToolResult(f"The note '{path.stem}' has {words} words.")


TOOLS = [
    Tool(
        name="count_words",
        description="Count the words in one of the user's notes.",   # the model reads this
        parameters={                                                 # typed inputs
            "type": "object",
            "properties": {
                "title": {"type": "string", "description": "The note's title.",
                          "minLength": 1, "maxLength": 80},
            },
            "required": ["title"],
        },
        tier=Tier.READ,            # READ runs automatically
        run=_count_words,
    )
]
```

**2. Register it** in `build_default_registry()` in
`src/jarvis/tools/registry.py`: add `wordcount` to the import line and to the
`for module in (...)` list.

**3. Add tests** in `tests/test_wordcount.py` (copy the style of
`tests/test_notes.py`), and add the tool's name to the expected set in
`test_every_builtin_tool_has_description_schema_and_tier`.

Rules the program enforces for every tool:

- **A tool that changes anything** must use `tier=Tier.WRITE` and provide
  `preview=`, a function returning text that shows exactly what will change.
  Jarvis shows it and calls `run` only after you type "yes".
- **Text from files or notes** must be returned as
  `ToolResult(text, untrusted=True, source="where it came from")`.
- **File paths** must go through `ctx.paths.check(path)`.
- Every string input needs a `maxLength`. Unknown inputs are always rejected.
- A tool that needs the internet must set `requires_network=True`. It then
  stays off unless `allow_online_tools = true`, and is labelled
  "BREAKS OFFLINE MODE".
- No shell commands, no deleting. The test suite scans the source for both.

---

## 8. Troubleshooting

| You see | Do this |
|---|---|
| `Jarvis needs Python 3.11 or newer` | Setup step 2 |
| `Ollama is not installed or not running` | Setup step 3 |
| `The model 'qwen3.5:9b' is not downloaded yet` | Setup step 4 (needs internet once) |
| `I can't reach the local model server` | Run `./run.sh` again; it starts the server |
| Replies are very slow | In `config.toml`, try `name = "qwen3:4b"` after `ollama pull qwen3:4b` (2.5 GB) |
| `config.toml has a typo` | Fix the line it names, or delete `config.toml` to start fresh |
| Jarvis picks the wrong tool or asks odd questions | Small local models do this sometimes. Rephrase, or name the note or file exactly |
