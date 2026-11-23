import { describe, it, expect } from "vitest";
import { runJob } from "../src/runner.js";
import { FakeGarage, makeDeps, claudeJson } from "./fakes.js";
import type { Trigger } from "../src/webhook.js";

const trig: Trigger = { commentId: 42, repo: "alice/pantry", issueNumber: 7, issueTitle: "Fractions broken", issueBody: "½ fails", author: "alice" };

function setup(garage: FakeGarage) {
  const d = makeDeps({ garage } as any);
  const job = d.db.createJob(trig)!;
  return { d, job };
}

describe("runJob", () => {
  it("passes on timeline 1 without rewinding to t0", async () => {
    const { d, job } = setup(new FakeGarage([{ suitePass: true }]));
    expect(await runJob(job.id, d)).toBe("passed");
    expect(d.garage.restores).toEqual(["v-clean"]);
    expect(d.github.pulls).toHaveLength(1);
    const pr = d.github.pulls[0];
    expect(pr.branch).toBe("uncle/issue-7");
    expect(pr.files.map((f) => f.path)).toEqual(["src/parse.ts"]);
    expect(pr.files.some((f) => f.path.includes("hidden"))).toBe(false);
    expect(pr.body).toContain("## Family History");
    expect(d.memory.records.map((r) => r.outcome)).toEqual(["passed"]);
    const j = d.db.getJob(job.id)!;
    expect(j.status).toBe("passed");
    expect(j.prUrl).toBe("https://github.com/alice/pantry/pull/9");
    expect(j.testCommand).toBe("npm test");
    expect(j.baseline).toContain("baseline: 2 failing");
    expect(d.github.reactions).toEqual(["eyes", "rocket"]);
  });

  it("rewinds a failed timeline and feeds it to the next prompt", async () => {
    const { d, job } = setup(new FakeGarage([
      { claudeOut: claudeJson("split on spaces"), suitePass: false },
      { claudeOut: claudeJson("normalize unicode"), suitePass: true },
    ]));
    expect(await runJob(job.id, d)).toBe("passed");
    expect(d.garage.restores).toEqual(["v-clean", "v-t0-" + job.id]);
    expect(d.memory.records).toHaveLength(2);
    expect(d.memory.records[0]).toMatchObject({ id: `${job.id}-t1`, timeline: 1, outcome: "failed", job_id: job.id, repo: "alice/pantry", issue: 7 });
    const prompts = d.garage.writes.filter((w) => w.path === "/work/prompt.txt");
    expect(prompts).toHaveLength(2);
    expect(prompts[1].content).toContain("split on spaces");
    expect(prompts[1].content).toContain("tests failed");
    expect(d.github.pulls[0].body).toMatch(/Timeline 1.*split on spaces/);
    const tls = d.db.timelines(job.id);
    expect(tls.map((t) => t.outcome)).toEqual(["failed", "passed"]);
    expect(tls[0].diff).toContain("attempt 1");
    expect(tls[0].testTail).toContain("attempt 1: 1 failing");
  });

  it("gives up after maxTimelines failures", async () => {
    const { d, job } = setup(new FakeGarage([{}, {}, {}]));
    expect(await runJob(job.id, d)).toBe("gave_up");
    expect(d.garage.restores.filter((r) => r.startsWith("v-t0"))).toHaveLength(3);
    expect(d.github.pulls).toHaveLength(0);
    expect(d.memory.records).toHaveLength(3);
    expect(d.github.comments.at(-1)!.body).toMatch(/gave issue #7 3 timelines/);
    expect(d.github.reactions.at(-1)).toBe("confused");
    expect(d.db.getJob(job.id)!.status).toBe("gave_up");
  });

  it("fails a timeline that edits test files and never runs hidden tests for it", async () => {
    const { d, job } = setup(new FakeGarage([
      { changed: [{ path: "src/parse.ts", deleted: false }, { path: "test/parse.test.ts", deleted: false }], suitePass: true },
      { suitePass: true },
    ]));
    await runJob(job.id, d);
    const t1 = d.db.timelines(job.id)[0];
    expect(t1.outcome).toBe("failed");
    expect(t1.failReason).toMatch(/tried to change the rules/);
    const hiddenWrites = d.garage.writes.filter((w) => w.path.endsWith("hidden.test.ts"));
    expect(hiddenWrites).toHaveLength(1); // only timeline 2
  });

  it("treats a Claude timeout as a failed timeline and continues", async () => {
    const { d, job } = setup(new FakeGarage([{ timedOut: true, claudeExit: 124 }, { suitePass: true }]));
    expect(await runJob(job.id, d)).toBe("passed");
    expect(d.db.timelines(job.id)[0].failReason).toMatch(/ran out of time/);
  });

  it("treats non-JSON Claude output as a failed timeline and continues", async () => {
    const { d, job } = setup(new FakeGarage([{ claudeOut: "segfault" }, { suitePass: true }]));
    expect(await runJob(job.id, d)).toBe("passed");
    expect(d.db.timelines(job.id)[0].failReason).toMatch(/not JSON/);
  });

  it("treats a non-zero Claude exit as a failed timeline", async () => {
    const { d, job } = setup(new FakeGarage([{ claudeExit: 1 }, { suitePass: true }]));
    await runJob(job.id, d);
    expect(d.db.timelines(job.id)[0].failReason).toMatch(/exited with code 1/);
  });

  it("ends as no_tests when no test command is detectable", async () => {
    const g = new FakeGarage([{ suitePass: true }]);
    g.packageJson = null;
    const { d, job } = setup(g);
    expect(await runJob(job.id, d)).toBe("no_tests");
    expect(d.github.comments.at(-1)!.body).toMatch(/No tests/);
    expect(d.garage.writes.some((w) => w.path === "/work/prompt.txt")).toBe(false);
  });

  it("writes hidden tests only after Claude exits", async () => {
    const { d } = setup(new FakeGarage([{ suitePass: true }]));
    const job = d.db.listJobs()[0];
    await runJob(job.id, d);
    const ev = d.garage.events;
    const iPrompt = ev.indexOf("write:/work/prompt.txt");
    const iClaude = ev.lastIndexOf("exec:cat /work/claude-exit");
    const iHidden = ev.indexOf("write:/work/repo/test/hidden.test.ts");
    expect(iPrompt).toBeGreaterThan(-1);
    expect(iPrompt).toBeLessThan(iClaude);
    expect(iClaude).toBeLessThan(iHidden);
  });

  it("passes lore from memory into the ack comment and prompt", async () => {
    const { d, job } = setup(new FakeGarage([{ suitePass: true }]));
    d.memory.lore = [{ id: "old-t2", text: "Timeline 2: I deleted the parser entirely; tests failed", repo: "alice/pantry", issue: 3, job_id: "old", timeline: 2, outcome: "failed", created_at: "2026-11-23T00:00:00Z" }];
    await runJob(job.id, d);
    expect(d.github.comments[0].body).toMatch(/last time/i);
    expect(d.garage.writes.find((w) => w.path === "/work/prompt.txt")!.content).toContain("I deleted the parser entirely");
  });

  it("installs dependencies and tags the base before the baseline run", async () => {
    const { d, job } = setup(new FakeGarage([{ suitePass: true }]));
    await runJob(job.id, d);
    const ev = d.garage.events;
    const iInstall = ev.findIndex((e) => e.includes("npm ci"));
    const iTag = ev.findIndex((e) => e.includes("git tag -f uncle-base"));
    const iBaseline = ev.findIndex((e) => e.includes("npm test"));
    expect(iInstall).toBeGreaterThan(-1);
    expect(iInstall).toBeLessThanOrEqual(iTag);
    expect(iTag).toBeLessThan(iBaseline);
  });

  it("runs Claude detached and polls for its exit code", async () => {
    const { d, job } = setup(new FakeGarage([{ suitePass: true }]));
    await runJob(job.id, d);
    expect(d.garage.events.some((e) => e.includes("setsid") && e.includes("run-claude.sh"))).toBe(true);
    expect(d.garage.events).toContain("exec:cat /work/claude-exit");
  });

  it("kills and fails a Claude run that never reports an exit code", async () => {
    const { d, job } = setup(new FakeGarage([{ hang: true }, { suitePass: true }]));
    expect(await runJob(job.id, d)).toBe("passed");
    expect(d.db.timelines(job.id)[0].failReason).toMatch(/ran out of time/);
    expect(d.garage.events.some((e) => e.includes("pkill"))).toBe(true);
  });

  it("fails a timeline that changes nothing without running hidden tests", async () => {
    const { d, job } = setup(new FakeGarage([{ changed: [], suitePass: true }, { suitePass: true }]));
    await runJob(job.id, d);
    expect(d.db.timelines(job.id)[0].failReason).toMatch(/changed nothing/);
    expect(d.garage.writes.filter((w) => w.path.endsWith("hidden.test.ts"))).toHaveLength(1);
  });

  it("ends in error without opening a PR when a changed file cannot be read", async () => {
    const g = new FakeGarage([{ suitePass: true }]);
    g.unreadable.add("src/parse.ts");
    const { d, job } = setup(g);
    expect(await runJob(job.id, d)).toBe("error");
    expect(d.github.pulls).toHaveLength(0);
  });

  it("keeps passed and the PR link when GitHub comments fail", async () => {
    const { d, job } = setup(new FakeGarage([{ suitePass: true }]));
    d.github.failComments = true;
    expect(await runJob(job.id, d)).toBe("passed");
    const j = d.db.getJob(job.id)!;
    expect(j.status).toBe("passed");
    expect(j.prUrl).toBe("https://github.com/alice/pantry/pull/9");
  });

  it("marks the job as error and resolves when the garage throws", async () => {
    const g = new FakeGarage();
    g.failFetch = true;
    const { d, job } = setup(g);
    await expect(runJob(job.id, d)).resolves.toBe("error");
    expect(d.db.getJob(job.id)!.status).toBe("error");
    expect(d.github.comments.at(-1)!.body).toMatch(/garage is on fire/);
  });
});
