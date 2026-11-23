# Uncle Rollback: Design

*Hacksgiving 2026 (Fly.io), working title. Written 2026-11-24.*

## 1. Intent and why

We are entering Fly.io's Hacksgiving hackathon (Nov 23–29, 2026). We want a real shot at the **Grand Prize ($2,500)** and the **Weird Uncle Award ($1,000, "strangest agent")** with the same project.

**Uncle Rollback** is an overconfident, slightly unhinged coding agent who lives on Fly.io Sprites. You point him at a GitHub issue. He tries fixes recklessly. When one fails he rewinds his garage to a checkpoint and tries again. When the tests pass he opens a PR that includes a "family history" of the failed timelines.

**The core gimmick, which is also the core technical demo.** A Sprite checkpoint restore rewinds the disk, but Uncle's memory lives in **Pinecone**, outside the Sprite. So he remembers the timelines that "never happened" and brings them up later. ("In timeline 3 I deleted your database. Don't worry, it never happened. I remember, though.")

This one bit shows off three things judges care about:
- Sprite checkpoint and restore (Fly).
- Connectors, with no secrets on the box (Fly).
- Pinecone memory (a partner judge).

It also gives the agent a real job: the memory of failed timelines makes each new attempt avoid approaches that already failed.

## 2. Hackathon constraints (hard)

