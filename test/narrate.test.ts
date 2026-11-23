import { describe, it, expect } from "vitest";
import { ackComment, busyComment, noTestsComment, giveUpComment, prBody, prComment, albumUrl, IdentityNarrator } from "../src/narrate.js";
import type { Job, Timeline } from "../src/db.js";
import type { MemoryRecord } from "../src/memory.js";
import { testConfig } from "./helpers.js";

const job: Job = {
  id: "abc12345", commentId: 1, repo: "alice/pantry", issueNumber: 7, issueTitle: "Fractions broken", issueBody: "",
  status: "running", testCommand: "npm test", baseline: null, prUrl: null, createdAt: "", updatedAt: "",
};
const tl = (n: number, outcome: Timeline["outcome"], approach: string, failReason: string | null, quote = `quote ${n}`): Timeline => ({
  jobId: job.id, n, outcome, approach, quote, failReason, testTail: "", diff: "", durationMs: 1000,
});
const ALBUM = "https://brain.example/job/abc12345";

describe("narration", () => {
  it("albumUrl builds the job page url", () => {
    expect(albumUrl(testConfig(), "abc12345")).toBe(ALBUM);
  });

  it("prBody fixes the issue and records family history", () => {
    const tls = [
      tl(1, "failed", "split on spaces", "tests failed"),
      tl(2, "failed", "regex everything", "tried to change the rules"),
      tl(3, "passed", "normalize unicode then parse", null, "Told you, nephew."),
    ];
    const b = prBody(job, tls, ALBUM);
    expect(b).toContain("Fixes #7");
    expect(b).toContain("## Family History");
    expect(b).toMatch(/Timeline 1.*split on spaces.*tests failed/);
    expect(b).toMatch(/Timeline 2.*regex everything.*tried to change the rules/);
    expect(b).toContain("normalize unicode then parse");
    expect(b).toContain("Told you, nephew.");
    expect(b).toContain(ALBUM);
  });

  it("prBody says first try when nothing was rewound", () => {
    const b = prBody(job, [tl(1, "passed", "one-liner", null)], ALBUM);
    expect(b).toContain("## Family History");
    expect(b).toMatch(/first (try|timeline)/i);
  });

  it("giveUpComment lists every timeline", () => {
    const tls = [tl(1, "failed", "a1", "r1"), tl(2, "failed", "a2", "r2"), tl(3, "failed", "a3", "r3")];
    const c = giveUpComment(job, tls, ALBUM);
    for (const t of tls) {
      expect(c).toContain(t.approach);
      expect(c).toContain(t.failReason!);
    }
    expect(c).toContain(ALBUM);
  });

  it("ackComment references lore when present", () => {
    const lore: MemoryRecord[] = [{
      id: "x-t2", text: "Timeline 2: rewrote the parser in regex; tests failed", repo: "alice/pantry", issue: 3,
      job_id: "x", timeline: 2, outcome: "failed", created_at: "2026-11-23T00:00:00.000Z",
    }];
    const c = ackComment(job, lore);
    expect(c).toMatch(/last time/i);
    expect(c).toContain("rewrote the parser in regex");
  });

  it("ackComment without lore does not mention last time", () => {
    expect(ackComment(job, [])).not.toMatch(/last time/i);
  });

  it("other comments are non-empty and link where relevant", () => {
    expect(busyComment(job)).toContain(job.id);
    expect(noTestsComment().length).toBeGreaterThan(20);
    const pc = prComment("https://github.com/alice/pantry/pull/9", ALBUM);
    expect(pc).toContain("https://github.com/alice/pantry/pull/9");
    expect(pc).toContain(ALBUM);
  });

  it("IdentityNarrator returns text unchanged", async () => {
    expect(await new IdentityNarrator().polish("hi")).toBe("hi");
  });
});
