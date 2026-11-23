# Uncle Rollback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a coding agent that runs on two Fly.io Sprites. A GitHub `@uncle fix this` comment from the owner starts it. It attempts fixes with Claude Code, rewinds the "garage" Sprite to a checkpoint after each failed attempt, remembers every timeline in Pinecone, and opens an in-character PR when the hidden acceptance tests pass.

**Architecture:** The **brain** Sprite (`uncle-brain`, never restored) runs a Node/TypeScript Hono server on :8080. It verifies webhooks, queues jobs one at a time, serves the family-album UI, and drives the **garage** Sprite (`uncle-garage`) through the Sprites API: exec, files, checkpoint, restore. All external calls (GitHub, Pinecone, the Sprites API, optionally Ollama) go through the Sprites connector gateway. The job runner is pure orchestration over injected clients, so all logic is unit-tested with fakes.

**Tech Stack:** Node 22 and TypeScript (ESM), Hono with `@hono/node-server`, `better-sqlite3`, `vitest`, `tsx`. Claude Code (`claude -p`) runs in the garage. Pinecone uses an integrated-embedding index.

**Spec:** `docs/superpowers/specs/2026-11-24-uncle-rollback-design.md`. Read it before any task.

## Global Constraints

- The hackathon requires that the agent runs on Sprites and uses ≥1 Sprites connector. We use GitHub, Pinecone, and Custom API (Sprites API), plus Ollama Cloud optionally.
- **Deadline:** submit by **Mon Nov 30, 12:00 IST** (the official cutoff is 13:30 IST, which is midnight PST on Nov 29).
- **Budget:** a hard $5/month (Fly Free plan). Nothing may keep a Sprite awake on purpose outside a running job.
- **Claude:** a Pro subscription. `MAX_TIMELINES=3` and `ATTEMPT_TIMEOUT_MS=300000` (5 min) are the defaults.
- **Triggers:** only when the comment author is in `OWNER_ALLOWLIST`, the repo is in `REPO_ALLOWLIST`, the event is `issue_comment` with `action: "created"`, the body contains `@uncle`, the author is not `BOT_LOGIN`, and the issue is not a PR.
- **Secrets on boxes:** only `WEBHOOK_SECRET` on the brain and the Claude `setup-token` in the garage. Everything else goes through connectors. Any fallback that adds a secret must be written in the README.
- **Sprite names:** `uncle-brain`, `uncle-garage`. Connector policy: name prefix `uncle-`.
- **Garage paths:** the repo lives in `/work/repo`. The base checkpoint comment is `garage-clean`. Each job's checkpoint comment is `t0-<jobId>`.
- **Hidden tests** live on the brain in `acceptance/<owner>__<repo>/`. They are copied into the garage only after Claude exits, and are never included in PR files.
- **Pinecone:** index `uncle-memories`, namespace `memories`, embedded text field `text`. Record fields are flat: `id, text, repo, issue, job_id, timeline, outcome, created_at`.
- **PR branch:** `uncle/issue-<number>`. The PR body must contain a `## Family History` section.
- **Album:** routes `/`, `/job/:id`, `/api/job/:id`. The visual direction is a warm "family photo album / Thanksgiving" look.

## Schedule (IST)

| Day | Tasks |
|---|---|
| Tue Nov 24 | Tasks 0–1 (setup + spike) |
| Wed Nov 25 | Tasks 2–6 |
| Thu Nov 26 | Tasks 7–10 |
| Fri Nov 27 | Tasks 11–13 |
| Sat Nov 28 | Task 13 hardening, Task 14 Steps 1–2 |
| Sun Nov 29 | Task 14 Steps 3–4 |

## Review Focus

1. **GitHub webhook redelivery** (a timeout or manual redeliver) sends the same comment twice. It must start exactly one job, deduplicated by comment id. *Test owner: Task 4.*
2. **A second `@uncle` comment on an issue whose job is still queued or running** must not start a parallel job on the garage. It gets an in-character "I'm already on it" reply. *Test owner: Task 10.*
3. **Claude exits non-zero, times out, or prints non-JSON.** The timeline fails with a recorded reason, the garage is rewound, and the loop continues. It must not crash the job. *Test owners: Task 6 and Task 10.*
4. **The repo has no detectable test command.** Uncle complains in character, no attempts run, and the job ends as `no_tests`. *Test owner: Task 10.*
5. **The brain restarts mid-job.** On boot the job is marked `interrupted`, the album shows it, and the queue continues with the next job. *Test owner: Task 11.*

---

## File Structure

