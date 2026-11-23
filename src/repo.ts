import type { Config } from "./config.js";
import type { Garage } from "./garage.js";
import { gatewayUrl } from "./gateway.js";

export const REPO_DIR = "/work/repo";

export interface RepoProbe {
  uncleYml: string | null;
  packageJson: string | null;
  hasPyproject: boolean;
  hasSetupCfg: boolean;
  hasTestsDir: boolean;
}

const sh = (script: string) => ["bash", "-c", script];
const q = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;

export async function fetchRepo(g: Garage, cfg: Config, repo: string): Promise<void> {
  const url = gatewayUrl("github", cfg.conn.github, `repos/${repo}/tarball/HEAD`);
  const script = [
    "set -euo pipefail",
    `rm -rf ${REPO_DIR}`,
    `mkdir -p ${REPO_DIR}`,
    `cd ${REPO_DIR}`,
    `curl -fsSL ${q(url)} | tar xz --strip-components=1`,
    "git init -q",
    "git add -A",
    "git -c user.name=uncle -c user.email=uncle@localhost commit -qm base",
  ].join("\n");
  const r = await g.exec(sh(script));
  if (r.exitCode !== 0) throw new Error(`fetchRepo failed (${r.exitCode}): ${r.stderr || r.stdout}`);
}

async function readOrNull(g: Garage, path: string): Promise<string | null> {
  const r = await g.exec(["cat", path]);
  return r.exitCode === 0 ? r.stdout : null;
}

async function exists(g: Garage, flag: "-f" | "-d", path: string): Promise<boolean> {
  return (await g.exec(["test", flag, path])).exitCode === 0;
}

export async function probeRepo(g: Garage): Promise<RepoProbe> {
  return {
    uncleYml: await readOrNull(g, `${REPO_DIR}/.uncle.yml`),
    packageJson: await readOrNull(g, `${REPO_DIR}/package.json`),
    hasPyproject: await exists(g, "-f", `${REPO_DIR}/pyproject.toml`),
    hasSetupCfg: await exists(g, "-f", `${REPO_DIR}/setup.cfg`),
    hasTestsDir: await exists(g, "-d", `${REPO_DIR}/tests`),
  };
}

const NPM_DEFAULT_TEST = 'echo "Error: no test specified" && exit 1';

export function detectTestCommand(p: RepoProbe): string | null {
  const yml = p.uncleYml?.match(/^\s*test:\s*(.+?)\s*$/m);
  if (yml) return yml[1];
  if (p.packageJson) {
    try {
      const test = JSON.parse(p.packageJson)?.scripts?.test;
      if (typeof test === "string" && test.trim() && test.trim() !== NPM_DEFAULT_TEST) return "npm test";
    } catch {
      /* invalid package.json: fall through */
    }
  }
  if (p.hasPyproject || p.hasSetupCfg || p.hasTestsDir) return "python3 -m pytest -q";
  return null;
}

const unquote = (s: string) => (s.startsWith('"') && s.endsWith('"') ? JSON.parse(s) : s);

export async function changedFiles(g: Garage): Promise<{ path: string; deleted: boolean }[]> {
  const r = await g.exec(sh(`cd ${REPO_DIR} && git status --porcelain -uall`));
  if (r.exitCode !== 0) throw new Error(`git status failed: ${r.stderr}`);
  const out: { path: string; deleted: boolean }[] = [];
  for (const line of r.stdout.split("\n")) {
    if (line.length < 4) continue;
    const xy = line.slice(0, 2);
    const rest = line.slice(3);
    if (xy.includes("R") && rest.includes(" -> ")) {
      const [from, to] = rest.split(" -> ");
      out.push({ path: unquote(from), deleted: true }, { path: unquote(to), deleted: false });
    } else {
      out.push({ path: unquote(rest), deleted: xy.includes("D") });
    }
  }
  return out;
}

export const TEST_FILE_PATTERNS: RegExp[] = [
  /(^|\/)(tests?|__tests__)\//,
  /\.(test|spec)\.[jt]sx?$/,
  /(^|\/)test_[^/]*\.py$|_test\.py$/,
];

export function testFilesChanged(files: { path: string }[]): string[] {
  return files.map((f) => f.path).filter((p) => TEST_FILE_PATTERNS.some((re) => re.test(p)));
}
