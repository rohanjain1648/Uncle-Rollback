import type { Config } from "./config.js";
import type { Db, JobStatus, Timeline } from "./db.js";
import type { Garage } from "./garage.js";
import type { GitHub, FileChange } from "./github.js";
import type { Memory } from "./memory.js";
import {
  type Narrator, ackComment, noTestsComment, giveUpComment, prBody, prComment, errorComment, albumUrl,
} from "./narrate.js";
import { buildAttemptPrompt, parseAttemptOutput } from "./prompt.js";
import { REPO_DIR, fetchRepo, probeRepo, detectTestCommand, changedFiles, testFilesChanged } from "./repo.js";

export interface Deps {
  cfg: Config;
  db: Db;
  garage: Garage;
  github: GitHub;
  memory: Memory;
  narrator: Narrator;
  readAcceptance(repo: string): Promise<{ path: string; content: string }[]>;
  now(): number;
}

export const CLAUDE_RUNNER = "/root/.uncle/run-claude.sh";
const tail = (s: string, n = 40) => s.split("\n").slice(-n).join("\n");
const sh = (script: string) => ["bash", "-c", script];

async function runTests(d: Deps, cmd: string) {
  const r = await d.garage.exec(sh(`cd ${REPO_DIR} && ${cmd} 2>&1`), { timeoutMs: d.cfg.attemptTimeoutMs });
  return { pass: r.exitCode === 0 && !r.timedOut, out: tail(`${r.stdout}${r.stderr}`) };
}

async function say(d: Deps, repo: string, issue: number, text: string) {
  await d.github.comment(repo, issue, await d.narrator.polish(text).catch(() => text));
}

export async function runJob(jobId: string, d: Deps): Promise<JobStatus> {
  const job = d.db.getJob(jobId);
  if (!job) throw new Error(`job ${jobId} not found`);
  const { repo, issueNumber } = job;
  const album = albumUrl(d.cfg, jobId);
  let current: number | null = null;

  try {
    d.db.updateJob(jobId, { status: "running" });
    await d.github.react(repo, job.commentId, "eyes").catch(() => {});

    const clean = await d.garage.findCheckpoint("garage-clean");
    if (!clean) throw new Error("garage-clean checkpoint is missing");
    await d.garage.restore(clean);
    await fetchRepo(d.garage, d.cfg, repo);
    const testCommand = detectTestCommand(await probeRepo(d.garage));
    if (!testCommand) {
      await say(d, repo, issueNumber, noTestsComment());
      d.db.updateJob(jobId, { status: "no_tests" });
      return "no_tests";
    }
    const baseline = await runTests(d, testCommand);
    d.db.updateJob(jobId, { testCommand, baseline: baseline.out });
    const t0 = await d.garage.checkpoint(`t0-${jobId}`);

    const lore = await d.memory.recallForRepo(repo, `${job.issueTitle} ${job.issueBody}`, d.cfg.recallTopK);
    await say(d, repo, issueNumber, ackComment(job, lore));
    const acceptance = await d.readAcceptance(repo);
    const acceptancePaths = new Set(acceptance.map((a) => a.path));

    for (let n = 1; n <= d.cfg.maxTimelines; n++) {
      current = n;
      const started = d.now();
      d.db.addTimeline({ jobId, n, outcome: "running", approach: "", quote: "", failReason: null, testTail: "", diff: "", durationMs: 0 });
      const failed = d.db.timelines(jobId).filter((t) => t.outcome === "failed");
      await d.garage.writeFile("/work/prompt.txt", buildAttemptPrompt({
        issueTitle: job.issueTitle,
        issueBody: job.issueBody,
        testCommand,
        lore: lore.map((r) => `Issue #${r.issue}, timeline ${r.timeline}: ${r.text}`),
        failedTimelines: failed.map((t) => ({ n: t.n, approach: t.approach, failReason: t.failReason ?? "unknown" })),
      }));

      const timeoutSec = Math.floor(d.cfg.attemptTimeoutMs / 1000);
      const claude = await d.garage.exec([CLAUDE_RUNNER, String(timeoutSec)], { timeoutMs: d.cfg.attemptTimeoutMs + 30_000 });
      const parsed = parseAttemptOutput((await d.garage.exec(["cat", "/work/claude-out.json"])).stdout);
      const changed = await changedFiles(d.garage);
      const diff = (await d.garage.exec(sh(`cd ${REPO_DIR} && git add -A && git diff --cached`))).stdout;

      let failReason: string | null = null;
      let testTail = "";
      const rulesBroken = testFilesChanged(changed);
      if (claude.timedOut) failReason = "ran out of time";
      else if (claude.exitCode !== 0) failReason = `Claude exited with code ${claude.exitCode}`;
      else if ("error" in parsed) failReason = parsed.error;
      else if (rulesBroken.length) failReason = `tried to change the rules (edited ${rulesBroken.join(", ")})`;
      else {
        for (const a of acceptance) await d.garage.writeFile(`${REPO_DIR}/${a.path}`, a.content);
        const suite = await runTests(d, testCommand);
        testTail = suite.out;
        if (!suite.pass) failReason = "tests failed";
      }

      const approach = "error" in parsed ? "(Uncle left no notes)" : parsed.approach;
      const quote = "error" in parsed ? "" : parsed.quote;
      const outcome = failReason ? "failed" : "passed";
      const patch: Partial<Timeline> = { outcome, approach, quote, failReason, testTail, diff, durationMs: d.now() - started };
      d.db.updateTimeline(jobId, n, patch);
      await d.memory.remember({
        id: `${jobId}-t${n}`,
        text: `Timeline ${n} of issue #${issueNumber} "${job.issueTitle}": ${approach}. ` +
          (failReason ? `Rewound because: ${failReason}.` : "It worked.") + (quote ? ` Uncle said: "${quote}"` : ""),
        repo, issue: issueNumber, job_id: jobId, timeline: n, outcome, created_at: new Date(d.now()).toISOString(),
      });

      if (!failReason) {
        const files: FileChange[] = [];
        for (const c of changed) {
          if (acceptancePaths.has(c.path)) continue;
          files.push({ path: c.path, content: c.deleted ? null : (await d.garage.exec(["cat", `${REPO_DIR}/${c.path}`])).stdout });
        }
        const tls = d.db.timelines(jobId);
        const base = await d.github.defaultBranch(repo);
        const title = `Uncle fixes #${issueNumber}: ${job.issueTitle}`;
        const body = await d.narrator.polish(prBody(job, tls, album)).catch(() => prBody(job, tls, album));
        const prUrl = await d.github.createPullFromFiles(repo, base, `uncle/issue-${issueNumber}`, files, title, body);
        await say(d, repo, issueNumber, prComment(prUrl, album));
        await d.github.react(repo, job.commentId, "rocket").catch(() => {});
        d.db.updateJob(jobId, { status: "passed", prUrl });
        return "passed";
      }
      await d.garage.restore(t0);
    }

    current = null;
    await say(d, repo, issueNumber, giveUpComment(job, d.db.timelines(jobId), album));
    await d.github.react(repo, job.commentId, "confused").catch(() => {});
    d.db.updateJob(jobId, { status: "gave_up" });
    return "gave_up";
  } catch (e) {
    console.error(`[runner] job ${jobId} failed:`, e);
    if (current !== null) d.db.updateTimeline(jobId, current, { outcome: "failed", failReason: `garage error: ${(e as Error).message}` });
    d.db.updateJob(jobId, { status: "error" });
    await d.github.comment(repo, issueNumber, errorComment()).catch(() => {});
    return "error";
  }
}
