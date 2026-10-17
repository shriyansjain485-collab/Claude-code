---
name: write-post
description: Draft one social post for the personal or company brand on a given platform from an idea, note, voice memo transcript or link. Use when the owner says "write a post about...".
argument-hint: "<personal|company> <platform> <idea>"
---

# Write a post

Input: `$ARGUMENTS`. If brand or platform is missing, ask (default platform:
the brand's top-priority platform from its profile).

1. Read the brand profile and the platform rules below.
2. If the idea is thin, ask up to 3 questions to get a real story, detail or
   number. Specifics make posts work.
3. Delegate drafting to the `content-creator` agent, or write it directly
   following that agent's rules. Save to `content/drafts/`.
4. Show the owner the draft and hook options. Revise until they're happy, then
   offer to move it to `content/approved/` and set `status: approved`.

## Platform rules

| Platform | Limit | What works |
|---|---|---|
| LinkedIn | 3,000 chars; ~210 show before "see more" | Strong 1–2 line hook, short paragraphs, story → lesson → question. Document/PDF carousels. Links in first comment. 0–3 hashtags. |
| X | 280 chars (longer for Premium) | One sharp idea. Threads: hook tweet + 4–8 tweets, each standalone. No hashtags usually. |
| Instagram | Caption 2,200 chars; 5 hashtags max recommended | Visual first: carousel (up to 20 slides) or Reel. Slide 1 = hook. Caption expands; CTA to save/share. |
| Threads | 500 chars | Conversational, opinions, questions. |
| TikTok / Reels / Shorts | Script 30–60s | Hook in first 2s, one point, on-screen text, captions. Write as a script with shot notes. |
| YouTube | Title ≤ 100 chars | Title + thumbnail concept + outline. |
| Facebook | 63,206 chars | Community tone, questions, native video. |

Check current limits if unsure; platforms change them.
