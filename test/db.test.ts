import { describe, it, expect, beforeEach } from "vitest";
import { Db } from "../src/db.js";
import type { Trigger } from "../src/webhook.js";

const trig = (over: Partial<Trigger> = {}): Trigger => ({
  commentId: 1, repo: "alice/pantry", issueNumber: 7, issueTitle: "t", issueBody: "b", author: "alice", ...over,
});

describe("Db", () => {
  let db: Db;
  beforeEach(() => { db = new Db(":memory:"); });

  it("dedupes jobs by comment id", () => {
    const j = db.createJob(trig());
    expect(j?.status).toBe("queued");
    expect(j?.id).toMatch(/^[0-9a-f]{8}$/);
    expect(db.createJob(trig())).toBeNull();
  });

  it("finds the active job for an issue until it finishes", () => {
    const j = db.createJob(trig())!;
    expect(db.activeJobForIssue("alice/pantry", 7)?.id).toBe(j.id);
    db.updateJob(j.id, { status: "running" });
    expect(db.activeJobForIssue("alice/pantry", 7)?.id).toBe(j.id);
    db.updateJob(j.id, { status: "passed", prUrl: "https://pr" });
    expect(db.activeJobForIssue("alice/pantry", 7)).toBeNull();
    expect(db.getJob(j.id)?.prUrl).toBe("https://pr");
  });

  it("returns the oldest queued job first", () => {
    const a = db.createJob(trig({ commentId: 1 }))!;
    db.createJob(trig({ commentId: 2, issueNumber: 8 }));
    expect(db.nextQueued()?.id).toBe(a.id);
    db.updateJob(a.id, { status: "running" });
    expect(db.nextQueued()?.commentId).toBe(2);
  });

  it("marks only running jobs as interrupted", () => {
    const a = db.createJob(trig({ commentId: 1 }))!;
    const b = db.createJob(trig({ commentId: 2 }))!;
    db.updateJob(a.id, { status: "running" });
    expect(db.markRunningAsInterrupted()).toBe(1);
    expect(db.getJob(a.id)?.status).toBe("interrupted");
    expect(db.getJob(b.id)?.status).toBe("queued");
  });

  it("bumps the job's updatedAt when a timeline changes (album polling)", async () => {
    const j = db.createJob(trig())!;
    db.addTimeline({ jobId: j.id, n: 1, outcome: "running", approach: "", quote: "", failReason: null, testTail: "", diff: "", durationMs: 0 });
    const before = db.getJob(j.id)!.updatedAt;
    await new Promise((r) => setTimeout(r, 5));
    db.updateTimeline(j.id, 1, { outcome: "failed" });
    expect(db.getJob(j.id)!.updatedAt > before).toBe(true);
  });

  it("fails running timelines of interrupted jobs", () => {
    const j = db.createJob(trig())!;
    db.updateJob(j.id, { status: "running" });
    db.addTimeline({ jobId: j.id, n: 1, outcome: "running", approach: "", quote: "", failReason: null, testTail: "", diff: "", durationMs: 0 });
    db.markRunningAsInterrupted();
    expect(db.timelines(j.id)[0]).toMatchObject({ outcome: "failed", failReason: "interrupted: the brain restarted" });
  });

  it("stores and orders timelines and lists jobs newest first", () => {
    const j = db.createJob(trig())!;
    const tl = { jobId: j.id, outcome: "running" as const, approach: "", quote: "", failReason: null, testTail: "", diff: "", durationMs: 0 };
    db.addTimeline({ ...tl, n: 2 });
    db.addTimeline({ ...tl, n: 1 });
    db.updateTimeline(j.id, 1, { outcome: "failed", failReason: "tests failed" });
    const tls = db.timelines(j.id);
    expect(tls.map((t) => t.n)).toEqual([1, 2]);
    expect(tls[0].outcome).toBe("failed");
    expect(tls[0].failReason).toBe("tests failed");
    db.createJob(trig({ commentId: 9 }));
    expect(db.listJobs()[0].commentId).toBe(9);
    expect(db.getJob("nope")).toBeNull();
  });
});
