import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { Trigger } from "./webhook.js";

export type JobStatus = "queued" | "running" | "passed" | "gave_up" | "no_tests" | "interrupted" | "error";
export type TimelineOutcome = "running" | "passed" | "failed";

export interface Job {
  id: string; commentId: number; repo: string; issueNumber: number; issueTitle: string; issueBody: string;
  status: JobStatus; testCommand: string | null; baseline: string | null; prUrl: string | null;
  createdAt: string; updatedAt: string;
}

export interface Timeline {
  jobId: string; n: number; outcome: TimelineOutcome; approach: string; quote: string;
  failReason: string | null; testTail: string; diff: string; durationMs: number;
}

const JOB_COLS: Record<keyof Job, string> = {
  id: "id", commentId: "comment_id", repo: "repo", issueNumber: "issue_number", issueTitle: "issue_title",
  issueBody: "issue_body", status: "status", testCommand: "test_command", baseline: "baseline",
  prUrl: "pr_url", createdAt: "created_at", updatedAt: "updated_at",
};
const TL_COLS: Record<keyof Timeline, string> = {
  jobId: "job_id", n: "n", outcome: "outcome", approach: "approach", quote: "quote",
  failReason: "fail_reason", testTail: "test_tail", diff: "diff", durationMs: "duration_ms",
};

function fromRow<T>(row: any, cols: Record<string, string>): T {
  const out: any = {};
  for (const [k, c] of Object.entries(cols)) out[k] = row[c];
  return out as T;
}

export class Db {
  private db: Database.Database;

  constructor(path: string) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.db = new Database(path);
    this.db.pragma("journal_mode = WAL");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS jobs (
        seq INTEGER PRIMARY KEY AUTOINCREMENT,
        id TEXT NOT NULL UNIQUE, comment_id INTEGER NOT NULL UNIQUE, repo TEXT NOT NULL,
        issue_number INTEGER NOT NULL, issue_title TEXT NOT NULL, issue_body TEXT NOT NULL,
        status TEXT NOT NULL, test_command TEXT, baseline TEXT, pr_url TEXT,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS timelines (
        job_id TEXT NOT NULL, n INTEGER NOT NULL, outcome TEXT NOT NULL, approach TEXT NOT NULL,
        quote TEXT NOT NULL, fail_reason TEXT, test_tail TEXT NOT NULL, diff TEXT NOT NULL,
        duration_ms INTEGER NOT NULL, PRIMARY KEY (job_id, n));
    `);
  }

  createJob(t: Trigger): Job | null {
    const now = new Date().toISOString();
    const id = randomUUID().slice(0, 8);
    const res = this.db.prepare(
      `INSERT INTO jobs (id, comment_id, repo, issue_number, issue_title, issue_body, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'queued', ?, ?) ON CONFLICT(comment_id) DO NOTHING`,
    ).run(id, t.commentId, t.repo, t.issueNumber, t.issueTitle, t.issueBody, now, now);
    return res.changes === 0 ? null : this.getJob(id);
  }

  getJob(id: string): Job | null {
    const row = this.db.prepare(`SELECT * FROM jobs WHERE id = ?`).get(id);
    return row ? fromRow<Job>(row, JOB_COLS) : null;
  }

  listJobs(limit = 50): Job[] {
    return this.db.prepare(`SELECT * FROM jobs ORDER BY seq DESC LIMIT ?`).all(limit).map((r) => fromRow<Job>(r, JOB_COLS));
  }

  updateJob(id: string, patch: Partial<Job>): void {
    const entries = Object.entries(patch).filter(([k]) => k !== "id" && k in JOB_COLS);
    if (!entries.length) return;
    const sets = entries.map(([k]) => `${JOB_COLS[k as keyof Job]} = ?`).join(", ");
    this.db.prepare(`UPDATE jobs SET ${sets}, updated_at = ? WHERE id = ?`)
      .run(...entries.map(([, v]) => v as any), new Date().toISOString(), id);
  }

  activeJobForIssue(repo: string, issueNumber: number): Job | null {
    const row = this.db.prepare(
      `SELECT * FROM jobs WHERE repo = ? AND issue_number = ? AND status IN ('queued','running') ORDER BY seq LIMIT 1`,
    ).get(repo, issueNumber);
    return row ? fromRow<Job>(row, JOB_COLS) : null;
  }

  nextQueued(): Job | null {
    const row = this.db.prepare(`SELECT * FROM jobs WHERE status = 'queued' ORDER BY seq LIMIT 1`).get();
    return row ? fromRow<Job>(row, JOB_COLS) : null;
  }

  markRunningAsInterrupted(): number {
    const now = new Date().toISOString();
    this.db.prepare(
      `UPDATE timelines SET outcome = 'failed', fail_reason = 'interrupted: the brain restarted'
       WHERE outcome = 'running' AND job_id IN (SELECT id FROM jobs WHERE status = 'running')`,
    ).run();
    return this.db.prepare(`UPDATE jobs SET status = 'interrupted', updated_at = ? WHERE status = 'running'`).run(now).changes;
  }

  addTimeline(t: Timeline): void {
    this.db.prepare(
      `INSERT INTO timelines (job_id, n, outcome, approach, quote, fail_reason, test_tail, diff, duration_ms)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(t.jobId, t.n, t.outcome, t.approach, t.quote, t.failReason, t.testTail, t.diff, t.durationMs);
  }

  updateTimeline(jobId: string, n: number, patch: Partial<Timeline>): void {
    const entries = Object.entries(patch).filter(([k]) => k !== "jobId" && k !== "n" && k in TL_COLS);
    if (!entries.length) return;
    const sets = entries.map(([k]) => `${TL_COLS[k as keyof Timeline]} = ?`).join(", ");
    this.db.prepare(`UPDATE timelines SET ${sets} WHERE job_id = ? AND n = ?`)
      .run(...entries.map(([, v]) => v as any), jobId, n);
    // The album polls the job's updated_at, so a timeline change must touch it.
    this.db.prepare(`UPDATE jobs SET updated_at = ? WHERE id = ?`).run(new Date().toISOString(), jobId);
  }

  timelines(jobId: string): Timeline[] {
    return this.db.prepare(`SELECT * FROM timelines WHERE job_id = ? ORDER BY n`).all(jobId)
      .map((r) => fromRow<Timeline>(r, TL_COLS));
  }
}
