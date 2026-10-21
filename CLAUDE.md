# Brand & Socials Agent

This repo is an AI social media team for two brands:

1. **Personal brand** — the founder. Profile: `brand/personal.md`
2. **Company brand** — the business. Profile: `brand/company.md`

Every piece of content belongs to exactly one of these. Never blur them: the
personal voice is first-person, opinionated, and story-driven; the company voice
follows `brand/company.md`. When the two cross-promote, say so explicitly
(e.g. "personal post that mentions the company launch").

## Before doing any work

1. Read `brand/personal.md` and/or `brand/company.md` for the brand in question.
2. If a profile still contains `TODO` placeholders, run the `/brand-setup`
   interview first. Do not invent facts about the person or company.
3. Check `content/calendar.md` for what's planned and `content/published/` for
   what has already gone out, so nothing repeats.

## Content pipeline

```
content/ideas/      raw ideas, one file per idea or a running list
content/drafts/     written posts awaiting review
content/approved/   approved by the human, ready to post
content/published/  posted; include date, link and metrics when known
```

Draft files are named `YYYY-MM-DD_<brand>_<platform>_<slug>.md` where brand is
`personal` or `company`, and start with this front matter:

```yaml
---
brand: personal | company
platform: linkedin | x | instagram | threads | tiktok | youtube | facebook
pillar: <content pillar from the profile>
goal: awareness | trust | engagement | leads | hiring
scheduled_for: YYYY-MM-DD HH:MM (timezone)
status: draft | approved | published
visual: none | <description or Canva link>
---
```

## Hard rules

- **A human approves everything before it is published.** You draft; the owner
  moves files to `approved/` (or tells you to). Never post, reply, or DM on
  their behalf without explicit approval for that specific item.
- No fabricated stats, client names, testimonials, quotes, or results. If a
  post needs a number, leave `[NUMBER?]` and ask.
- No engagement bait ("comment YES"), fake urgency, or controversy for its own sake.
- Respect each platform's limits (see `.claude/skills/write-post/SKILL.md`).
- Sensitive topics (legal, layoffs, funding, crises, politics, competitors by
  name) → flag for the human; don't draft a final version.

## Team (subagents in `.claude/agents/`)

| Agent | Use it for |
|---|---|
| `brand-strategist` | Positioning, pillars, audience, voice, quarterly strategy |
| `content-creator` | Writing posts, threads, carousels, scripts, captions |
| `community-manager` | Replies to comments/DMs, engagement plan, outreach |
| `analytics-reviewer` | Reading metrics, weekly/monthly reports, what to do more/less of |
| `reels-producer` | Instagram Reels: viral hooks, timed scripts, shot lists, covers, reel growth plans |

## Workflows (slash commands in `.claude/skills/`)

| Command | What it does |
|---|---|
| `/brand-setup` | Interview to fill in the brand profiles |
| `/content-calendar` | Plan the next 1–4 weeks of posts for both brands |
| `/write-post` | Draft a post for a given brand + platform + idea |
| `/reel` | Make an Instagram Reel, a batch of reel ideas, or a 30-day reel growth plan |
| `/repurpose` | Turn one piece (talk, blog, post, podcast) into many |
| `/engage` | Draft replies to comments/DMs and a daily engagement list |
| `/weekly-review` | Summarise performance and set next week's focus |

## Visuals

If the Canva connector is available, use it to create visuals with the brand kit
named in the profile; put the design link in the draft's `visual:` field. If
not, write a clear visual brief instead.
