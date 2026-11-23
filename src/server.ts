import { Hono } from "hono";
import type { Config } from "./config.js";
import type { Db } from "./db.js";
import type { JobQueue } from "./queue.js";
import { verifySignature, parseTrigger } from "./webhook.js";
import { renderIndex, renderJob } from "./views/album.js";

type QueueLike = Pick<JobQueue, "enqueue" | "drain">;

export function createApp(d: { cfg: Config; db: Db; queue: QueueLike }): Hono {
  const app = new Hono();

  app.post("/webhook", async (c) => {
    const raw = await c.req.text();
    if (!verifySignature(d.cfg.webhookSecret, raw, c.req.header("x-hub-signature-256"))) {
      return c.json({ error: "bad signature" }, 401);
    }
    let payload: unknown;
    try { payload = JSON.parse(raw); } catch { return c.json({ error: "invalid JSON" }, 400); }
    const trigger = parseTrigger(c.req.header("x-github-event") ?? "", payload, d.cfg);
    if (!trigger) return c.body(null, 204);
    const result = await d.queue.enqueue(trigger);
    void d.queue.drain().catch((e) => console.error("[server] drain failed:", e));
    return c.json({ result }, 202);
  });

  app.get("/", (c) => c.html(renderIndex(d.db.listJobs())));

  app.get("/job/:id", (c) => {
    const job = d.db.getJob(c.req.param("id"));
    return job ? c.html(renderJob(job, d.db.timelines(job.id))) : c.text("No such job in the album.", 404);
  });

  app.get("/api/job/:id", (c) => {
    const job = d.db.getJob(c.req.param("id"));
    return job ? c.json({ job, timelines: d.db.timelines(job.id) }) : c.json({ error: "not found" }, 404);
  });

  app.get("/healthz", (c) => c.text("ok"));
  return app;
}

/** Boot-time recovery: jobs that were running when the brain stopped can't be resumed. */
export function boot(d: { db: Db; queue: QueueLike }): number {
  const n = d.db.markRunningAsInterrupted();
  if (n) console.warn(`[boot] marked ${n} running job(s) as interrupted`);
  void d.queue.drain().catch((e) => console.error("[boot] drain failed:", e));
  return n;
}
