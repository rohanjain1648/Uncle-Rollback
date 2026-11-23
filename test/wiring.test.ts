import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readAcceptanceFrom } from "../src/acceptance.js";
import { withKeepAwake, type TasksClient } from "../src/keepawake.js";

describe("readAcceptanceFrom", () => {
  it("reads every file under acceptance/<owner>__<repo>/issue-<n>/ with relative posix paths", async () => {
    const root = mkdtempSync(join(tmpdir(), "acc-"));
    const dir = join(root, "alice__pantry", "issue-7");
    mkdirSync(join(dir, "test", "deep"), { recursive: true });
    writeFileSync(join(dir, "test", "hidden.test.ts"), "A");
    writeFileSync(join(dir, "test", "deep", "more.test.ts"), "B");
    mkdirSync(join(root, "alice__pantry", "issue-8", "test"), { recursive: true });
    writeFileSync(join(root, "alice__pantry", "issue-8", "test", "other.test.ts"), "C");
    const files = await readAcceptanceFrom(root, "alice/pantry", 7);
    expect(files.sort((a, b) => a.path.localeCompare(b.path))).toEqual([
      { path: "test/deep/more.test.ts", content: "B" },
      { path: "test/hidden.test.ts", content: "A" },
    ]);
  });
  it("returns [] when the issue has no acceptance folder", async () => {
    expect(await readAcceptanceFrom(mkdtempSync(join(tmpdir(), "acc-")), "alice/none", 1)).toEqual([]);
  });
});

describe("withKeepAwake", () => {
  function fakeTasks() {
    const log: string[] = [];
    const t: TasksClient = { async hold(name) { log.push(`hold ${name}`); }, async release(name) { log.push(`release ${name}`); } };
    return { t, log };
  }
  it("holds a task for the job and releases it afterwards", async () => {
    const { t, log } = fakeTasks();
    const run = withKeepAwake(async (id) => { log.push(`run ${id}`); return "passed"; }, t, 60_000);
    expect(await run("j1", {} as any)).toBe("passed");
    expect(log).toEqual(["hold uncle-job-j1", "run j1", "release uncle-job-j1"]);
  });
  it("releases even when the job throws, and survives task API failures", async () => {
    const log: string[] = [];
    const t: TasksClient = { async hold() { throw new Error("no socket"); }, async release() { log.push("release"); } };
    const run = withKeepAwake(async () => { throw new Error("boom"); }, t, 60_000);
    await expect(run("j2", {} as any)).rejects.toThrow("boom");
    expect(log).toEqual(["release"]);
  });
});
