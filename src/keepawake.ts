import { request } from "node:http";
import type { JobStatus } from "./db.js";
import type { Deps } from "./runner.js";

export interface TasksClient {
  hold(name: string, expire: string): Promise<void>;
  release(name: string): Promise<void>;
}

/** Sprite Tasks API over /.sprite/api.sock (virtual host `sprite`). A task keeps the Sprite awake for up to 1h. */
export function socketTasks(socketPath = "/.sprite/api.sock"): TasksClient {
  const call = (method: string, path: string, body?: unknown) =>
    new Promise<void>((resolve, reject) => {
      const data = body === undefined ? undefined : JSON.stringify(body);
      const req = request({ socketPath, method, path, headers: { Host: "sprite", "Content-Type": "application/json" } }, (res) => {
        res.resume();
        res.on("end", () => ((res.statusCode ?? 500) < 400 || res.statusCode === 404 ? resolve() : reject(new Error(`tasks ${method} ${res.statusCode}`))));
      });
      req.on("error", reject);
      req.end(data);
    });
  return {
    hold: (name, expire) => call("PUT", "/v1/tasks", { name, expire }),
    release: (name) => call("DELETE", `/v1/tasks/${encodeURIComponent(name)}`),
  };
}

type Run = (jobId: string, d: Deps) => Promise<JobStatus>;

/** Wrap a job runner so the brain Sprite stays awake while a job runs. Task API failures never fail the job. */
export function withKeepAwake(run: Run, tasks: TasksClient, renewMs = 50 * 60_000): Run {
  return async (jobId, d) => {
    const name = `uncle-job-${jobId}`;
    const hold = () => tasks.hold(name, "1h").catch((e) => console.warn("[keepawake] hold failed:", e.message));
    await hold();
    const timer = setInterval(hold, renewMs);
    try {
      return await run(jobId, d);
    } finally {
      clearInterval(timer);
      await tasks.release(name).catch((e) => console.warn("[keepawake] release failed:", e.message));
    }
  };
}