```
package.json, tsconfig.json, vitest.config.ts, .env.example, README.md
src/
  config.ts       env → Config (allowlists, names, limits, connection ids)
  gateway.ts      gatewayUrl() + gatewayFetch(): the only place that talks to api.sprites.dev/v1/gateway
  webhook.ts      verifySignature(), parseTrigger()
  db.ts           SQLite schema + Db class (jobs, timelines, dedupe)
  garage.ts       Garage interface + SpritesGarage (Sprites API: exec, writeFile, checkpoint, restore)
  repo.ts         fetchRepo(), detectTestCommand(), changedFiles(), testFilesChanged()
  prompt.ts       buildAttemptPrompt(), parseAttemptOutput()
  memory.ts       Memory interface + PineconeMemory
  github.ts       GitHub interface + GatewayGitHub (comment, react, createPullFromFiles)
  narrate.ts      ackComment(), busyComment(), noTestsComment(), giveUpComment(), prBody(), prComment()
  runner.ts       runJob(): the timeline loop over injected deps
  queue.ts        JobQueue: one job at a time
  server.ts       createApp(): Hono routes
  views/album.ts  renderIndex(), renderJob(): HTML strings
  main.ts         boot: wire deps, mark interrupted, start server + queue
acceptance/<owner>__<repo>/   hidden tests (brain only)
scripts/spike/    day-1 verification scripts
scripts/garage-setup.sh, scripts/deploy-brain.sh
test/             vitest suites, one per src module, plus test/fakes.ts
demo/             contents of the separate demo GitHub repo
SPIKE.md          spike results and chosen fallbacks
```

---

### Task 0: Accounts, Sprites, connectors (manual, done with the user)

These steps need the user's browser and logins. Claude guides them and records the results in `SPIKE.md`.

- [ ] **Step 1:** Install the Sprites CLI on Windows with `iwr https://sprites.dev/install.ps1 -useb | iex`, then run `sprite login`. Expected: `sprite list` runs without error.
- [ ] **Step 2:** Run `sprite create uncle-brain --skip-console` and `sprite create uncle-garage --skip-console`. Expected: both appear in `sprite list`.
- [ ] **Step 3:** Create the bot GitHub account (for example `uncle-rollback`). Create the demo repo under the user's account (for example `<user>/uncle-demo-pantry`) and invite the bot as a collaborator with write access. The user creates the account; Claude does not.
- [ ] **Step 4:** In the Fly dashboard (Sprites → Connectors), add the following, each with the access policy **name prefix `uncle-`**:
  - **GitHub**, OAuth-authorized while signed in as the **bot** account.
  - **Pinecone**, with an API key from the user's Pinecone account.
  - **Custom API**, base `https://api.sprites.dev`, header auth `Authorization: Bearer <Sprites org token>`.

  Record each `connection_id` in `SPIKE.md`.
- [ ] **Step 5:** Create the Pinecone index `uncle-memories` with integrated embedding model `llama-text-embed-v2` and field map `text → text`. Use the console or the Pinecone MCP `create-index-for-model`.
- [ ] **Step 6:** In the garage, run `sprite console -s uncle-garage`, then `claude setup-token`. Save the token to `/root/.uncle/claude_token` with mode 600. Run `scripts/garage-setup.sh` (see Task 1), then `sprite checkpoint create -s uncle-garage --comment garage-clean`. Expected: `sprite checkpoint list` shows `garage-clean`.

### Task 1: Day-1 spike (gate for everything else)

**Files:** Create `scripts/spike/*.sh` (run inside Sprites through `sprite exec`), `scripts/garage-setup.sh`, and `SPIKE.md`.

Each check below is one step. Record **PASS/FAIL, the observed behavior, and the chosen fallback** in `SPIKE.md`. Later tasks read `SPIKE.md` for the exact endpoints and paths.

- [ ] **Step 1, `garage-setup.sh`:** Install git, jq, and python3-pip/pytest if missing. Print `node --version`. Write `/root/.uncle/run-claude.sh`, a wrapper that does `export CLAUDE_CODE_OAUTH_TOKEN=$(cat /root/.uncle/claude_token)`, `cd /work/repo`, and `timeout "$1" claude -p "$(cat /work/prompt.txt)" --output-format json --dangerously-skip-permissions > /work/claude-out.json`. Expected: `sprite exec -s uncle-garage -- /root/.uncle/run-claude.sh 60` with a trivial prompt writes valid JSON.
- [ ] **Step 2, gateway list:** From inside each Sprite, run `curl -s https://api.sprites.dev/v1/gateway/list`. Expected: all three connectors are listed. A 403 means a policy mistake; fix the prefix.
- [ ] **Step 3, Sprites API through Custom API (spec §8.2):** From the brain, make a gateway call to list Sprites, then exec `echo hi` in `uncle-garage`. Record the exact exec, checkpoint-create, checkpoint-list, restore, and file-write endpoints and their payloads from `https://docs.fly.io/sprites/api/openapi.json`. *If it fails:* put `SPRITES_TOKEN` in the brain env and call `api.sprites.dev` directly (the README notes the compromise).
- [ ] **Step 4, restore over the API (spec §8.1):** Create a file, checkpoint, delete the file, restore, and check the file is back. Record the restore latency, whether the call is sync or async (poll until the Sprite is ready), and whether running processes survive.
- [ ] **Step 5, Claude survives restore (spec §8.4):** Restore to `garage-clean` twice, then run `run-claude.sh`. Expected: valid JSON both times. *If it fails:* the brain passes `CLAUDE_CODE_OAUTH_TOKEN` per exec (an `env` option).
- [ ] **Step 6, GitHub through the gateway (spec §8.3):** From the **garage**, download the demo repo tarball through the gateway and extract it. From the **brain**, create a blob, a tree, a commit, and a ref, open a PR, and post an issue comment, on a scratch branch. Record whether the tarball endpoint returns a redirect and whether the gateway follows it. *If it fails:* use a fine-grained bot PAT in the garage base checkpoint.
- [ ] **Step 7, Pinecone through the gateway (spec §8.5):** Upsert one record into `uncle-memories/memories`, then search it by text. Record the exact gateway path, which tells us whether the connector routes to the index host. *If it fails, investigate before anything else;* the last resort is `PINECONE_API_KEY` on the brain.
- [ ] **Step 8, webhook wake (spec §8.6):** Run a throwaway `python3 -m http.server 8080` service on the brain, set the URL to public with `sprite url update -s uncle-brain --auth public`, let it go cold, and `curl` the URL. Record the cold-wake latency, which must be under 10 s. Check whether an open `exec` to the garage keeps the brain awake. If it doesn't, record the Tasks API usage (`/.sprite/api.sock`).
- [ ] **Step 9, optional Ollama (spec §8.7):** Make one chat completion through the Ollama Cloud connector. Record PASS/SKIP.
- [ ] **Step 10:** Commit with `git init` (if not already a repo), `git add scripts SPIKE.md`, and `git commit -m "spike: verify sprites, connectors, claude on garage"`.

