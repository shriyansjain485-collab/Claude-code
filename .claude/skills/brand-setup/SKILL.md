---
name: brand-setup
description: Interview the owner to fill in brand/personal.md and brand/company.md. Use on first run, when profiles contain TODOs, or when the owner says their positioning has changed.
argument-hint: "[personal|company|both]"
---

# Brand setup interview

Goal: replace every `TODO` in the chosen profile(s) with facts from the owner.
Argument: `$ARGUMENTS` (default `both`, personal first).

1. Read the profile(s). List the sections still marked TODO.
2. Ask questions **in small batches of 3–5**, one section at a time, in plain
   language. Offer examples so answering is easy. Use the AskUserQuestion tool
   for multiple-choice items (platforms, cadence, tone).
3. If the owner shares links (website, LinkedIn, existing posts), read them
   and propose answers for them to confirm instead of asking from scratch.
4. After each batch, write the confirmed answers into the profile.
5. Ask for 2–3 past posts or writing samples in each voice; paste them into
   "Sample posts". These matter more than adjectives.
6. Finish with a summary: positioning in one line per brand, pillars, platforms
   and cadence. Suggest running `/content-calendar` next.

Never fill a field with a guess. If the owner doesn't know yet, write
`TBD — <what we need to decide>` and move on.
