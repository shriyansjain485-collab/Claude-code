---
name: reel
description: Make Instagram Reels with viral potential for the personal or company brand. Turns an idea, topic or rough note into hook options, a timed script, shot list, on-screen text, caption, cover and posting checklist, or builds a reel growth plan for the account. Use when the owner asks for a reel, Reels ideas, or how to grow on Instagram.
argument-hint: "<personal|company> <idea | 'ideas' | 'plan'>"
---

# Instagram Reels

Input: `$ARGUMENTS`. If the brand is missing, ask which one. Then pick a mode:

- **An idea or topic** → one finished reel package.
- **`ideas`** → 10 reel ideas with hooks, formats and share or save triggers,
  saved to `content/ideas/YYYY-MM-DD_<brand>_reel-ideas.md`. The owner picks
  which ones to script.
- **`plan`** → a 30-day reel growth plan (series, cadence, hook bank, tests,
  metrics), saved to `content/ideas/YYYY-MM-DD_<brand>_reels-growth-plan.md`.

## Steps

1. Read the brand profile. If it is still mostly `TODO`, run `/brand-setup`
   first. Reels about a person or company nobody has described will be generic,
   and generic reels don't spread.
2. Check `content/calendar.md` and `content/published/` so nothing repeats.
3. If the idea is thin, ask up to 3 questions: the real story, moment or number;
   what the viewer should feel or do; and whether the owner will be on camera,
   do a voiceover, or neither.
4. Delegate to the `reels-producer` agent (or follow its rules directly) to
   write the package into `content/drafts/`.
5. If the Canva connector is available, create the cover (and text overlays if
   wanted) with the brand kit and put the link in `visual:`. Otherwise write a
   cover brief.
6. Show the owner the hook options and the script. Revise until they're happy,
   then offer to move it to `content/approved/` with `status: approved`.
   Never post on their behalf.

## After posting

Ask the owner for the reel's numbers after 48 hours (views, 3-second hold,
average watch time, shares, saves, follows). Log them in `content/published/`
and feed them into `/weekly-review`. Repeat what's working and drop what isn't.
