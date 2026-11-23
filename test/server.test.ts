import { describe, it, expect } from "vitest";
import { createHmac } from "node:crypto";
import { createApp, boot } from "../src/server.js";
import { Db } from "../src/db.js";
import { testConfig } from "./helpers.js";
import type { Trigger } from "../src/webhook.js";

const cfg = testConfig();
const sign = (body: string) => "sha256=" + createHmac("sha256", "s3cret").update(body).digest("hex");

function fakeQueue() {
  const q = { enqueued: [] as Trigger[], drains: 0,
    async enqueue(t: Trigger) { q.enqueued.push(t); return "queued" as const; },
    async drain() { q.drains++; } };
  return q;
}

const comment = JSON.stringify({
  action: "created",
  comment: { id: 42, body: "@uncle fix this", user: { login: "alice" } },
  issue: { number: 7, title: "Fractions", body: "", user: { login: "alice" } },
  repository: { full_name: "alice/pantry" },
});

function post(app: any, body: string, headers: Record<string, string>) {
  return app.request("/webhook", { method: "POST", body, headers: { "content-type": "application/json", ...headers } });
}

describe("server", () => {
  it("rejects a bad signature with 401", async () => {
    const q = fakeQueue();
    const app = createApp({ cfg, db: new Db(":memory:"), queue: q });
    const res = await post(app, comment, { "x-github-event": "issue_comment", "x-hub-signature-256": "sha256=" + "0".repeat(64) });
    expect(res.status).toBe(401);
    expect(q.enqueued).toHaveLength(0);
  });

  it("returns 204 for ignored events (incl. GitHub ping)", async () => {
    const q = fakeQueue();
    const app = createApp({ cfg, db: new Db(":memory:"), queue: q });
    const ping = JSON.stringify({ zen: "hi" });
    const res = await post(app, ping, { "x-github-event": "ping", "x-hub-signature-256": sign(ping) });
    expect(res.status).toBe(204);
  });

  it("accepts a valid trigger with 202, enqueues once and starts a drain", async () => {
    const q = fakeQueue();
    const app = createApp({ cfg, db: new Db(":memory:"), queue: q });
    const res = await post(app, comment, { "x-github-event": "issue_comment", "x-hub-signature-256": sign(comment) });
    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ result: "queued" });
    expect(q.enqueued).toHaveLength(1);
    expect(q.enqueued[0].commentId).toBe(42);
    expect(q.drains).toBe(1);
  });

  it("renders a job's timelines, marks rewinds and escapes issue text", async () => {
    const db = new Db(":memory:");
    const job = db.createJob({ commentId: 1, repo: "alice/pantry", issueNumber: 7, issueTitle: "<script>alert(1)</script>", issueBody: "", author: "alice" })!;
    const base = { jobId: job.id, approach: "a", failReason: null, testTail: "", diff: "", durationMs: 1000 };
    db.addTimeline({ ...base, n: 1, outcome: "failed", quote: "That never happened.", failReason: "tests failed" });
    db.addTimeline({ ...base, n: 2, outcome: "passed", quote: "Told you, nephew." });
    const app = createApp({ cfg, db, queue: fakeQueue() });
    const res = await app.request(`/job/${job.id}`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("That never happened.");
    expect(html).toContain("Told you, nephew.");
    expect(html.toLowerCase()).toContain("rewound");
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("serves job JSON and 404s unknown ids", async () => {
    const db = new Db(":memory:");
    const job = db.createJob({ commentId: 1, repo: "alice/pantry", issueNumber: 7, issueTitle: "t", issueBody: "", author: "alice" })!;
    const app = createApp({ cfg, db, queue: fakeQueue() });
    const ok = await app.request(`/api/job/${job.id}`);
    expect((await ok.json()).job.id).toBe(job.id);
    expect((await app.request("/api/job/nope")).status).toBe(404);
    expect((await app.request("/job/nope")).status).toBe(404);
    expect(await (await app.request("/healthz")).text()).toBe("ok");
  });

  it("boot marks running jobs interrupted, lists them, and drains the queue", async () => {
    const db = new Db(":memory:");
    const job = db.createJob({ commentId: 1, repo: "alice/pantry", issueNumber: 7, issueTitle: "Stuck job", issueBody: "", author: "alice" })!;
    db.updateJob(job.id, { status: "running" });
    const q = fakeQueue();
    expect(boot({ db, queue: q })).toBe(1);
    expect(db.getJob(job.id)!.status).toBe("interrupted");
    expect(q.drains).toBe(1);
    const html = await (await createApp({ cfg, db, queue: q }).request("/")).text();
    expect(html).toContain("Stuck job");
    expect(html.toLowerCase()).toContain("interrupted");
  });
});
