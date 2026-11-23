// Renders the album with sample data to static HTML files, for design review.
import { writeFileSync, mkdirSync } from "node:fs";
import { renderIndex, renderJob } from "../src/views/album.js";
import type { Job, Timeline } from "../src/db.js";

const out = process.argv[2] ?? "preview";
mkdirSync(out, { recursive: true });
const job: Job = {
  id: "7e213394", commentId: 1, repo: "rohan/uncle-demo-pantry", issueNumber: 1,
  issueTitle: "parseQuantity breaks on mixed and unicode fractions", issueBody: "",
  status: "passed", testCommand: "npm test", prUrl: "https://github.com/rohan/uncle-demo-pantry/pull/2",
  baseline: " ✓ parses plain numbers\n ✓ parses 1/2\n × parses 2 3/4 (expected 2.75, got NaN)\n\n Tests  1 failed | 2 passed",
  createdAt: "2026-11-27T10:12:00.000Z", updatedAt: "",
};
const diff = (n: number) => `diff --git a/src/parse.ts b/src/parse.ts\n@@ -1,8 +1,14 @@\n-export function parseQuantity(s: string) {\n-  return Number(s.split(" ")[0]);\n+const UNICODE: Record<string, number> = { "½": 0.5, "¼": 0.25 };\n+export function parseQuantity(s: string) {\n+  // attempt ${n}\n+  const [whole, frac] = s.trim().split(/\s+/);`;
const tls: Timeline[] = [
  { jobId: job.id, n: 1, outcome: "failed", approach: "Split on spaces and summed the parts", quote: "In my day we didn't have fractions, we had whole potatoes.", failReason: "tests failed", testTail: " × parses ½ cup", diff: diff(1), durationMs: 142000 },
  { jobId: job.id, n: 2, outcome: "failed", approach: "Rewrote the parser as one giant regex", quote: "That regex was beautiful. The universe wasn't ready.", failReason: "tried to change the rules (edited test/parse.test.ts)", testTail: "", diff: diff(2), durationMs: 201000 },
  { jobId: job.id, n: 3, outcome: "passed", approach: "Normalized unicode fractions first, then parsed whole + fraction", quote: "Told you, nephew. Third time's the timeline.", failReason: null, testTail: " Tests  9 passed", diff: diff(3), durationMs: 175000 },
];
writeFileSync(`${out}/job.html`, renderJob(job, tls));
writeFileSync(`${out}/index.html`, renderIndex([job, { ...job, id: "aa11bb22", issueNumber: 2, issueTitle: "Scaling to zero guests should throw", status: "running" }, { ...job, id: "cc33dd44", issueNumber: 3, issueTitle: "Round to the nearest eighth", status: "gave_up" }]));
console.log(`wrote ${out}/job.html and ${out}/index.html`);
