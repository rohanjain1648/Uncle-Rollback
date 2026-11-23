import type { Config } from "./config.js";
import { gatewayUrl } from "./gateway.js";

export interface ExecResult { exitCode: number; stdout: string; stderr: string; timedOut: boolean }

export interface ExecOpts { timeoutMs?: number; env?: Record<string, string>; cwd?: string }

export interface Garage {
  exec(cmd: string[], opts?: ExecOpts): Promise<ExecResult>;
  writeFile(path: string, content: string): Promise<void>;
  checkpoint(comment: string): Promise<string>;
  restore(versionId: string): Promise<void>;
  findCheckpoint(comment: string): Promise<string | null>;
}

/** Sends a request to a Sprites API path such as `/v1/sprites/x/exec`. */
export type Transport = (path: string, init?: RequestInit) => Promise<Response>;

/** Direct API access with a token, or via the Custom API connector gateway (no token on the box). */
export function spritesTransport(cfg: Config, env: Record<string, string | undefined> = process.env): Transport {
  const token = env.SPRITES_TOKEN?.trim();
  if (token) {
    return (path, init = {}) => fetch(`https://api.sprites.dev${path}`, {
      ...init, headers: { ...(init.headers as Record<string, string>), Authorization: `Bearer ${token}` },
    });
  }
  const provider = env.SPRITES_GATEWAY_PROVIDER?.trim() || "custom";
  return (path, init) => fetch(gatewayUrl(provider, cfg.conn.sprites, path), init);
}

const SENTINEL = "__UNCLE_EXIT__";
export const RESTORE_MARKER = "/work/.uncle-restore-marker";
const DEFAULT_TIMEOUT_S = 1800;
const shq = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;

/**
 * The exec endpoint's response format is not specified, so every command runs inside a
 * wrapper that prints one sentinel line: exit code plus base64 stdout and stderr.
 */
export function wrapCommand(cmd: string[], timeoutSec: number): string {
  return [
    'o=$(mktemp); e=$(mktemp)',
    `timeout --kill-after=5 ${timeoutSec} ${cmd.map(shq).join(" ")} >"$o" 2>"$e"; c=$?`,
    `printf '${SENTINEL} %s %s %s\\n' "$c" "$(base64 -w0 <"$o")" "$(base64 -w0 <"$e")"`,
    'rm -f "$o" "$e"',
  ].join("\n");
}

function streamText(body: string): string {
  const lines = body.split("\n").filter((l) => l.trim());
  const events: any[] = [];
  for (const l of lines) {
    try {
      const v = JSON.parse(l);
      if (!v || typeof v !== "object") return body;
      events.push(v);
    } catch {
      return body;
    }
  }
  return events.map((e) => (typeof e.data === "string" ? e.data : typeof e.stdout === "string" ? e.stdout : "")).join("");
}

export function parseEnvelope(body: string): ExecResult {
  const text = streamText(body);
  const m = text.match(new RegExp(`${SENTINEL} (\\d+) ([A-Za-z0-9+/=]*) ([A-Za-z0-9+/=]*)`));
  if (!m) return { exitCode: 255, stdout: "", stderr: `no exec envelope in response: ${body.slice(0, 500)}`, timedOut: false };
  const exitCode = Number(m[1]);
  return {
    exitCode,
    stdout: Buffer.from(m[2], "base64").toString("utf8"),
    stderr: Buffer.from(m[3], "base64").toString("utf8"),
    timedOut: exitCode === 124,
  };
}

async function readStream(res: Response, what: string): Promise<string> {
  const body = await res.text();
  if (!res.ok) throw new Error(`${what} failed (${res.status}): ${body.slice(0, 300)}`);
  for (const line of body.split("\n")) {
    if (!line.trim()) continue;
    let ev: any;
    try { ev = JSON.parse(line); } catch { continue; }
    if (ev?.type === "error") throw new Error(`${what} failed: ${ev.error ?? line}`);
  }
  return body;
}

interface CheckpointInfo { id: string; create_time: string; comment?: string }

export class SpritesGarage implements Garage {
  private base: string;

  constructor(
    cfg: Config,
    private t: Transport,
    private opts: { pollMs?: number; restoreTimeoutMs?: number; graceMs?: number } = {},
  ) {
    this.base = `/v1/sprites/${encodeURIComponent(cfg.garageName)}`;
  }

