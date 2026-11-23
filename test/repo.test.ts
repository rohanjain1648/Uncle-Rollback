import { describe, it, expect } from "vitest";
import { detectTestCommand, testFilesChanged, changedFiles, fetchRepo, probeRepo, installDeps, type RepoProbe } from "../src/repo.js";
import type { Garage, ExecResult } from "../src/garage.js";
import { testConfig } from "./helpers.js";

const ok = (stdout = ""): ExecResult => ({ exitCode: 0, stdout, stderr: "", timedOut: false });
const miss: ExecResult = { exitCode: 1, stdout: "", stderr: "", timedOut: false };

function scripted(handler: (cmd: string[]) => ExecResult) {
  const calls: string[][] = [];
  const g: Garage = {
    exec: async (cmd) => { calls.push(cmd); return handler(cmd); },
    writeFile: async () => {}, checkpoint: async () => "v", restore: async () => {}, findCheckpoint: async () => null,
  };
  return { g, calls };
}

const probe = (over: Partial<RepoProbe> = {}): RepoProbe => ({
  uncleYml: null, packageJson: null, hasPyproject: false, hasSetupCfg: false, hasTestsDir: false, ...over,
});

describe("detectTestCommand", () => {
  it("prefers .uncle.yml test line", () => {
    expect(detectTestCommand(probe({ uncleYml: "# cfg\ntest: make check\n", packageJson: '{"scripts":{"test":"vitest"}}' }))).toBe("make check");
  });
  it("uses npm test when scripts.test exists", () => {
    expect(detectTestCommand(probe({ packageJson: '{"scripts":{"test":"vitest run"}}' }))).toBe("npm test");
  });
  it("ignores npm's default no-test script", () => {
    const pj = JSON.stringify({ scripts: { test: 'echo "Error: no test specified" && exit 1' } });
    expect(detectTestCommand(probe({ packageJson: pj }))).toBeNull();
  });
  it("falls back to pytest for python projects", () => {
    expect(detectTestCommand(probe({ hasPyproject: true }))).toBe("python3 -m pytest -q");
    expect(detectTestCommand(probe({ hasSetupCfg: true }))).toBe("python3 -m pytest -q");
    expect(detectTestCommand(probe({ hasTestsDir: true }))).toBe("python3 -m pytest -q");
  });
  it("returns null when nothing is detectable, including invalid package.json", () => {
    expect(detectTestCommand(probe())).toBeNull();
    expect(detectTestCommand(probe({ packageJson: "{nope" }))).toBeNull();
  });
});

describe("testFilesChanged", () => {
  it("flags test files and not lookalikes", () => {
    const files = ["src/__tests__/a.ts", "tests/test_x.py", "foo.spec.ts", "src/testing.ts", "lib/thing_test.py", "test/a.test.js", "src/main.ts"].map((path) => ({ path }));
    expect(testFilesChanged(files)).toEqual(["src/__tests__/a.ts", "tests/test_x.py", "foo.spec.ts", "lib/thing_test.py", "test/a.test.js"]);
  });
});

describe("installDeps", () => {
  it("installs npm deps when package.json exists, then commits and tags the base", async () => {
    const { g, calls } = scripted(() => ok());
    await installDeps(g, probe({ packageJson: "{}" }));
    const s = calls.map((c) => c.join(" ")).join("\n");
    expect(s).toMatch(/npm ci[^\n]*\|\| npm install/);
    expect(s).toContain("requirements.txt");
    expect(s).toContain("git tag -f uncle-base");
  });
  it("skips npm when there is no package.json", async () => {
    const { g, calls } = scripted(() => ok());
    await installDeps(g, probe({ hasPyproject: true }));
    expect(calls.map((c) => c.join(" ")).join("\n")).not.toContain("npm ci");
  });
  it("throws when the install fails", async () => {
    const { g } = scripted(() => ({ exitCode: 1, stdout: "", stderr: "npm ERR! 404", timedOut: false }));
    await expect(installDeps(g, probe({ packageJson: "{}" }))).rejects.toThrow(/npm ERR/);
  });
});

describe("changedFiles", () => {
  it("diffs against the tagged base so commits by Claude can't hide changes", async () => {
    const { g, calls } = scripted(() => ok(" M src/a.ts\n"));
    await changedFiles(g);
    expect(calls[0].join(" ")).toContain("git reset -q --soft uncle-base");
  });
  it("drops dependency and cache folders", async () => {
    const { g } = scripted(() => ok(" M src/a.ts\n?? node_modules/x/test/a.js\n?? .venv/lib/x.py\n?? src/__pycache__/a.pyc\n?? .pytest_cache/v\n"));
    expect(await changedFiles(g)).toEqual([{ path: "src/a.ts", deleted: false }]);
  });
  it("parses porcelain status incl. untracked, deleted and renamed", async () => {
    const { g, calls } = scripted(() => ok(" M src/a.ts\n?? src/new.ts\n D old.ts\nR  from.ts -> to.ts\n"));
    expect(await changedFiles(g)).toEqual([
      { path: "src/a.ts", deleted: false },
      { path: "src/new.ts", deleted: false },
      { path: "old.ts", deleted: true },
      { path: "from.ts", deleted: true },
      { path: "to.ts", deleted: false },
    ]);
    expect(calls[0].join(" ")).toContain("git status --porcelain");
  });
});

describe("fetchRepo", () => {
  it("downloads the tarball via the gateway and makes a base commit", async () => {
    const { g, calls } = scripted(() => ok());
    await fetchRepo(g, testConfig(), "alice/pantry");
    const script = calls.map((c) => c.join(" ")).join("\n");
    expect(script).toContain("https://api.sprites.dev/v1/gateway/github/gh1/repos/alice/pantry/tarball/HEAD");
    expect(script).toContain("--strip-components=1");
    expect(script).toContain("git init");
    expect(script).toContain("commit -qm base");
    expect(script).toMatch(/node_modules\/[\s\S]*\.git\/info\/exclude/);
  });
  it("throws when a step fails", async () => {
    const { g } = scripted(() => ({ exitCode: 22, stdout: "", stderr: "curl: 404", timedOut: false }));
    await expect(fetchRepo(g, testConfig(), "alice/pantry")).rejects.toThrow(/404/);
  });
});

describe("probeRepo", () => {
  it("reads marker files from /work/repo", async () => {
    const { g } = scripted((cmd) => {
      const s = cmd.join(" ");
      if (s.includes("package.json")) return ok('{"scripts":{"test":"vitest"}}');
      if (s.includes(".uncle.yml") || s.includes("pyproject.toml") || s.includes("setup.cfg")) return miss;
      return ok(); // tests dir exists
    });
    expect(await probeRepo(g)).toEqual({
      uncleYml: null, packageJson: '{"scripts":{"test":"vitest"}}', hasPyproject: false, hasSetupCfg: false, hasTestsDir: true,
    });
  });
});
