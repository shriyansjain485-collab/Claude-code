---
name: repurpose
description: Turn one source (a talk, podcast transcript, blog post, long post, video, meeting notes, newsletter) into a set of posts across platforms for both brands. Use when the owner shares long-form content.
argument-hint: "<file path, URL or pasted text>"
---

# Repurpose one into many

Source: `$ARGUMENTS`.

1. Read the source and both brand profiles.
2. Extract 5–10 atomic ideas: stories, opinions, frameworks, stats (only ones in
   the source), quotable lines. List them with which brand each fits best.
3. Propose a package, e.g.:
   - Personal: 1 LinkedIn story post, 1 X thread, 2 single X posts
   - Company: 1 LinkedIn carousel, 1 Instagram carousel, 1 short-video script
4. After the owner picks, draft each with the `content-creator` agent into
   `content/drafts/`, with different hooks and angles so they don't feel
   duplicated, and add them to free slots in `content/calendar.md`.
5. Leftover ideas go in `content/ideas/backlog.md`.