  /** Non-exec API calls get a timeout too, so a hung request can't block the queue. */
  private call(path: string, init: RequestInit = {}, timeoutMs = 120_000): Promise<Response> {
    return this.t(path, { ...init, signal: init.signal ?? AbortSignal.timeout(timeoutMs) });
  }

  async exec(cmd: string[], opts: ExecOpts = {}): Promise<ExecResult> {
    const timeoutSec = opts.timeoutMs ? Math.max(1, Math.ceil(opts.timeoutMs / 1000)) : DEFAULT_TIMEOUT_S;
    const q = new URLSearchParams();
    for (const c of ["bash", "-c", wrapCommand(cmd, timeoutSec)]) q.append("cmd", c);
    for (const [k, v] of Object.entries(opts.env ?? {})) q.append("env", `${k}=${v}`);
    if (opts.cwd) q.set("dir", opts.cwd);

    const ctrl = new AbortController();
    // The server-side `timeout` fires first; the client waits a grace period longer so it gets the real result.
    const grace = this.opts.graceMs ?? 15_000;
    const timer = setTimeout(() => ctrl.abort(), (opts.timeoutMs ?? DEFAULT_TIMEOUT_S * 1000) + grace);
    try {
      const res = await this.t(`${this.base}/exec?${q}`, { method: "POST", signal: ctrl.signal });
      const body = await res.text();
      if (!res.ok) return { exitCode: 255, stdout: "", stderr: `exec HTTP ${res.status}: ${body.slice(0, 300)}`, timedOut: false };
      return parseEnvelope(body);
    } catch (e) {
      if ((e as Error).name === "AbortError") return { exitCode: 124, stdout: "", stderr: "client timeout", timedOut: true };
      return { exitCode: 255, stdout: "", stderr: `exec request failed: ${(e as Error).message}`, timedOut: false };
    } finally {
      clearTimeout(timer);
    }
  }

  async writeFile(path: string, content: string): Promise<void> {
    const q = new URLSearchParams({ path, workingDir: "/", mkdir: "true" });
    const res = await this.call(`${this.base}/fs/write?${q}`, {
      method: "PUT", headers: { "Content-Type": "application/octet-stream" }, body: content,
    });
    if (!res.ok) throw new Error(`writeFile ${path} failed (${res.status}): ${(await res.text()).slice(0, 300)}`);
  }

  private async list(): Promise<CheckpointInfo[]> {
    const res = await this.call(`${this.base}/checkpoints`);
    if (!res.ok) throw new Error(`list checkpoints failed (${res.status})`);
    return (await res.json()) as CheckpointInfo[];
  }

  async findCheckpoint(comment: string): Promise<string | null> {
    const matches = (await this.list()).filter((c) => c.comment === comment);
    matches.sort((a, b) => b.create_time.localeCompare(a.create_time));
    return matches[0]?.id ?? null;
  }

  async checkpoint(comment: string): Promise<string> {
    const res = await this.call(`${this.base}/checkpoint`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ comment }),
    }, 300_000);
    await readStream(res, "checkpoint");
    const id = await this.findCheckpoint(comment);
    if (!id) throw new Error(`checkpoint "${comment}" not found after creation`);
    return id;
  }

  /**
   * Restore may be asynchronous (the Sprite restarts after the call returns), so "exec works" is not
   * proof the disk was rewound. Write a marker that no checkpoint contains, and wait until it is gone.
   */
  async restore(versionId: string): Promise<void> {
    await this.writeFile(RESTORE_MARKER, versionId);
    const res = await this.call(`${this.base}/checkpoints/${encodeURIComponent(versionId)}/restore`, { method: "POST" }, 300_000);
    await readStream(res, "restore");
    const deadline = Date.now() + (this.opts.restoreTimeoutMs ?? 120_000);
    const pollMs = this.opts.pollMs ?? 1000;
    for (;;) {
      if ((await this.exec(["test", "!", "-e", RESTORE_MARKER], { timeoutMs: 10_000 })).exitCode === 0) return;
      if (Date.now() > deadline) throw new Error(`garage did not come back after restoring ${versionId}`);
      await new Promise((r) => setTimeout(r, pollMs));
    }
  }
}
