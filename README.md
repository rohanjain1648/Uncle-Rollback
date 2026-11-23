# Uncle Rollback 🦃

**A coding agent who is never wrong, only occasionally in the wrong timeline.**

Comment `@uncle fix this` on a GitHub issue. Uncle wakes up on a [Fly.io Sprite](https://fly.io/sprites), tries a fix with Claude Code, and runs the tests. If it fails, he **rewinds his whole garage to a checkpoint** and tries a different approach. When the tests pass he opens a PR with a *Family History* of the timelines that "never happened".

The garage forgets every rewound timeline. Uncle doesn't: his memory lives in **Pinecone**, outside the Sprite, so it survives every restore. Next time you call him, he brings up old disasters ("last time I was in this repo, I deleted your parser").

Built for [Fly.io Hacksgiving 2026](https://fly.io/hacksgiving/).

## How it works

```
GitHub issue comment "@uncle fix this"
        │  webhook (HMAC-signed, owner-only)
        ▼
┌──────── BRAIN Sprite (never restored) ────────┐
│ Hono server :8080 (public URL)                │
│  /webhook  → job queue (one job at a time)    │
│  /, /job/:id → the family album (live)        │
│ SQLite job state · timeline runner            │
│ talks to the world ONLY via Sprites connectors│
│   GitHub · Pinecone · Custom API (Sprites API)│
└───────────────────┬───────────────────────────┘
                    │ Sprites API: exec · fs · checkpoint · restore
                    ▼
┌──────── GARAGE Sprite (restored constantly) ──┐
│ checkpoint "garage-clean": tools + Claude Code│
│ per job:      fetch repo → checkpoint t0      │
│ per timeline: claude -p → hidden tests        │
│               fail → restore t0 · pass → PR   │
└───────────────────────────────────────────────┘
```

**Each job:**
1. Restore the garage to `garage-clean`, download the repo tarball through the GitHub connector, detect the test command, record the baseline, then checkpoint `t0`.
2. Recall memories about this repo from Pinecone and post an in-character acknowledgement.
3. For each timeline, up to 3:
   - Claude Code (headless, on the owner's Claude subscription) attempts a fix, avoiding the approaches of earlier failed timelines.
   - The brain then copies in **hidden acceptance tests** and runs the full suite.
   - Every timeline is written to Pinecone. A failure **restores the garage to `t0`**.
4. On a pass, build the PR through the GitHub Git Data API (no git credentials on either box) with a *Family History* section. Hidden tests are never included.

**Why hidden tests?** Claude can see and run the visible tests, so it rarely fails them. The hidden tests (on the brain, in `acceptance/<owner>__<repo>/issue-<n>/`) check exactly what the issue text describes, the same held-out approach coding benchmarks use. Editing a test file fails the timeline ("tried to change the rules").

## Sprites features used

| Feature | Where |
|---|---|
| **Checkpoints and restore** | Every failed timeline rewinds the garage to `t0` in seconds |
| **Connectors** (credential-injecting gateway) | GitHub (as a bot account), Pinecone, Custom API for the Sprites API. No API keys on either box. |
| **Sleep / wake** | Both Sprites sleep between issues and cost nothing. A webhook wakes the brain. |
| **Services and public URL** | The brain runs as a Sprite service, serving the webhook and the live family album |

Secrets on the boxes: only the webhook HMAC secret (brain) and the Claude Code `setup-token` (garage). See [SPIKE.md](SPIKE.md) for any fallback that changed this.

## Setup

1. Install the Sprites CLI and log in. Create `uncle-brain` and `uncle-garage`.
2. In the Fly dashboard, add connectors with policy *name prefix `uncle-`*: **GitHub** (authorized as a bot account with write access to your repo), **Pinecone**, and **Custom API** (`https://api.sprites.dev`, `Authorization: Bearer <sprites token>`).
3. In Pinecone, create the index `uncle-memories` with integrated embedding `llama-text-embed-v2` (field `text`).
4. Prepare the garage: copy `scripts/garage-setup.sh` into it and run it. Run `claude setup-token` and save the token to `/work/.uncle/claude_token`. Then `sprite checkpoint create --comment garage-clean`.
5. Copy `.env.example` to `.env.brain` and fill it in. Run `OWNER=<your-login> scripts/deploy-brain.sh`.
6. On the brain, run `scripts/spike/brain-checks.ts` to verify everything end to end.
7. Add a GitHub webhook on your repo: `https://<brain-url>/webhook`, JSON, your `WEBHOOK_SECRET`, *Issue comments* only.

## Development

```bash
npm install
npm test          # vitest, 100+ tests; the runner is tested end to end against fake Sprites/GitHub/Pinecone
npm run typecheck
npx tsx scripts/preview-album.ts out/   # render the album with sample data
```

`demo/` is the content of the demo repo (`uncle-demo-pantry`, a Thanksgiving recipe library with two seeded bugs). `demo/ISSUES.md` holds the issue texts.
