import type { Garage, ExecResult, ExecOpts } from "../src/garage.js";
import type { GitHub, FileChange, Reaction } from "../src/github.js";
import type { Memory, MemoryRecord } from "../src/memory.js";
import { IdentityNarrator } from "../src/narrate.js";
import { Db } from "../src/db.js";
import type { Deps } from "../src/runner.js";
import { testConfig } from "./helpers.js";

export interface AttemptScript {
  claudeExit?: number;
  timedOut?: boolean;
  claudeOut?: string;
  changed?: { path: string; deleted: boolean }[];
  suitePass?: boolean;
}

export const claudeJson = (approach: string, quote = `quote for ${approach}`) =>
  JSON.stringify({ type: "result", subtype: "success", is_error: false, result: `done\n{"approach":${JSON.stringify(approach)},"quote":${JSON.stringify(quote)}}` });

const res = (exitCode = 0, stdout = "", stderr = "", timedOut = false): ExecResult => ({ exitCode, stdout, stderr, timedOut });

export class FakeGarage implements Garage {
  events: string[] = [];
  restores: string[] = [];
  writes: { path: string; content: string }[] = [];
  attempt = 0;
  packageJson: string | null = '{"scripts":{"test":"vitest run"}}';
  failFetch = false;

  constructor(public attempts: AttemptScript[] = []) {}

  private cur(): AttemptScript { return this.attempts[this.attempt - 1] ?? {}; }

  async exec(cmd: string[], _opts?: ExecOpts): Promise<ExecResult> {
    const s = cmd.join(" ");
    this.events.push(`exec:${s.slice(0, 60)}`);
    if (cmd[0] === "/work/.uncle/run-claude.sh") {
      this.attempt++;
      const a = this.cur();
      return res(a.claudeExit ?? 0, "", "", a.timedOut ?? false);
    }
    if (s === "cat /work/claude-out.json") return res(0, this.cur().claudeOut ?? claudeJson(`approach ${this.attempt}`));
    if (s.includes("tarball")) return this.failFetch ? res(22, "", "curl: (22) 404") : res();
    if (s === "cat /work/repo/package.json") return this.packageJson ? res(0, this.packageJson) : res(1);
    if (s.startsWith("cat /work/repo/.uncle.yml") || s.startsWith("test ")) return res(1);
    if (s.startsWith("cat /work/repo/")) return res(0, `content of ${s.slice("cat /work/repo/".length)}`);
    if (s.includes("git status --porcelain")) {
      const changed = this.attempt === 0 ? [] : this.cur().changed ?? [{ path: "src/parse.ts", deleted: false }];
      return res(0, changed.map((c) => `${c.deleted ? " D" : " M"} ${c.path}`).join("\n") + "\n");
    }
    if (s.includes("git diff")) return res(0, `diff --git a/src/parse.ts b/src/parse.ts (attempt ${this.attempt})`);
    if (s.includes("npm test")) {
      if (this.attempt === 0) return res(1, "baseline: 2 failing");
      return this.cur().suitePass ? res(0, "all green") : res(1, `attempt ${this.attempt}: 1 failing`);
    }
    return res();
  }

  async writeFile(path: string, content: string): Promise<void> {
    this.events.push(`write:${path}`);
    this.writes.push({ path, content });
  }
  async checkpoint(comment: string): Promise<string> { this.events.push(`checkpoint:${comment}`); return `v-${comment}`; }
  async restore(v: string): Promise<void> { this.events.push(`restore:${v}`); this.restores.push(v); }
  async findCheckpoint(comment: string): Promise<string | null> { return comment === "garage-clean" ? "v-clean" : null; }
}

export class FakeGitHub implements GitHub {
  comments: { repo: string; issue: number; body: string }[] = [];
  reactions: Reaction[] = [];
  pulls: { branch: string; files: FileChange[]; title: string; body: string }[] = [];
  async comment(repo: string, issue: number, body: string) { this.comments.push({ repo, issue, body }); }
  async react(_repo: string, _id: number, content: Reaction) { this.reactions.push(content); }
  async defaultBranch() { return { name: "main", sha: "base1" }; }
  async createPullFromFiles(_repo: string, _base: any, branch: string, files: FileChange[], title: string, body: string) {
    this.pulls.push({ branch, files, title, body });
    return "https://github.com/alice/pantry/pull/9";
  }
}

export class FakeMemory implements Memory {
  records: MemoryRecord[] = [];
  lore: MemoryRecord[] = [];
  async remember(r: MemoryRecord) { this.records.push(r); }
  async recallForJob(jobId: string) { return this.records.filter((r) => r.job_id === jobId); }
  async recallForRepo() { return this.lore; }
}

export const ACCEPTANCE = [{ path: "test/hidden.test.ts", content: "hidden!" }];

export function makeDeps(over: Partial<Deps> = {}): Deps & { garage: FakeGarage; github: FakeGitHub; memory: FakeMemory } {
  return {
    cfg: testConfig(),
    db: new Db(":memory:"),
    garage: new FakeGarage(),
    github: new FakeGitHub(),
    memory: new FakeMemory(),
    narrator: new IdentityNarrator(),
    readAcceptance: async () => ACCEPTANCE,
    now: () => Date.now(),
    ...over,
  } as any;
}
