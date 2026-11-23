import { createHmac, timingSafeEqual } from "node:crypto";
import type { Config } from "./config.js";

export interface Trigger {
  commentId: number;
  repo: string;
  issueNumber: number;
  issueTitle: string;
  issueBody: string;
  author: string;
}

export function verifySignature(secret: string, rawBody: string, header: string | undefined): boolean {
  if (!header || !header.startsWith("sha256=")) return false;
  const expected = Buffer.from(
    "sha256=" + createHmac("sha256", secret).update(rawBody).digest("hex"),
  );
  const given = Buffer.from(header);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

export function parseTrigger(event: string, payload: any, cfg: Config): Trigger | null {
  if (event !== "issue_comment" || payload?.action !== "created") return null;
  const comment = payload.comment;
  const issue = payload.issue;
  const repo = String(payload.repository?.full_name ?? "").toLowerCase();
  const author = String(comment?.user?.login ?? "").toLowerCase();
  if (!comment || !issue || !repo || !author) return null;
  if (issue.pull_request) return null;
  if (author === cfg.botLogin) return null;
  if (!cfg.ownerAllowlist.includes(author)) return null;
  if (!cfg.repoAllowlist.includes(repo)) return null;
  if (!/@uncle\b/i.test(String(comment.body ?? ""))) return null;
  return {
    commentId: Number(comment.id),
    repo,
    issueNumber: Number(issue.number),
    issueTitle: String(issue.title ?? ""),
    issueBody: String(issue.body ?? ""),
    author,
  };
}