- **Runs on a Sprite.** Both components run on Sprites.
- **Uses at least one Sprites connector.** We use GitHub, Pinecone, and Custom API (for the Sprites API). Ollama Cloud is an optional fourth.
- **Built during Hacksgiving week.**
- **Submit by midnight PST, Sun Nov 29**, which is **13:30 IST, Mon Nov 30**. Use the Google Form at https://docs.google.com/forms/d/e/1FAIpQLSfZ_xearoDOSRXI3VjAbM4BJlObUdxSFO0SDwyZ8G6M2lapRQ/viewform and submit a code link, a demo link, and 1–2 sentences.
- **Post** the demo on X, Bluesky, LinkedIn, or Reddit and tag **@flydotio**. A video demo is strongly preferred.
- **Budget.** Fly Free plan ($5/month of usage). **Treat it as a hard cap.** Sprites bill only while running, so the brain must sleep between webhooks, and nothing may keep a Sprite awake on purpose. Check usage in the dashboard each day.
- **Model.** The user's **Claude Pro subscription**, through Claude Code (preinstalled on every Sprite). Pro usage limits are shared with the user's own development work, so keep attempts short and plan rehearsals around the limits.
- **Who can trigger.** Only the owner (the user's GitHub login, allowlisted), and only on the demo repo or repos the owner configures. Ignore comments from anyone else, and ignore the bot's own comments, which will contain "@uncle".
- **GitHub identity.** A **dedicated bot account** (for example `uncle-rollback`). The GitHub connector is authorized as that account, and it is a collaborator on the demo repo.
- **Judges.** TypeSafe AI, Box, Fly.io, Pinecone, Ollama. No rubric is published.

## 3. Goals, non-goals, anti-goals

**Goals**
1. End-to-end loop: an issue comment (`@uncle fix this`) leads to a PR with passing tests and an in-character description.
2. Real checkpoint/restore between attempts. The demo must visibly show a rewind.
3. Persistent memory in Pinecone that survives rewinds. It is used in two ways: (a) within a job, failed timelines feed the next attempt; (b) across jobs, Uncle references past disasters on the same repo.
4. A public "family album" web page that shows each job's timeline tree, live.
5. A 2–3 minute demo video plus a social post plus the submission.

**Non-goals**
- A chat UI.
- Multi-user support or auth.
- Support for arbitrary languages or test frameworks. Supporting the demo repo, plus a reasonable `npm test` / `pytest` auto-detect, is enough.
- Parallel timelines. That is a stretch goal only (see §9).

**Anti-goals (failure even if the code technically works)**
- It reads as a chatbot on a VM, with no visible use of Sprite-specific features.
- API secrets are scattered on the boxes when connectors could hold them.
- The demo depends on a live run going right. Record the video and keep a backup run.
- The persona is so heavy it hides that the agent does real work. The PR and code must stand on their own.
- Spending past the free plan.

## 4. Approaches considered

| # | Approach | Trade-off | Verdict |
|---|---|---|---|
| 1 | **One Sprite does everything.** The controller is a service on the same Sprite it restores and persists state externally. | Least setup, but it depends on restoring a Sprite from inside itself. A restore may kill or rewind the controller mid-job, and recovery is fragile. | Rejected |
| 2 | **Brain and garage (two Sprites).** The brain never rewinds and drives the garage through the Sprites API. | A bit more wiring. Robust, and it maps onto the story (uncle and his garage). | **Chosen by the user** |
| 3 | **Brain plus a fresh Sprite per timeline** (parallel "multiverse"). | The most impressive version, but each new Sprite needs a Claude login, and Sprite creation is rate-limited. | Stretch goal only |

Other choices the user made in conversation: the job is **coding handyman** (not life admin or a debate bot), the persona is a **mix of "time-travel agent" and "weird uncle"**, and the model is the **Claude subscription**.

## 5. Architecture

```
GitHub issue comment "@uncle fix this"
        │  (webhook, HMAC-signed)
        ▼
┌──────────────── BRAIN Sprite (never restored) ────────────────┐
│ Node/TS service on :8080 (Sprite service, public URL)          │
│  • POST /webhook   → verify signature, enqueue job             │
│  • GET  /          → family album (jobs list)                  │
│  • GET  /job/:id   → timeline tree, live (polling or SSE)      │
│  • job runner loop (one job at a time)                         │
│  • local job state: SQLite on brain disk                       │
│  Calls out ONLY via Sprites connector gateway:                 │
│   - GitHub connector   (issues, comments, git data API, PRs)   │
│   - Pinecone connector (memories: upsert + search)             │
│   - Custom API connector → api.sprites.dev (drive the garage)  │
│   - (optional) Ollama Cloud connector (persona narration)      │
└──────────────────────────────┬─────────────────────────────────┘
                               │ Sprites API: exec, fs, checkpoint, restore
                               ▼
┌──────────────── GARAGE Sprite (restored constantly) ───────────┐
│ base checkpoint "garage-clean": toolchains + Claude Code login │
│ per job:  /work/<repo>  (fetched from GitHub)                  │
│ per attempt: claude -p ... ; run tests ; report diff           │
└────────────────────────────────────────────────────────────────┘
```

### 5.1 Job lifecycle (one issue = one job)

1. **Trigger.** A GitHub webhook (`issue_comment`, body contains `@uncle`) hits the brain at `/webhook`. The brain verifies the HMAC signature. It drops the event unless the comment author is in `OWNER_ALLOWLIST` and the repo is in `REPO_ALLOWLIST`, and it always drops comments from the bot account. It then records the job and reacts or comments on the issue in character ("On it. What could go wrong.").
2. **Prepare the garage.** Restore the garage to `garage-clean`. Fetch the repo at the default branch into `/work/<repo>`; method in §5.3. Detect the test command (§5.4). Run the visible tests once to record the baseline. Create the job checkpoint **`t0`**. The hidden acceptance tests (§5.8) are **not** in `t0`.
3. **Recall.** The brain queries Pinecone for memories about this repo and similar issues (top-k). These become "family lore" in the prompt.
4. **Attempt loop.** For timeline `n` = 1 to `MAX_TIMELINES` (default 3, sized for Claude Pro):
   - a. Build the prompt: the issue title and body, the visible test command, the repo lore, and **summaries of failed timelines 1..n-1 in this job**. Ask for an approach different from the failed ones. Claude may run the visible tests.
   - b. Run Claude Code headless in the garage, inside `/work/<repo>`, with a time limit (default 5 min). Ask it to return JSON with an approach summary and an in-character quote (§5.6).
   - c. **Judge the attempt.** If any test file differs from `t0`, the attempt fails ("Uncle tried to change the rules"). Otherwise the brain copies the hidden acceptance tests into the garage, runs the full suite (visible plus hidden), and captures pass/fail, the tail of the output, and `git diff`, excluding the hidden tests.
   - d. Write a **memory** to Pinecone: repo, issue, timeline n, approach summary, outcome, the reason it failed, and a one-line Uncle quote.
   - e. **If the tests pass,** go to step 5.
   - f. **If they fail,** restore the garage to `t0` (the visible rewind), mark the timeline as `rewound` in the album, and continue.
5. **Ship.** Take the winning diff from the garage. Create a branch, commit, and PR through the GitHub connector (§5.3). The PR body is an in-character summary: what was fixed, the tests that pass, and a "Family History" section listing each rewound timeline. Comment on the issue with a link to the PR and to the album page.
6. **Give up.** If all timelines fail, Uncle comments with his best excuse and a summary of what he learned. Those memories are still saved.
7. **Idle.** Both Sprites go back to sleep with no charges, which is a talking point in the demo.

### 5.2 Brain

- **Runtime:** Node.js and TypeScript, using the `@fly/sprites` SDK if it works through the gateway. Otherwise use plain `fetch` to the gateway URL. Run it as a Sprite service (`sprite-env services create ... --http-port 8080`). The URL must be public so GitHub can reach `/webhook`.
- **State:** SQLite on the brain's own disk, holding jobs, timelines, status, and timestamps. The brain is never restored, so local state is safe.
- **Job model:** one job at a time, using a simple in-process queue. A job that is in progress when the brain restarts is marked `interrupted` on boot. Resuming it is not required.
- **Secrets on the brain:** only the GitHub webhook HMAC secret. That is not a credential to any service. Everything else goes through connectors.

### 5.3 GitHub access (no git credentials on either box)

- Both Sprites can call the connector gateway. A Sprite authenticates by request signature.
- **Fetch the repo:** the garage downloads the tarball through the GitHub connector (`GET /repos/{o}/{r}/tarball/{ref}`) and runs `git init` locally, so `git diff` works.
- **Ship the PR:** the brain reads the changed files from the garage (the Sprites filesystem API or `exec git diff --name-only`). It then uses the GitHub Git Data API through the connector: create blobs, then a tree, then a commit, then the ref `uncle/issue-<n>`, then open the PR.
- If the gateway can't do one of these calls (see §8), the fallback is a fine-grained PAT stored in the garage's base checkpoint. That is a documented compromise.

### 5.4 Garage

- **Base image:** Node and Python (likely preinstalled), git, and Claude Code (preinstalled).
- **Claude auth:** use `claude setup-token`, which gives a long-lived subscription token, and store it in the garage before taking the `garage-clean` checkpoint. A long-lived token matters here: a normal OAuth login rotates its refresh tokens, and a disk rewind could restore a stale refresh token and break auth. Verify this in the spike.
- **Claude invocation:** `claude -p "<prompt>" --output-format json --dangerously-skip-permissions`, run inside `/work/<repo>` with a time limit. Isolation is the point of the garage, so skipping permissions is acceptable there.
- **Test detection:** an `.uncle.yml` file at the repo root (`test: <cmd>`) takes precedence. Otherwise use `package.json` scripts.test (`npm test`), then pytest if `pyproject.toml`, `setup.cfg`, or a `tests/` folder exists. Otherwise fail with an in-character complaint.

### 5.5 Pinecone memory

- One index with **integrated embedding** (Pinecone hosted embedding model), so we upsert and search by text and need no separate embedding provider.
- **Record fields** (flat, a consistent schema): `id`, `text` (the embedded field: approach summary plus outcome plus quote), `repo`, `issue`, `job_id`, `timeline`, `outcome` (`passed|failed|gave_up`), `created_at`.
- **Within-job recall:** fetch by `job_id`. These are also in SQLite, but Pinecone is the canonical "memory survives the rewind" source, and the demo should show that.
- **Cross-job recall:** semantic search on the issue text, filtered by `repo`, top 5.

### 5.6 Persona and narration

- **Uncle's voice:** a confident, rambling, self-mythologizing relative who is never wrong, only in the wrong timeline. He is funny but never mean to the user.
- Narration is used in: issue comments, the PR body, timeline captions on the album, and the "give up" excuse.
- **Default:** Claude writes the narration as part of each attempt's JSON output (`approach`, `quote`). Issue comments and PR prose are composed from those pieces plus templates, so narration costs no extra Claude calls.
- **Optional:** if the day-1 spike shows an Ollama Cloud account and connector work easily, the brain uses a small Ollama model for issue comments, the PR body, and the give-up excuse. That adds a fourth connector and a partner judge. Otherwise it stays a stretch goal.

### 5.8 Hidden acceptance tests (how real rewinds happen)

Claude can see and run the visible tests, so it would usually keep going inside one attempt until they pass. The demo would then never show a rewind. The fix is held-out tests, the same approach coding benchmarks use:
- Each repo in `REPO_ALLOWLIST` has a hidden test file or folder stored **on the brain** (for example `brain/acceptance/<repo>/`), never in the repo.
- The brain copies the hidden tests into the garage **after** Claude exits and **before** the judge run (§5.1 step 4c). The next restore to `t0` removes them again.
- Hidden tests are never committed or included in the PR diff.
- This is not faking. The failures are real, and the issue text honestly describes the behavior the hidden tests check. Claude just can't overfit to them.
- For non-demo repos without hidden tests, the visible suite is the only judge, and a first-try pass is fine.

### 5.7 Family album (the brain's web UI)

- `/` lists jobs: repo, issue, status, the number of timelines, and a PR link.
- `/job/:id` shows a vertical timeline tree. Example:
  `t0 (baseline: 3 tests failing) → t1 ✗ rewound → t2 ✗ rewound → t3 ✓ PR #12`
  Each node shows: the approach summary, tests passed/failed, the Uncle quote, the duration, and a collapsible diff and test output.
- The page updates live while a job runs, through polling or SSE.
- It must look good on video. It will be built with the frontend design skill, using a warm "family photo album / Thanksgiving" look. Visual details are left to the builder.

## 6. Demo plan (what the video shows)

1. Introduce Uncle and the album page, about 15 s.
2. In the prepared **demo repo**, open an issue whose bug is tricky enough that the first attempt plausibly fails, and comment `@uncle fix this`.
3. Show the Sprite waking, the album filling in live, a timeline failing, the **rewind**, and the retry.
4. Show the PR with the Family History section and the green tests.
5. **Second issue on the same repo:** Uncle references the earlier disaster from Pinecone memory. This proves memory survives rewinds and jobs.
6. Close on: two Sprites, three connectors, zero API keys on the box, and costs nothing while asleep.

The demo repo is ours, a small TypeScript or Python project with seeded bugs and hidden acceptance tests (§5.8), written so a first attempt plausibly misses an edge case the issue describes. Record several runs and use the best one. Faking a run is not allowed. Plan recordings around Claude Pro limits: at most about 2–3 full rehearsals per usage window, and don't develop with Claude on the same account right before recording.

## 7. Schedule (IST)

| Day | Date | Work |
|---|---|---|
| 1 | Tue Nov 24 | Account and Sprites CLI on Windows. Create both Sprites. Configure connectors and policies. **Spike** (§8). |
| 2 | Wed Nov 25 | Garage loop end to end, driven manually from a script: fetch → t0 → claude → test → restore. |
| 3 | Thu Nov 26 | Brain service: webhook, job runner, GitHub PR shipping, Pinecone memory. |
| 4 | Fri Nov 27 | Family album UI, persona narration, demo repo. |
| 5 | Sat Nov 28 | Hardening, README, record the demo. |
| 6 | Sun Nov 29 | Edit the video, post, submit. **Hard stop: submit by Mon Nov 30 at 12:00 IST**, which leaves a 90-minute buffer. |

## 8. Day-1 spike: things to verify before building

Each item lists what to do if it fails.

1. **Restore through the API from another Sprite.** Does the brain's call to restore the garage work, how long does it take, and what happens to processes running in the garage? *If it fails:* drive checkpoints with `sprite-env` inside the garage through exec.
2. **Custom API connector for `api.sprites.dev`.** Can the brain reach the Sprites API through the gateway? *If it fails:* put the Sprites token in a brain env var. This is a compromise; note it in the README.
3. **GitHub connector coverage.** Do the tarball download and the Git Data API (blobs, trees, commits, refs, pulls) work through the gateway, including from the garage? *If it fails:* use a fine-grained PAT in the garage.
4. **Claude long-lived token survives restore.** Run `claude -p` after a checkpoint, a restore, and another restore. *If it fails:* inject `CLAUDE_CODE_OAUTH_TOKEN` per exec from the brain.
5. **Pinecone through the gateway.** Upsert and search on an integrated-embedding index. *If it fails:* this is fatal for the gimmick, so investigate first. The fallback is a Pinecone key on the brain.
6. **Public URL plus webhook.** GitHub can reach the brain, and a sleeping brain wakes on the webhook within GitHub's 10 s timeout. The brain should respond 202 right away and run the job asynchronously. Check that a running job keeps the brain awake (an open exec session to the garage should count; otherwise use the Tasks API).
7. **(Optional) Ollama Cloud connector.** Is an account easy to get, and does a chat call through the gateway work? This decides §5.6.
8. **Cost check.** After one full job, read usage in the Fly dashboard and project it across the week, so we stay under $5.

## 9. Stretch goals (only after §6 is fully working)

- **Multiverse mode:** run 2–3 timelines in parallel garages (approach 3).
- **Voice notes:** Uncle reads his PR summary aloud through the ElevenLabs connector, with audio on the album.
- **Box:** a "family archive" that exports each job's album to a Box folder, adding another partner connector.
- **`@uncle remember`:** ask Uncle what he remembers about a repo. Answers come from Pinecone.

## 10. Left to the builder

- Code structure, libraries (web framework, SQLite driver), and the prompt wording.
- Album visual design, within the warm family-album direction.
- Exact Pinecone index name and embedding model; any hosted model that supports integrated embedding.
- Polling or SSE for live updates.
- Demo repo contents and the seeded bugs.
- Defaults: `MAX_TIMELINES` (3), the attempt timeout (5 min), recall top-k (5). Pinning a smaller Claude model with `--model` is fine if Pro limits bite.

## 11. Calls made by Claude (not decided by the user)

These were filled in during design. The user should check them.
- Hidden acceptance tests on the brain, and "editing test files = failure" (§5.8).
- Claude writes the narration by default, with Ollama optional (§5.6).
- Node/TypeScript, SQLite for brain state, one job at a time, interrupted jobs are not resumed.
- Repo fetched by tarball plus Git Data API for PRs, so no git credentials are on the boxes. The fallback is a fine-grained PAT.
- `claude setup-token` long-lived token in the garage's base checkpoint.
- A free-plan budget is treated as a hard $5 cap.
- The name "Uncle Rollback" is a working title.
