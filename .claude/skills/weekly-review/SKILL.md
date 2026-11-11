---
name: weekly-review
description: Weekly performance review for both brands and plan for next week. Use at the end of each week or when the owner shares analytics.
---

# Weekly review

1. Ask the owner for this week's numbers if `reports/data/` has nothing new:
   the simplest option is a screenshot or CSV export of each platform's
   analytics, or per-post impressions/reactions/comments/shares/follows.
   For the clips channel, run `python tools/shorts/shorts.py stats --days 7`
   instead (see `/clip report`); it needs no manual export.
2. Record metrics on each file in `content/published/`.
3. Run the `analytics-reviewer` agent to write `reports/review-YYYY-MM-DD.md`.
4. Summarise for the owner in 5 bullets: what worked, what didn't, follower
   change per brand, top post, the 3 changes for next week.
5. Offer to run `/content-calendar 1` with those changes applied.
6. If the clips channel is active, include its section from the
   `shorts-clipper` weekly report: views, subscribers, revenue (or "not
   monetised yet"), top clips, progress toward the Partner Programme.