### Task 2: Scaffold, config, gateway client

**Files:**
- Create `package.json`, `tsconfig.json`, `vitest.config.ts`, `.env.example`, `src/config.ts`, `src/gateway.ts`
- Test: `test/config.test.ts`, `test/gateway.test.ts`

**Interfaces:**
- Produces:
  - `interface Config { ownerAllowlist: string[]; repoAllowlist: string[]; botLogin: string; webhookSecret: string; garageName: string; maxTimelines: number; attemptTimeoutMs: number; recallTopK: number; conn: { github: string; pinecone: string; sprites: string; ollama?: string }; dbPath: string; acceptanceDir: string; publicUrl: string }`
  - `loadConfig(env: Record<string,string|undefined>): Config`. Allowlists are comma-separated and lowercased. The defaults are `maxTimelines=3`, `attemptTimeoutMs=300000`, `recallTopK=5`, `garageName="uncle-garage"`, and `dbPath="/data/uncle.db"`. It throws on a missing `WEBHOOK_SECRET`, `BOT_LOGIN`, `OWNER_ALLOWLIST`, or any `conn` id other than ollama.
  - `gatewayUrl(provider: string, connectionId: string, path: string): string` returns `https://api.sprites.dev/v1/gateway/${provider}/${connectionId}/${path without leading slash}`.
  - `gatewayFetch(provider, connectionId, path, init?: RequestInit, fetchImpl = fetch): Promise<Response>`. On a non-2xx response it throws `GatewayError { status, body }`.

