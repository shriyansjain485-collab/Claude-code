# Brand & Socials Agent

An AI social media team, built on Claude Code, that helps you grow **your
personal brand** and **your company's brand** and run your socials.

It strategises, plans a content calendar, writes posts in each brand's voice,
repurposes long-form content, drafts replies to comments/DMs, and reviews
performance weekly. You stay in control: **nothing is published without your
approval.**

## Get started

Open this repo in Claude Code (CLI, desktop, or claude.ai/code) and run:

1. `/brand-setup` — a short interview that fills in `brand/personal.md` and `brand/company.md`
2. `/content-calendar` — plans the next two weeks for both brands
3. Approve or edit the drafts in `content/drafts/`, then post them

Day to day:

| You want to… | Say |
|---|---|
| Write a post | `/write-post personal linkedin <idea>` |
| Turn a talk/blog/podcast into posts | `/repurpose <link or file>` |
| Reply to comments or DMs | `/engage company <paste comments>` |
| See what's working | `/weekly-review` |
| Rethink positioning | "Ask the brand-strategist to..." |

## How it's organised

```
CLAUDE.md               rules every agent follows
brand/                  personal.md and company.md: voice, audience, pillars
.claude/agents/         brand-strategist, content-creator, community-manager, analytics-reviewer
.claude/skills/         the slash-command workflows above
content/calendar.md     the plan
content/ideas → drafts → approved → published
content/engagement/     daily reply drafts and engagement lists
reports/                strategy docs and weekly reviews (drop analytics exports in reports/data/)
```

## Posting and visuals

- **Visuals:** with the Canva connector enabled, the agent creates graphics
  using your brand kit; otherwise it writes a visual brief.
- **Publishing:** the agent prepares approved, ready-to-paste posts. To
  auto-schedule, connect a scheduler (e.g. Buffer, Hootsuite, Later, or the
  platforms' own schedulers) through an MCP connector or Zapier/Make; the
  approval rule in `CLAUDE.md` still applies.
- **Automation:** use `/loop` or a scheduled task to run `/content-calendar` every
  Monday and `/weekly-review` every Friday.
