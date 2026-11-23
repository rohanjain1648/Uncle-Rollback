import type { JobStatus } from "./db.js";
import { busyComment } from "./narrate.js";
import { runJob, type Deps } from "./runner.js";
import type { Trigger } from "./webhook.js";

export type EnqueueResult = "queued" | "duplicate" | "busy";

export class JobQueue {
  private draining: Promise<void> | null = null;

  constructor(private d: Deps, private run: (jobId: string, d: Deps) => Promise<JobStatus> = runJob) {}

  async enqueue(t: Trigger): Promise<EnqueueResult> {
    const active = this.d.db.activeJobForIssue(t.repo, t.issueNumber);
    if (active) {
      if (active.commentId === t.commentId) return "duplicate";
      await this.d.github.comment(t.repo, t.issueNumber, busyComment(active)).catch(() => {});
      return "busy";
    }
    return this.d.db.createJob(t) ? "queued" : "duplicate";
  }

  /** Run queued jobs one at a time. Concurrent callers share the same drain. */
  drain(): Promise<void> {
    if (!this.draining) {
      this.draining = (async () => {
        try {
          for (let job = this.d.db.nextQueued(); job; job = this.d.db.nextQueued()) {
            try {
              await this.run(job.id, this.d);
            } catch (e) {
              console.error(`[queue] job ${job.id} crashed:`, e);
            }
            const after = this.d.db.getJob(job.id);
            if (after?.status === "queued" || after?.status === "running") this.d.db.updateJob(job.id, { status: "error" });
          }
        } finally {
          this.draining = null;
        }
      })();
    }
    return this.draining;
  }
}