- [ ] **Step 1:** `npm init`. Add the deps `hono @hono/node-server better-sqlite3` and the dev deps `typescript tsx vitest @types/node @types/better-sqlite3`. Set `"type": "module"` and the scripts `test: vitest run`, `dev: tsx watch src/main.ts`, `start: tsx src/main.ts`.
- [ ] **Step 2: Write the failing tests.** `loadConfig` applies the defaults, lowercases `OWNER_ALLOWLIST=" Alice ,bob"` to `["alice","bob"]`, and throws `/WEBHOOK_SECRET/` when that variable is missing. `gatewayUrl("github","c1","/repos/a/b")` returns `"https://api.sprites.dev/v1/gateway/github/c1/repos/a/b"`. `gatewayFetch` with a fake fetch returning 403 rejects with a `GatewayError` whose `status` is 403.
- [ ] **Step 3:** Run `npx vitest run test/config.test.ts test/gateway.test.ts`. Expected: FAIL (the modules don't exist yet).
- [ ] **Step 4:** Implement both modules.
- [ ] **Step 5:** Run the same command. Expected: PASS.
- [ ] **Step 6:** Commit with `git commit -m "feat: config and gateway client"`.

### Task 3: Webhook verification and trigger parsing

**Files:** Create `src/webhook.ts`. Test: `test/webhook.test.ts`.

**Interfaces:**
- Consumes `Config`.
- Produces:
  - `verifySignature(secret: string, rawBody: string, header: string | undefined): boolean`. It checks `sha256=` plus an HMAC-SHA256 hex digest and compares with `timingSafeEqual`.
  - `interface Trigger { commentId: number; repo: string /* "owner/name", lowercased */; issueNumber: number; issueTitle: string; issueBody: string; author: string }`
  - `parseTrigger(event: string, payload: any, cfg: Config): Trigger | null`

- [ ] **Step 1: Write the failing tests.**
  - The correct signature returns true. A tampered body, a missing header, or a wrong-length header returns false and doesn't throw.
  - A valid owner comment `"hey @uncle fix this"` on an allowlisted repo returns a Trigger with the fields mapped.
  - Each of the following returns `null`: event `issues`, `action: "edited"`, an author not in the allowlist, an author equal to `botLogin` (even when that login is also allowlisted), a repo not in the allowlist, a body without `@uncle`, and a payload with `issue.pull_request` present.
- [ ] **Step 2:** Run `npx vitest run test/webhook.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement both functions.
- [ ] **Step 4:** Run the same command. Expected: PASS.
- [ ] **Step 5:** Commit with `git commit -m "feat: webhook signature and trigger parsing"`.

### Task 4: Database

**Files:** Create `src/db.ts`. Test: `test/db.test.ts`.

**Interfaces:**
- Produces:
  - `type JobStatus = "queued"|"running"|"passed"|"gave_up"|"no_tests"|"interrupted"|"error"`
  - `type TimelineOutcome = "running"|"passed"|"failed"`
  - `interface Job { id: string; commentId: number; repo: string; issueNumber: number; issueTitle: string; issueBody: string; status: JobStatus; testCommand: string|null; baseline: string|null; prUrl: string|null; createdAt: string; updatedAt: string }`
  - `interface Timeline { jobId: string; n: number; outcome: TimelineOutcome; approach: string; quote: string; failReason: string|null; testTail: string; diff: string; durationMs: number }`
  - `class Db { constructor(path: string)` (`":memory:"` allowed)
    - `createJob(t: Trigger): Job | null` returns null if the `commentId` already exists; this is the dedupe from Review Focus 1
    - `getJob(id)`, `listJobs(limit=50)`, `updateJob(id, patch: Partial<Job>)`
    - `activeJobForIssue(repo, issueNumber): Job | null` (status `queued` or `running`)
    - `nextQueued(): Job | null` (oldest first)
    - `markRunningAsInterrupted(): number`
    - `addTimeline(t: Timeline)`, `updateTimeline(jobId, n, patch)`, `timelines(jobId): Timeline[]` `}`
  - Job ids are `crypto.randomUUID().slice(0,8)`.

- [ ] **Step 1: Write the failing tests.**
  - `createJob` called twice with the same `commentId` returns a Job the first time and `null` the second.
  - `activeJobForIssue` finds a queued job and returns null once it is `passed`.
  - `nextQueued` returns the oldest.
  - `markRunningAsInterrupted` flips only `running` jobs and returns the count.
  - Timelines come back ordered by `n`.
- [ ] **Step 2:** Run `npx vitest run test/db.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement with `better-sqlite3`: a `UNIQUE` constraint on `jobs.comment_id`, and `INSERT ... ON CONFLICT DO NOTHING` to dedupe.
- [ ] **Step 4:** Run the same command. Expected: PASS.
- [ ] **Step 5:** Commit with `git commit -m "feat: sqlite job and timeline store"`.

### Task 5: Garage client (Sprites API)

**Files:** Create `src/garage.ts`. Test: `test/garage.test.ts`.

**Interfaces:**
- Consumes `gatewayFetch`, `Config`, and the endpoints recorded in `SPIKE.md` (Task 1 Step 3).
- Produces:
  - `interface ExecResult { exitCode: number; stdout: string; stderr: string; timedOut: boolean }`
  - `interface Garage { exec(cmd: string[], opts?: { timeoutMs?: number; env?: Record<string,string>; cwd?: string }): Promise<ExecResult>; writeFile(path: string, content: string): Promise<void>; checkpoint(comment: string): Promise<string /* version id */>; restore(versionId: string): Promise<void>; findCheckpoint(comment: string): Promise<string|null> }`
  - `class SpritesGarage implements Garage { constructor(cfg: Config, fetchImpl = fetch) }`. It goes through the `sprites` connection (Custom API), or calls `api.sprites.dev` directly with `SPRITES_TOKEN` if `SPIKE.md` chose that fallback.
  - `restore` resolves only once the garage accepts exec again: it polls `exec(["true"])` every 1 s and gives up after 60 s.
  - A `timedOut` result comes from the client-side timeout; the server side is also wrapped with `timeout` in `run-claude.sh`.

- [ ] **Step 1: Write the failing tests** with a fake fetch that records requests:
  - `exec(["echo","hi"])` sends the exec endpoint and body shape from `SPIKE.md` and maps the response to an `ExecResult`.
  - `checkpoint("t0-abc")` returns the version id from the response.
  - `findCheckpoint("garage-clean")` picks the newest version with that comment.
  - When `restore("v3")` gets one failing probe followed by a successful one, it resolves after the second.
  - When `exec` exceeds `timeoutMs`, the result has `timedOut: true`.
- [ ] **Step 2:** Run `npx vitest run test/garage.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the same command. Expected: PASS.
- [ ] **Step 5 (live check):** Run `tsx scripts/spike/garage-live.ts` on the brain: exec, checkpoint, writeFile, restore, and confirm the file is gone. Expected: the script prints `OK`.
- [ ] **Step 6:** Commit with `git commit -m "feat: sprites garage client"`.

### Task 6: Repo helpers and prompt

**Files:** Create `src/repo.ts` and `src/prompt.ts`. Test: `test/repo.test.ts`, `test/prompt.test.ts`.

**Interfaces:**
- Consumes `Garage` and `Config`.
- Produces:
  - `fetchRepo(g: Garage, cfg: Config, repo: string): Promise<void>`. It runs `rm -rf /work/repo`, downloads `repos/{repo}/tarball/HEAD` through the gateway inside the garage with `curl -sL` (exact path from `SPIKE.md`), extracts with `--strip-components=1`, then runs `git init`, `git add -A`, and `git -c user.name=uncle -c user.email=uncle@localhost commit -qm base`. It throws if any step exits non-zero.
  - `interface RepoProbe { uncleYml: string|null; packageJson: string|null; hasPyproject: boolean; hasSetupCfg: boolean; hasTestsDir: boolean }`
  - `probeRepo(g: Garage): Promise<RepoProbe>`
  - `detectTestCommand(p: RepoProbe): string|null`. The precedence is: a `test:` line in `.uncle.yml`, then `npm test` if `packageJson.scripts.test` exists and is not npm's default `"echo \"Error: no test specified\" && exit 1"`, then `python3 -m pytest -q` if there is a pyproject, setup.cfg, or tests directory, otherwise null.
  - `changedFiles(g: Garage): Promise<{ path: string; deleted: boolean }[]>`. It parses `git status --porcelain` in `/work/repo`.
  - `TEST_FILE_PATTERNS: RegExp[]` matches `/(^|\/)(tests?|__tests__)\//`, `/\.(test|spec)\.[jt]sx?$/`, and `/(^|\/)test_[^/]*\.py$|_test\.py$/`.
  - `testFilesChanged(files: {path:string}[]): string[]` lists the changed test paths.
  - `interface AttemptInput { issueTitle: string; issueBody: string; testCommand: string; lore: string[]; failedTimelines: { n: number; approach: string; failReason: string }[] }`
  - `buildAttemptPrompt(i: AttemptInput): string`
  - `interface AttemptOutput { approach: string; quote: string }`
  - `parseAttemptOutput(raw: string): AttemptOutput | { error: string }`. It reads Claude's `--output-format json` envelope, takes `.result`, and extracts the **last** fenced or bare JSON object containing `approach` and `quote`. Anything else returns `{error}`.

- [ ] **Step 1: Write the failing tests.**
  - `detectTestCommand` covers each precedence case, including npm's default "no test specified" script returning null.
  - `testFilesChanged` flags `src/__tests__/a.ts`, `tests/test_x.py`, and `foo.spec.ts`, and does not flag `src/testing.ts`.
  - The prompt contains the issue title, the test command, each failed timeline's approach and reason, each lore line, and the instructions: "do not modify test files", "use a different approach than the failed timelines", and "finish with a JSON object {approach, quote}". The quote must be in Uncle's voice, one sentence.
  - `parseAttemptOutput` covers a valid envelope (returns the object), a non-JSON envelope, a result with no JSON object, and a JSON object missing `quote`. The last three each return `{error}` (Review Focus 3).
- [ ] **Step 2:** Run `npx vitest run test/repo.test.ts test/prompt.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement. The prompt states the Uncle persona from spec §5.6 in two or three sentences: confident, rambling, never wrong, only in the wrong timeline, never mean.
- [ ] **Step 4:** Run the same command. Expected: PASS.
- [ ] **Step 5:** Commit with `git commit -m "feat: repo helpers, test detection, attempt prompt"`.

### Task 7: Pinecone memory

**Files:** Create `src/memory.ts`. Test: `test/memory.test.ts`.

**Interfaces:**
- Consumes `gatewayFetch` and the Pinecone gateway path from `SPIKE.md`.
- Produces:
  - `interface MemoryRecord { id: string; text: string; repo: string; issue: number; job_id: string; timeline: number; outcome: "passed"|"failed"|"gave_up"; created_at: string }`
  - `interface Memory { remember(r: MemoryRecord): Promise<void>; recallForJob(jobId: string): Promise<MemoryRecord[]>; recallForRepo(repo: string, query: string, k: number): Promise<MemoryRecord[]> }`
  - `class PineconeMemory implements Memory`. Upsert uses integrated records upsert to namespace `memories`. Search uses `query.inputs.text` with `top_k` and the filter `{ repo: { $eq } }` (or `{ job_id: { $eq } }` for `recallForJob`, with the query text "timeline").
  - Record ids are `${job_id}-t${timeline}`.
  - Every method catches gateway errors, logs them, and degrades. `remember` resolves anyway, and the recall methods return `[]`. A Pinecone outage must not kill a job.

- [ ] **Step 1: Write the failing tests.**
  - `remember` sends one record with exactly the flat fields above. There is no nested `metadata`, and the text lives in `text`.
  - `recallForRepo("a/b","bug",5)` sends `top_k: 5` and the repo filter, and maps the hits back to `MemoryRecord`.
  - On a 500 from the gateway, `recallForRepo` returns `[]` and `remember` resolves.
- [ ] **Step 2:** Run `npx vitest run test/memory.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the same command. Expected: PASS.
- [ ] **Step 5:** Commit with `git commit -m "feat: pinecone memory via connector"`.

### Task 8: GitHub client

**Files:** Create `src/github.ts`. Test: `test/github.test.ts`.

**Interfaces:**
- Consumes `gatewayFetch`.
- Produces:
  - `interface FileChange { path: string; content: string | null /* null = delete */ }`
  - `interface GitHub { comment(repo, issue, body): Promise<void>; react(repo, commentId, content: "eyes"|"rocket"|"confused"): Promise<void>; defaultBranch(repo): Promise<{ name: string; sha: string }>; createPullFromFiles(repo, base: {name:string; sha:string}, branch: string, files: FileChange[], title: string, body: string): Promise<string /* html_url */> }`
  - `class GatewayGitHub implements GitHub`. `createPullFromFiles` does: `POST git/blobs` for each non-deleted file (base64), then `POST git/trees` with `base_tree: base.sha` (deletions use `sha: null`), then `POST git/commits` with parent `base.sha`, then `POST git/refs` for `refs/heads/${branch}`. If the ref already exists (422), it calls `PATCH git/refs/heads/${branch}` with `force: true`. Then `POST pulls`, or, if a PR for the branch already exists (422), finds the open PR for that branch and returns its URL.

- [ ] **Step 1: Write the failing tests** with a fake fetch scripted per path:
  - The call order is blobs, tree, commit, ref, pull.
  - The tree entries use the blob shas, and a deleted file produces `sha: null`.
  - A 422 on the ref leads to a PATCH with `force: true`.
  - A 422 on the pull returns the existing PR URL.
  - `comment` posts to `repos/{repo}/issues/{n}/comments`.
- [ ] **Step 2:** Run `npx vitest run test/github.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the same command. Expected: PASS.
- [ ] **Step 5:** Commit with `git commit -m "feat: github client via connector"`.

### Task 9: Narration

**Files:** Create `src/narrate.ts`. Test: `test/narrate.test.ts`.

**Interfaces:**
- Consumes `Job`, `Timeline`, `MemoryRecord`, and `Config.publicUrl`.
- Produces pure string functions:
  - `ackComment(job, lore: MemoryRecord[])`: if lore is non-empty, it references the most recent past failure on this repo ("last time I was here…").
  - `busyComment(active: Job)`
  - `noTestsComment()`
  - `giveUpComment(job, tls: Timeline[], albumUrl)`
  - `prBody(job, tls: Timeline[], albumUrl)`
  - `prComment(prUrl, albumUrl)`
  - `albumUrl(cfg, jobId)` returns `${publicUrl}/job/${jobId}`.
- Optional: `Narrator { polish(text: string): Promise<string> }` with `IdentityNarrator`, and `OllamaNarrator` if Task 1 Step 9 passed. The runner passes final PR and comment text through `polish`, and falls back to the raw text on error.

- [ ] **Step 1: Write the failing tests.**
  - `prBody` contains `Fixes #<n>`, `## Family History`, one bullet per failed timeline with `Timeline <n>`, its approach and fail reason, the passing timeline's quote, and the album URL.
  - `giveUpComment` lists every timeline.
  - `ackComment` with lore mentions the lore approach text, and without lore does not say "last time".
- [ ] **Step 2:** Run `npx vitest run test/narrate.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement. Write the copy in Uncle's voice (spec §5.6).
- [ ] **Step 4:** Run the same command. Expected: PASS.
- [ ] **Step 5:** Commit with `git commit -m "feat: uncle narration templates"`.

### Task 10: Job runner and queue (the core loop)

**Files:** Create `src/runner.ts`, `src/queue.ts`, and `test/fakes.ts`. Test: `test/runner.test.ts`, `test/queue.test.ts`.

**Interfaces:**
- Consumes everything from Tasks 2–9.
- Produces:
  - `interface Deps { cfg: Config; db: Db; garage: Garage; github: GitHub; memory: Memory; narrator: Narrator; readAcceptance(repo: string): Promise<{ path: string; content: string }[]>; now(): number }`
  - `runJob(jobId: string, d: Deps): Promise<JobStatus>`
  - `class JobQueue { constructor(d: Deps, run = runJob); enqueue(t: Trigger): Promise<"queued"|"duplicate"|"busy">; drain(): Promise<void> /* runs queued jobs one at a time; a second drain() call while one is running is a no-op */ }`
  - `test/fakes.ts`: `FakeGarage` (scriptable per attempt: the exit code, the Claude output, the changed files, and the full-suite result; records every `restore` and `writeFile`), `FakeGitHub`, `FakeMemory`, and `makeDeps(overrides)`.

**The `runJob` algorithm:**
1. Set status `running` and run `github.react(eyes)`.
2. Run `garage.restore(findCheckpoint("garage-clean"))`, then `fetchRepo`, `probeRepo`, and `detectTestCommand`. If the command is null: post `noTestsComment`, set `no_tests`, and return.
3. Run the visible tests to get the baseline (the tail goes to `job.baseline`).
4. `t0 = garage.checkpoint("t0-"+id)`.
5. `lore = memory.recallForRepo(repo, title+" "+body, cfg.recallTopK)`, then post `ackComment(job, lore)`.
6. For n = 1..maxTimelines:
   - `addTimeline(running)` and `writeFile("/work/prompt.txt", buildAttemptPrompt(...))`.
   - Run `exec(["/root/.uncle/run-claude.sh", String(timeoutSec)], {timeoutMs})`.
   - Run `parseAttemptOutput` on the contents of `/work/claude-out.json`, read with `exec(["cat",...])`.
   - Determine `failReason`, in this order: timeout ("ran out of time"), a non-zero exit, a parse error, `testFilesChanged` ("tried to change the rules"). If none applies: write each acceptance file into `/work/repo/<path>`, run the test command, and fail with "tests failed" on a non-zero exit.
   - Capture `diff` with `git diff` **before** the acceptance files are written, so hidden tests never appear. Capture `testTail` as the last 40 lines.
   - Call `memory.remember(...)` for every timeline, passed or failed.
   - **If it passed:** take `changedFiles` minus the acceptance paths, read their contents, then `createPullFromFiles(defaultBranch, "uncle/issue-"+n, …, prBody)`, then post `prComment`, react rocket, set `passed` with `prUrl`, and return.
   - **If it failed:** set the timeline to `failed`, then `garage.restore(t0)`.
7. Post `giveUpComment`, react confused, set `gave_up`, and return.
8. Any thrown error sets the status to `error`, posts one in-character "my garage is on fire" comment (best effort), and rethrows nothing.

- [ ] **Step 1: Write the failing runner tests.**
  - **Pass on t1:** zero restores to t0, one PR, PR files exclude the acceptance paths, one memory with outcome `passed`, status `passed`.
  - **Fail t1, pass t2:** exactly one `restore(t0)`, two memories, the second prompt contains t1's approach and fail reason, and the PR body lists Timeline 1.
  - **All 3 fail:** 3 restores to t0, no PR, a give-up comment, status `gave_up`, 3 memories.
  - **Test-file edit on t1:** the fail reason is "tried to change the rules", and the acceptance tests are never written for that timeline.
  - **Timeout on t1** (`timedOut: true`): a failed timeline, then the loop continues (Review Focus 3).
  - **Non-JSON Claude output:** a failed timeline with the parse error as reason, and the loop continues (Review Focus 3).
  - **No test command:** status `no_tests`, `noTestsComment` posted, `writeFile("/work/prompt.txt")` never called (Review Focus 4).
  - **Hidden tests are written only after Claude exits:** the `writeFile` order is the prompt, then the exec, then the acceptance files.
  - **The garage throws during `fetchRepo`:** status `error`, and `runJob` resolves (does not reject).
- [ ] **Step 2: Write the failing queue tests.**
  - The same Trigger enqueued twice returns `"queued"` then `"duplicate"`.
  - A second comment on an issue with an active job returns `"busy"` and posts `busyComment` (Review Focus 2).
  - `drain` runs two queued jobs sequentially; the fake runner records that the start of job 2 comes after the end of job 1.
- [ ] **Step 3:** Run `npx vitest run test/runner.test.ts test/queue.test.ts`. Expected: FAIL.
- [ ] **Step 4:** Implement `runJob`, `JobQueue`, and the fakes.
- [ ] **Step 5:** Run `npx vitest run`. Expected: all suites PASS.
- [ ] **Step 6:** Commit with `git commit -m "feat: timeline runner and job queue"`.

### Task 11: Server, album UI, boot

**Files:** Create `src/server.ts`, `src/views/album.ts`, and `src/main.ts`. Test: `test/server.test.ts`.

**Interfaces:**
- Consumes `Config`, `Db`, `JobQueue`, `verifySignature`, and `parseTrigger`.
- Produces:
  - `createApp(d: { cfg: Config; db: Db; queue: JobQueue }): Hono`
    - `POST /webhook` reads the raw body and checks it with `verifySignature`; a bad signature returns 401. It then runs `parseTrigger`; null returns 204. Otherwise it calls `queue.enqueue` and responds **202 right away** with `{result}`, and starts `queue.drain()` without awaiting it.
    - `GET /` returns `renderIndex(db.listJobs())`.
    - `GET /job/:id` returns `renderJob(job, timelines)`, or 404.
    - `GET /api/job/:id` returns JSON `{ job, timelines }`.
    - `GET /healthz` returns `ok`.
  - `renderIndex(jobs: Job[]): string` and `renderJob(job: Job, tls: Timeline[]): string`. They return full HTML documents and must escape all repo and issue text. `renderJob` polls `/api/job/:id` every 3 s while the status is `queued` or `running`.
  - `main.ts` runs `loadConfig(process.env)` and constructs the real deps. `readAcceptance(repo)` reads every file under `${acceptanceDir}/${repo.replace("/","__")}/`, with paths relative to that folder, and returns `[]` if the folder doesn't exist. If `SPIKE.md` Step 8 found that an open exec does **not** keep the brain awake, `main` wraps each `runJob` in a Tasks API keep-awake that is renewed every 50 min and released when the job ends. It then calls `db.markRunningAsInterrupted()` (logging the count; Review Focus 5), serves on `0.0.0.0:8080`, and calls `queue.drain()` once at boot so leftover `queued` jobs run.

- [ ] **Step 1: Write the failing tests** using `app.request()`:
  - A webhook with a bad signature returns 401.
  - A valid signature on an ignored event returns 204.
  - A valid trigger returns 202 and `enqueue` is called once.
  - `/job/:id` contains each timeline's quote and the word "rewound" for failed timelines, and escapes `<script>` in the issue title.
  - `/api/job/:id` for an unknown id returns 404.
  - **Boot behavior:** a db with one `running` job leaves that job `interrupted` after `main`'s boot routine (exported as `boot(deps)`), and `/` lists it as interrupted.
- [ ] **Step 2:** Run `npx vitest run test/server.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement the routes, `boot`, and the views. For the views, invoke the `frontend-design:frontend-design` skill. The direction is a warm family-album / Thanksgiving look with polaroid-style timeline cards, a clear ✗ rewound / ✓ passed state on each card, collapsible diff and test output, and a layout that reads well at 1080p video and on mobile.
- [ ] **Step 4:** Run `npx vitest run`. Expected: all PASS.
- [ ] **Step 5:** Run `npm run dev` locally with a `.env` built from `.env.example`, then send a crafted signed webhook with curl. The fake garage is not wired into main, so just confirm 202 and that the job appears on `/`. Expected: the job is listed.
- [ ] **Step 6:** Commit with `git commit -m "feat: webhook server, family album, boot"`.

### Task 12: Deploy the brain and wire GitHub

**Files:** Create `scripts/deploy-brain.sh` and `README.md` (deploy section).

- [ ] **Step 1: `deploy-brain.sh`.** It runs `git archive HEAD | sprite exec -s uncle-brain --file -:/tmp/app.tar ...` (or uses `sprite file push`, following `SPIKE.md`), then extracts to `/app` and runs `npm ci`. It writes `/app/.env` from the local `.env.brain`, which is gitignored. It creates the service with `sprite-env services create uncle --cmd npx --args "tsx,src/main.ts" --dir /app --http-port 8080`, restarting it if it already exists, and runs `sprite url update -s uncle-brain --auth public`. The `acceptance/` directory ships with the brain but is never pushed to the demo repo.
- [ ] **Step 2:** Run the script. Expected: `curl https://<brain-url>/healthz` returns `ok`.
- [ ] **Step 3:** On the demo repo, add a webhook pointing at `https://<brain-url>/webhook`, with content type JSON, the secret set to `WEBHOOK_SECRET`, and only the "Issue comments" event selected. Expected: GitHub's ping delivery returns 204.
- [ ] **Step 4:** Commit with `git commit -m "chore: brain deploy script"`.

### Task 13: Demo repo, hidden tests, end-to-end run

**Files:** Create `demo/` (pushed to `<user>/uncle-demo-pantry`) and `acceptance/<user>__uncle-demo-pantry/`.

- [ ] **Step 1: Write the demo repo,** a small TypeScript "Thanksgiving pantry" library with vitest. Use `scaleRecipe(recipe, guests)` and `parseQuantity("1 1/2 cups")`. Include visible tests that pass for the main paths. Seed **two** bugs, each tracked by a GitHub issue that honestly describes the expected behavior:
  - **Issue A:** mixed fractions like `"2 3/4"` and unicode fractions like `"½"` parse wrong. The hidden tests cover both forms; the visible tests cover only the plain `"1/2"` case, so a first fix often misses unicode.
  - **Issue B:** scaling to 0 guests or a negative number of guests should throw `RangeError`, and scaled quantities should round to the nearest 1/8. The hidden tests check the 1/8 rounding.
- [ ] **Step 2: Hidden tests.** Put `acceptance/<user>__uncle-demo-pantry/test/hidden.test.ts` on the brain covering the full behavior of both issues. Locally, confirm the hidden tests fail against the seeded code and pass against a reference fix. Do **not** commit the reference fix anywhere Uncle can see it.
- [ ] **Step 3: End-to-end run.** Comment `@uncle fix this` on Issue A as the owner. Expected:
  - The webhook returns 202.
  - The album shows the timelines live.
  - At least one rewind happens (if t1 passes outright, make the hidden edge case harder and re-run).
  - A PR opens from the bot with a Family History section.
  - The PR diff contains no hidden test file.
  - Pinecone has one record per timeline.
- [ ] **Step 4: Cross-job memory.** Comment on Issue B. Expected: the ack comment references the Issue A disaster.
- [ ] **Step 5: Cost check.** Read the Fly dashboard usage, then append the actual cost per job and the projected weekly total to `SPIKE.md`. Expected: the projection is under $5. If it isn't, lower `MAX_TIMELINES` or `ATTEMPT_TIMEOUT_MS` and re-measure.
- [ ] **Step 6:** Commit with `git commit -m "feat: demo repo and hidden acceptance tests"`.

### Task 14: README, demo video, post, submit (done with the user)

- [ ] **Step 1: README.** Cover what Uncle is, the architecture diagram from spec §5, the connectors used and why there are no secrets on the box, any fallbacks taken from `SPIKE.md`, setup steps, and the hidden-test note.
- [ ] **Step 2: Record the demo** following spec §6 (2–3 minutes): introduce Uncle and the album, comment on Issue A, show the live album with the rewind, show the PR, show Issue B recalling the memory, then the closing card (2 Sprites, 3 connectors, 0 keys on the box, $0 while asleep). Do at most 2–3 full rehearsals per Claude Pro usage window. Keep the best real run.
- [ ] **Step 3:** The user posts on X, Bluesky, LinkedIn, or Reddit with the video and tags @flydotio.
- [ ] **Step 4:** The user submits the Google Form with the repo link, the demo link, and the one-sentence pitch. **Deadline: Mon Nov 30, 12:00 IST.**
- [ ] **Step 5 (stretch, only if time remains):** spec §9 items, in this order: `@uncle remember`, Box family archive, ElevenLabs voice note, multiverse mode.
