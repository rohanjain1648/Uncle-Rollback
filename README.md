# Uncle Rollback 🦃

**A coding agent who is never wrong, only occasionally in the wrong timeline.**

Comment `@uncle fix this` on a GitHub issue. Uncle wakes up on a [Fly.io Sprite](https://fly.io/sprites), tries a fix with Claude Code, and checks it against the tests. If the attempt fails, he **rewinds his entire workshop to a checkpoint** and tries a different approach. When the tests pass, he opens a pull request with a *Family History* of every timeline that "never happened".

The workshop forgets every rewound timeline. Uncle doesn't. His memory lives in **Pinecone**, outside the Sprite, so it survives every restore. He uses it to avoid repeating failed approaches, and he brings it up the next time you call him:

> On it, nephew. Issue #2? I've fixed worse with a butter knife.
>
> Now, last time I was in this repo (issue #1), and I want to be clear this timeline never officially happened, I rewrote the parser as one giant regex. Rewound because: tests failed.
>
> I remember everything. Nobody else does. That's the burden.

Built for [Fly.io Hacksgiving 2026](https://fly.io/hacksgiving/).

---

## Contents

- [Why this exists](#why-this-exists)
- [What you see](#what-you-see)
- [How it works](#how-it-works)
- [A job, step by step](#a-job-step-by-step)
- [Hidden acceptance tests](#hidden-acceptance-tests)
- [Memory](#memory)
- [Sprites features used](#sprites-features-used)
- [Security model](#security-model)
- [Project structure](#project-structure)
- [Configuration](#configuration)
- [Setup](#setup)
- [Development](#development)
- [Cost](#cost)
- [Limitations and known assumptions](#limitations-and-known-assumptions)
- [Roadmap](#roadmap)

---

## Why this exists

Most coding agents have one shot at your working directory. If they make a mess, you clean it up. A Sprite changes that. It is a full Linux computer that can **snapshot its whole disk in about a second and restore it just as fast**. That turns "undo" from a careful, file-by-file operation into one API call.

Uncle Rollback is built around that idea:

- **Checkpoints are the undo button.** Uncle can be reckless, because every failed attempt is erased in seconds.
- **Memory outside the box survives the undo.** The disk rewinds; Pinecone doesn't. So Uncle learns from attempts that no longer exist anywhere on disk.
- **Connectors keep the box clean.** GitHub, Pinecone and the Sprites API are reached through the Sprites connector gateway, which attaches credentials on the way out. Neither Sprite stores those API keys.

And he's a weird uncle about it, because a coding agent might as well have a personality.

## What you see

**On GitHub**

1. You comment `@uncle fix this` on an issue.
2. Uncle reacts 👀 and posts an in-character acknowledgement, recalling past disasters in this repo if there are any.
3. He opens a PR from `uncle/issue-<n>`, posting as a dedicated bot account. The PR says what he changed and lists every rewound timeline under **Family History**.
4. He comments on the issue with the PR link and reacts 🚀. If he gives up, he lists everything he tried (and reacts 😕).

**The family album** (the brain's public URL)

- `/` lists every job and its status.
- `/job/<id>` is a live page with one polaroid per timeline:
  - **Timeline 0** shows the test results before Uncle touched anything.
  - **Rewound timelines** are faded and crossed out in red marker: *never happened*.
  - **The winning timeline** gets a gold star.
  - Each photo shows the attempt's diff, Uncle's one-line quote, what he tried, why it failed, and the time it took. The full diff and test output can be expanded.
- The page refreshes itself every 3 seconds while a job is running.

## How it works

Two Sprites, with different jobs:

```
GitHub issue comment "@uncle fix this"
        │  webhook (HMAC-signed; owner + repo allowlist)
        ▼
┌──────────────── BRAIN Sprite (never restored) ─────────────────┐
│ Node/TypeScript Hono service on :8080, public URL              │
│   POST /webhook   verify signature → parse → enqueue           │
│   GET  /          family album: list of jobs                   │
│   GET  /job/:id   family album: timelines, live                │
│   GET  /api/job/:id   job + timelines as JSON                  │
│ SQLite job state · one job at a time · timeline runner         │
│ Outbound calls ONLY through the Sprites connector gateway:     │
│   GitHub (bot account) · Pinecone · Custom API → Sprites API   │
│   (optional) Ollama Cloud for narration                        │
└──────────────────────────────┬─────────────────────────────────┘
                               │ Sprites API: exec · fs/write · checkpoint · restore
                               ▼
┌──────────────── GARAGE Sprite (restored constantly) ───────────┐
│ checkpoint "garage-clean": tools + Claude Code + login token   │
│ /work/repo           the repo under repair                     │
│ /work/prompt.txt     this timeline's instructions              │
│ /work/.uncle/run-claude.sh   headless Claude Code wrapper      │
│ checkpoint "t0-<job>": repo downloaded, baseline recorded      │
└────────────────────────────────────────────────────────────────┘
```

**Why two Sprites?** A restore rewinds the *entire* disk and terminates running processes. If the controller lived in the same Sprite it rewinds, it would erase its own notes and kill itself mid-job. So the **brain** never rewinds and holds all the state, and the **garage** is the disposable workshop the brain restores at will.

## A job, step by step

1. **Trigger.** GitHub sends an `issue_comment` webhook. The brain verifies the `X-Hub-Signature-256` HMAC and then checks that:
   - the comment is newly created (not edited) and mentions `@uncle`;
   - both the comment's author and the issue's author are in `OWNER_ALLOWLIST`, and neither is the bot itself (the issue text becomes Claude's instructions, so whoever wrote it must be trusted);
   - the repo is in `REPO_ALLOWLIST`;
   - the issue is not a pull request.

   Anything else gets a `204` and is ignored. A valid trigger gets a `202` right away; the job runs in the background.
2. **Queue.** Jobs are deduplicated by comment id, so GitHub redeliveries never start a second job. A second `@uncle` on an issue that already has a job gets an "I'm already elbow-deep in this one" reply. Jobs run strictly one at a time, because there is one garage.
3. **Prepare the garage.**
   - Restore to `garage-clean`.
   - Download the repo tarball through the GitHub connector and `git init` it, so diffs work.
   - Detect the test command (see below) and install dependencies (`npm ci`, or `pip install -r requirements.txt`). Dependency and cache folders such as `node_modules/` are excluded from git, so they never show up as changes.
   - Commit and tag the result as `uncle-base`; changes are always measured against this tag, even if Claude makes commits of its own.
   - Run the tests once to record the **baseline**.
   - Take checkpoint **`t0-<job>`**.
4. **Recall.** Search Pinecone for memories about this repo that are similar to the issue. Post the acknowledgement comment.
5. **Timelines.** For each timeline `n` from 1 to `MAX_TIMELINES` (default 3):
   1. Write `/work/prompt.txt`. It contains the issue, the test command, the repo's "family lore", the persona, and a summary of every failed timeline so far, with the instruction to try a *different* approach.
   2. Start Claude Code headless (`claude -p … --output-format json`) inside the garage as a detached process, with a time limit (default 5 minutes). It writes its exit code to a file when it finishes; the brain polls for that file every few seconds, so no HTTP request has to stay open for minutes. A run that overstays is killed.
   3. Record the diff and the list of changed files.
   4. **Judge the attempt.** It fails, with a recorded reason, if:
      - Claude ran out of time;
      - Claude exited non-zero;
      - Claude's output did not end with the required `{"approach", "quote"}` JSON;
      - it edited a test file ("tried to change the rules");
      - it changed nothing.
   5. **Hidden tests.** Otherwise, copy the hidden acceptance tests into the garage and run the full suite. A failing suite fails the timeline.
   6. **Remember.** Write the timeline to Pinecone, pass or fail.
   7. **Pass:** build the PR from the changed files, excluding the hidden tests, and stop.
   8. **Fail:** **restore the garage to `t0`** and continue with the next timeline.
6. **Give up** after the last timeline. Uncle posts everything he tried, so a human doesn't repeat it.
7. **Sleep.** Both Sprites go idle and stop billing until the next webhook.

**Test command detection**, in order:
1. A `test:` line in `.uncle.yml` at the repo root.
2. `npm test`, if `package.json` has a real `scripts.test` (npm's placeholder "no test specified" script doesn't count).
3. `python3 -m pytest -q`, if there is a `pyproject.toml`, a `setup.cfg` or a `tests/` folder.
4. Otherwise Uncle posts a "No tests. Not one." comment, and the job ends as `no_tests`.

**Job statuses**

| Status | Album label | Meaning |
|---|---|---|
| `queued` | Waiting by the door | Accepted; waiting for the garage |
| `running` | In the garage | Timelines in progress |
| `passed` | Fixed it | A timeline passed and a PR is open |
| `gave_up` | Gave up (not his fault) | Every timeline failed |
| `no_tests` | No tests found | No test command could be detected |
| `interrupted` | Interrupted | The brain restarted mid-job; jobs are not resumed |
| `error` | Garage fire | Infrastructure error (the garage, GitHub, etc.) |

## Hidden acceptance tests

Claude Code can see and run a repo's visible tests, so within one attempt it will usually keep going until they pass. A judge it can see is a judge it can fit itself to.

Uncle Rollback uses the held-out-test approach that coding benchmarks use:

- Hidden tests for each issue live **on the brain**, in `acceptance/<owner>__<repo>/issue-<n>/`, mirroring the repo layout (for example `test/hidden-1.test.ts`).
- The brain copies them into the garage **only after Claude has exited**. The next restore to `t0` removes them again.
- They are **never** included in a PR, and the diff shown in the album is captured before they are copied in.
- They are honest: the issue text describes every behavior they check. Claude just can't overfit to them.
- Any attempt that edits a visible test file fails. Uncle doesn't get to change the rules.

Repos without hidden tests work too. The visible suite is then the only judge, and passing on the first try is fine.

## Memory

Every timeline becomes one Pinecone record. The index uses **integrated embedding**, so text goes in and similarity search comes out, with no separate embedding service.

| Field | Example |
|---|---|
| `_id` | `7e213394-t2` |
| `text` (embedded) | `Timeline 2 of issue #1 "parseQuantity breaks…": Rewrote the parser as one giant regex. Rewound because: tests failed. Uncle said: "That regex was beautiful."` |
| `repo` | `alice/uncle-demo-pantry` |
| `issue`, `job_id`, `timeline` | `1`, `7e213394`, `2` |
| `outcome` | `passed`, `failed` or `gave_up` |
| `created_at` | ISO timestamp |

Memory is used in two ways:

- **Across jobs:** a semantic search over the repo's memories feeds Uncle's acknowledgement comment and the "family lore" section of every prompt.
- **Within a job:** summaries of the failed timelines go into the next prompt, so the next attempt avoids those approaches. The brain reads these from its own SQLite copy, because a record written to Pinecone seconds earlier may not be searchable yet.

If Pinecone is unreachable, Uncle carries on without memory instead of failing the job.

## Sprites features used

| Feature | How Uncle uses it |
|---|---|
| **Checkpoints and restore** | `garage-clean` resets the garage for every job; `t0-<job>` rewinds every failed timeline |
| **Connectors** | GitHub (authorized as the bot account), Pinecone, Custom API (the Sprites API itself), and optionally Ollama Cloud. Credentials are attached by the gateway. |
| **Sleep and wake** | Both Sprites sleep between issues at no cost. A GitHub webhook to the public URL wakes the brain. |
| **Services and public URL** | The brain runs as a Sprite service on port 8080 and survives restarts |
| **Tasks API** (optional) | Keeps the brain awake during a long job if an open exec session doesn't (`KEEP_AWAKE=tasks`) |
| **Preinstalled Claude Code** | Runs headless in the garage on the owner's Claude subscription |

## Security model

The webhook is public and issue text flows into an agent that runs code, so the trust boundaries are kept narrow:

- **Who can trigger:** only allowlisted GitHub users (`OWNER_ALLOWLIST`), only on allowlisted repos (`REPO_ALLOWLIST`), and only on issues that an allowlisted user opened, because the issue text becomes Claude's instructions. Every request needs a valid HMAC signature. The bot's own comments are always ignored, so it can't trigger itself.
- **Connector scoping:** the garage runs Claude with permissions skipped, so a prompt-injected Claude could use any connector the garage is allowed to reach. Only the **GitHub** connector is shared with the garage (it downloads the repo through it). The **Sprites API (Custom API)** and **Pinecone** connectors are restricted to `uncle-brain` alone. Residual risk: a hijacked attempt could still use the GitHub connector as the bot, for example to comment, so give the bot write access only to the repos Uncle works on.
- **Where code runs:** Claude Code runs with permissions skipped, but only in the garage, an isolated microVM that is restored to a clean checkpoint at the start of every job and after every failed timeline.
- **Secrets on the boxes:**
  - brain: `WEBHOOK_SECRET` only (it can't access any service);
  - garage: the Claude Code `setup-token`.

  GitHub, Pinecone and the Sprites API are reached through connectors whose policies allow only Sprites named `uncle-*`.
- **What reaches GitHub:** only files that changed in the passing timeline, minus the hidden tests, on a branch the bot owns. Nothing is merged automatically.
- **The album is public and read-only.** It shows issue titles, diffs and test output, so only point Uncle at repos whose code you're happy to show. All user text is HTML-escaped.

If a day-1 spike check forced a fallback that adds a secret (for example a `SPRITES_TOKEN` on the brain), it is recorded in [SPIKE.md](SPIKE.md).

## Project structure

```
src/
  main.ts          wires real clients, boots the server and queue
  server.ts        Hono routes (/webhook, album, JSON API, /healthz) and boot recovery
  config.ts        environment → Config, with validation and defaults
  webhook.ts       HMAC verification and trigger parsing (allowlists, bot filter)
  queue.ts         one-at-a-time job queue with dedupe and "busy" replies
  runner.ts        the timeline loop: prepare → attempt → judge → remember → rewind or ship
  db.ts            SQLite jobs and timelines
  garage.ts        Sprites API client: exec (with output envelope), fs/write, checkpoint, restore
  repo.ts          tarball fetch, test-command detection, changed files, test-file guard
  prompt.ts        Claude prompt builder and output parser
  memory.ts        Pinecone memory through the gateway
  github.ts        GitHub client: comments, reactions, PRs through the Git Data API
  narrate.ts       Uncle's voice: comments and PR bodies
  ollama.ts        optional narration polish through Ollama Cloud (keeps every link and heading)
  acceptance.ts    reads hidden tests for an issue
  keepawake.ts     optional Tasks API keep-awake around jobs
  gateway.ts       the single place that builds connector gateway URLs
  views/album.ts   the family album HTML
test/              vitest suites, one per module, plus fakes for the garage, GitHub and Pinecone
acceptance/_demo/  hidden tests for the demo repo (renamed to <owner>__uncle-demo-pantry on deploy)
demo/              contents of the demo repo, plus ISSUES.md with the issue texts
scripts/
  garage-setup.sh        run inside the garage once
  deploy-brain.sh        ship the code to the brain and (re)start the service
  spike/brain-checks.ts  end-to-end checks against real Sprites, GitHub and Pinecone
  preview-album.ts       render the album with sample data
docs/
  superpowers/specs/     design document
  superpowers/plans/     implementation plan
  demo-script.md         demo video shot list and submission copy
SPIKE.md                 live verification results and any fallbacks chosen
```

## Configuration

All configuration is environment variables. On the brain they live in `/app/.env`, created from your local `.env.brain` by the deploy script.

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `WEBHOOK_SECRET` | yes | | GitHub webhook HMAC secret |
| `BOT_LOGIN` | yes | | The bot's GitHub login; its comments are ignored |
| `OWNER_ALLOWLIST` | yes | | Comma-separated GitHub logins allowed to trigger Uncle |
| `REPO_ALLOWLIST` | yes | | Comma-separated `owner/repo` names Uncle will work on |
| `CONN_GITHUB` | yes | | GitHub connector connection id |
| `CONN_PINECONE` | yes | | Pinecone connector connection id |
| `CONN_SPRITES` | yes | | Custom API connector id for `api.sprites.dev` |
| `PUBLIC_URL` | yes | | The brain's public URL, used in album links |
| `CONN_OLLAMA` | no | | Ollama Cloud connector id; enables narration polish |
| `GARAGE_NAME` | no | `uncle-garage` | Name of the garage Sprite |
| `MAX_TIMELINES` | no | `3` | Attempts per job |
| `ATTEMPT_TIMEOUT_MS` | no | `300000` | Time limit per Claude attempt and per test run |
| `RECALL_TOP_K` | no | `5` | Memories recalled per job |
| `DB_PATH` | no | `/data/uncle.db` | SQLite file |
| `ACCEPTANCE_DIR` | no | `acceptance` | Root of the hidden tests |
| `PINECONE_PATH_PREFIX` | no | | Gateway path in front of Pinecone's `records/…` routes |
| `SPRITES_GATEWAY_PROVIDER` | no | `custom` | Gateway slug of the Custom API connector |
| `SPRITES_TOKEN` | no | | Fallback: call the Sprites API directly (puts a token on the brain) |
| `OLLAMA_MODEL` | no | `gpt-oss:20b` | Model for narration polish |
| `OLLAMA_GATEWAY_PROVIDER` | no | `ollama` | Gateway slug of the Ollama connector |
| `KEEP_AWAKE` | no | | Set to `tasks` to hold a Tasks API keep-awake during jobs |
| `PORT` | no | `8080` | HTTP port (the Sprite proxy routes the URL to 8080) |

Model-size defaults (3 timelines × 5 minutes) are sized for a Claude Pro subscription. With Max you can raise both.

## Setup

You need:
- a Fly.io account (the Free plan is enough);
- a Claude subscription;
- a Pinecone account;
- a second GitHub account for the bot.

**1. Sprites.** Install the CLI, log in, and create both Sprites:

```bash
# macOS/Linux: curl -fsSL https://sprites.dev/install.sh | sh
# Windows (PowerShell): iwr https://sprites.dev/install.ps1 -useb | iex
sprite login
sprite create uncle-brain --skip-console
sprite create uncle-garage --skip-console
```

**2. GitHub.**
- Create the bot account (for example `uncle-rollback`).
- Create the repo you want fixed and add the bot as a collaborator with write access.
- For the demo, push `demo/` as `uncle-demo-pantry` and open the two issues in `demo/ISSUES.md`.

**3. Connectors.** In the Fly dashboard go to **Sprites → Connectors**. Add each of these with the access policy shown, and note each connection id:

| Connector | Policy (name prefix) | Notes |
|---|---|---|
| **GitHub** | `uncle-` (brain and garage) | Sign in as the **bot** account when authorizing |
| **Pinecone** | `uncle-brain` | Your Pinecone API key |
| **Custom API** (Sprites API) | `uncle-brain` | Base URL `https://api.sprites.dev`, header `Authorization: Bearer <a Sprites token>` |
| *(optional)* **Ollama Cloud** | `uncle-brain` | |

Keep the Sprites API and Pinecone connectors away from the garage: it runs Claude with permissions skipped (see [Security model](#security-model)).

**4. Pinecone index.** Create `uncle-memories` with integrated embedding model `llama-text-embed-v2` and field map `text`.

**5. Garage.**

```bash
sprite console -s uncle-garage
# inside the garage:
bash garage-setup.sh                 # copy scripts/garage-setup.sh in first
claude setup-token                   # long-lived token for your Claude subscription
umask 077; cat > /work/.uncle/claude_token   # paste the token, then Ctrl-D
exit
sprite checkpoint create -s uncle-garage --comment garage-clean
```

The long-lived token matters: a normal login rotates its refresh token, and a disk rewind could restore a stale one.

**6. Brain.**

```bash
cp .env.example .env.brain           # fill in the values from the table above
OWNER=<your-github-login> scripts/deploy-brain.sh
```

The script uploads the committed code, installs dependencies, renames the demo's hidden tests for your login, registers the `uncle` service on port 8080, and makes the URL public.

**7. Verify.** On the brain, run the end-to-end checks:

```bash
sprite console -s uncle-brain
cd /app && set -a && . ./.env && set +a && npx tsx scripts/spike/brain-checks.ts
```

They cover:
- the connector list;
- garage exec;
- a checkpoint and restore round trip;
- the `garage-clean` checkpoint;
- Claude in the garage;
- the GitHub tarball and API;
- a Pinecone upsert and search.

Record the results in `SPIKE.md`.

**8. Webhook.** In your repo, go to **Settings → Webhooks → Add webhook**:
- payload URL `https://<brain-url>/webhook`;
- content type `application/json`;
- secret `WEBHOOK_SECRET`;
- events: **Issue comments** only.

GitHub's ping should get a `204`.

**9. Try it.** Comment `@uncle fix this` on an issue, then open the album.

## Development

```bash
npm install
npm test               # vitest: 100+ tests, including the full timeline loop against fakes
npm run typecheck      # tsc --noEmit
set -a; . ./.env; set +a; npm run dev   # run the brain locally with the .env.example variables exported (garage calls fail off-Sprite)
npx tsx scripts/preview-album.ts out/   # render the album with sample data to out/*.html
```

Testing approach:
- Every module was built test-first.
- The runner and queue are tested against in-memory fakes (`test/fakes.ts`) for the garage, GitHub and Pinecone. That covers passing first try, rewinding and retrying, giving up, editing a test file, Claude timeouts, non-JSON output, repos with no tests, hidden-test ordering, recalled lore, and infrastructure errors.
- The webhook, dedupe, "busy" replies, boot recovery and HTML escaping are covered too.
- Nothing in the test suite touches the network.

Local smoke test: export the variables from a filled-in `.env`, run `npm run dev`, and send a signed webhook with `curl`. The job is accepted (`202`), appears in the album, and ends as **Garage fire**, because the connector gateway only answers requests from inside a Sprite. That proves the whole path short of the garage.

## Cost

Sprites bill only while running (CPU about $0.04 per CPU-hour, memory about $0.02 per GB-hour), and both Sprites sleep between issues.

A job is a few minutes of garage time per timeline plus a little brain time. A demo week with a handful of jobs is intended to stay inside the Free plan's $5 of monthly usage. The actual cost per job is measured during setup and recorded in `SPIKE.md`.

## Limitations and known assumptions

- **One garage, one job at a time.** Further jobs wait in the queue.
- **Jobs interrupted by a brain restart are not resumed.** They are marked `interrupted`; comment again to retry.
- **PR files are committed as UTF-8 text.** Binary files Uncle changes would not survive the trip.
- **Sprites API details pinned by the day-1 spike.** The exec endpoint's response format is not documented, so every garage command runs inside a wrapper that prints a single sentinel line (exit code plus base64 stdout and stderr). The parser accepts both plain text and NDJSON streams. The gateway slugs and the Pinecone path prefix are configurable for the same reason. Results go in `SPIKE.md`.
- **Uncle only fixes what tests can judge.** No test command, no attempt.

## Roadmap

- **`@uncle remember`:** ask Uncle what he remembers about a repo, answered from Pinecone.
- **Family archive:** export each job's album to a Box folder.
- **Voice notes:** Uncle reads his PR summary aloud through the ElevenLabs connector.
- **Multiverse mode:** run timelines in parallel garages and keep the first one that passes.

---

*Uncle Rollback is a hackathon project. He is not responsible for your Thanksgiving dinner.*
