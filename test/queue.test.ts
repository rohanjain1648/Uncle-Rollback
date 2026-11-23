import { describe, it, expect } from "vitest";
import { JobQueue } from "../src/queue.js";
import { makeDeps } from "./fakes.js";
import type { Trigger } from "../src/webhook.js";
import type { JobStatus } from "../src/db.js";

const trig = (over: Partial<Trigger> = {}): Trigger => ({
  commentId: 1, repo: "alice/pantry", issueNumber: 7, issueTitle: "t", issueBody: "", author: "alice", ...over,
});

describe("JobQueue", () => {
  it("dedupes redelivered comments", async () => {
    const d = makeDeps();
    const q = new JobQueue(d, async () => "passed");
    expect(await q.enqueue(trig())).toBe("queued");
    expect(await q.enqueue(trig())).toBe("duplicate");
    expect(d.github.comments).toHaveLength(0);
  });

  it("replies busy to a second comment on an issue with an active job", async () => {
    const d = makeDeps();
    const q = new JobQueue(d, async () => "passed");
    await q.enqueue(trig({ commentId: 1 }));
    expect(await q.enqueue(trig({ commentId: 2 }))).toBe("busy");
    expect(d.github.comments).toHaveLength(1);
    expect(d.github.comments[0].body).toMatch(/already/);
    expect(d.db.listJobs()).toHaveLength(1);
  });

  it("drains queued jobs one at a time", async () => {
    const d = makeDeps();
    const log: string[] = [];
    const run = async (id: string): Promise<JobStatus> => {
      log.push(`start ${id}`);
      await new Promise((r) => setTimeout(r, 10));
      d.db.updateJob(id, { status: "passed" });
      log.push(`end ${id}`);
      return "passed";
    };
    const q = new JobQueue(d, run);
    await q.enqueue(trig({ commentId: 1, issueNumber: 1 }));
    await q.enqueue(trig({ commentId: 2, issueNumber: 2 }));
    const [a, b] = d.db.listJobs().reverse().map((j) => j.id);
    await Promise.all([q.drain(), q.drain()]);
    expect(log).toEqual([`start ${a}`, `end ${a}`, `start ${b}`, `end ${b}`]);
  });

  it("runs jobs enqueued after an earlier drain found the queue empty", async () => {
    const d = makeDeps();
    const ran: string[] = [];
    const q = new JobQueue(d, async (id) => { ran.push(id); d.db.updateJob(id, { status: "passed" }); return "passed"; });
    await q.drain(); // boot-time drain on an empty queue
    await q.enqueue(trig({ commentId: 5 }));
    await q.drain();
    expect(ran).toHaveLength(1);
  });

  it("keeps draining after a runner rejects", async () => {
    const d = makeDeps();
    let calls = 0;
    const q = new JobQueue(d, async (id) => {
      calls++;
      d.db.updateJob(id, { status: "error" });
      if (calls === 1) throw new Error("boom");
      return "passed";
    });
    await q.enqueue(trig({ commentId: 1, issueNumber: 1 }));
    await q.enqueue(trig({ commentId: 2, issueNumber: 2 }));
    await q.drain();
    expect(calls).toBe(2);
  });
});
