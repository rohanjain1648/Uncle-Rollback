# Demo script and submission copy

Target length: **2:15–2:45**. Record at 1080p. Use a browser zoom of 125% so the album and GitHub text read on a phone.

## Before recording

- [ ] Fresh `uncle-demo-pantry` repo with the seeded code. Issues #1 and #2 open (text in `demo/ISSUES.md`). No open PRs, no `uncle/*` branches.
- [ ] Pinecone has **no** memories for the demo repo. Delete the namespace `memories` records for it, so the issue #2 callback is earned on camera.
- [ ] Brain and garage are asleep (no activity for a few minutes), so the wake-up is real.
- [ ] Tabs: (1) issue #1, (2) the brain's album URL, (3) the Fly dashboard Sprites page, (4) issue #2.
- [ ] A Claude Pro usage window with room for 2 full jobs.
- [ ] Have a backup: keep the best earlier full run's album page and PR open in case of a live hiccup. Every shot must be a real run.

## Shot list

| # | Time | On screen | Voiceover |
|---|---|---|---|
| 1 | 0:00–0:12 | Album home page, then the title | "This is Uncle Rollback. He fixes your code. He's never wrong. He's just occasionally in the wrong timeline." |
| 2 | 0:12–0:25 | Issue #1 (mixed and unicode fractions). Type `@uncle fix this`, then submit. | "I've got a real bug: my recipe parser chokes on fractions like two and three quarters, and on unicode halves. I'll ask Uncle." |
| 3 | 0:25–0:40 | Fly dashboard: both Sprites go from asleep to running. Uncle's 👀 reaction and his "On it, nephew" comment appear. | "He lives on two Fly Sprites. The brain takes the webhook; the garage is where he works. Both were asleep, costing nothing, until now." |
| 4 | 0:40–1:15 | The album job page, live: Timeline 0 (baseline), then Timeline 1 developing, then the red **never happened** scrawl. | "Timeline one: Claude Code tries a fix. The hidden acceptance tests say no. So Uncle restores the whole garage to a checkpoint, in seconds. That timeline never happened. To the garage." |
| 5 | 1:15–1:40 | Timeline 2 or 3 gets the gold star. | "But Uncle remembers. Every timeline goes to Pinecone, outside the Sprite, so it survives the rewind. The next attempt knows exactly what not to do." |
| 6 | 1:40–2:00 | The PR: the *Family History* section listing the rewound timelines. The green checks. | "He opens a PR as his own bot account. Real fix, tests green, with a family history of everything he'd rather you didn't know." |
| 7 | 2:00–2:25 | Issue #2: `@uncle fix this`. His first comment: "last time I was in this repo…" | "Second issue, same repo. The garage has no memory of last time. Uncle does." |
| 8 | 2:25–2:40 | Closing card (text below) | "Two Sprites. Three connectors. Zero API keys on the box. Free while he sleeps." |

**Closing card text:**
> Uncle Rollback
> 2 Sprites · checkpoints as undo · GitHub + Pinecone + Sprites API connectors · no API keys on the box
> github.com/&lt;you&gt;/uncle-rollback

*(The middle dots on the card are fine: it's a video title card, not page chrome.)*

## Social posts

**X / Bluesky** (≤ 280 chars):
> Meet Uncle Rollback 🦃 a coding agent on @flydotio Sprites who's never wrong, only in the wrong timeline.
> Each failed fix gets rewound with a Sprite checkpoint. His memory lives in Pinecone, so he remembers the timelines that never happened.
> #Hacksgiving [video]

**LinkedIn / Reddit:**
> For Fly.io's Hacksgiving I built Uncle Rollback: comment "@uncle fix this" on a GitHub issue and a coding agent wakes up on a Fly Sprite, tries a fix with Claude Code, and checks it against hidden acceptance tests.
>
> When an attempt fails, he restores his entire "garage" Sprite to a checkpoint in seconds and tries a different approach. Every attempt is written to Pinecone, outside the Sprite, so the rewound timelines are gone from the disk but not from his memory. He uses them to avoid repeating mistakes, and he brings them up in the PR's "Family History".
>
> Under the hood: two Sprites (a brain that never rewinds, and a garage that rewinds constantly), Sprites connectors for GitHub, Pinecone and the Sprites API so there are no API keys on either box, and both Sprites sleep for free between issues.
> Code: [link] · Demo: [link] · @flydotio

## Submission form (one or two sentences)

> Uncle Rollback is a coding agent on two Fly Sprites: give him a GitHub issue and he attempts fixes with Claude Code, rewinding his garage Sprite to a checkpoint after every failed attempt. His memory of each rewound timeline lives in Pinecone via Sprites connectors, so he learns from attempts that "never happened" and lists them in the PR's Family History.
