import { describe, it, expect } from "vitest";
import { SpritesGarage, parseEnvelope, wrapCommand, type Transport } from "../src/garage.js";
import { testConfig } from "./helpers.js";

const b64 = (s: string) => Buffer.from(s).toString("base64");
const envelope = (code: number, out: string, err = "") => `__UNCLE_EXIT__ ${code} ${b64(out)} ${b64(err)}\n`;

function transport(respond: (path: string, init: RequestInit) => Response | Promise<Response>) {
  const calls: { path: string; init: RequestInit }[] = [];
  const t: Transport = async (path, init = {}) => { calls.push({ path, init }); return respond(path, init); };
  return { t, calls };
}

describe("parseEnvelope", () => {
  it("parses a raw-text envelope", () => {
    expect(parseEnvelope("noise\n" + envelope(3, "hi\n", "oops"))).toEqual({ exitCode: 3, stdout: "hi\n", stderr: "oops", timedOut: false });
  });
  it("parses an envelope split across NDJSON stdout events", () => {
    const e = envelope(0, "hello");
    const body = [
      JSON.stringify({ type: "stdout", data: e.slice(0, 10) }),
      JSON.stringify({ type: "stdout", data: e.slice(10) }),
      JSON.stringify({ type: "exit", exit_code: 0 }),
    ].join("\n");
    expect(parseEnvelope(body).stdout).toBe("hello");
  });
  it("marks exit 124 as timed out", () => {
    expect(parseEnvelope(envelope(124, "")).timedOut).toBe(true);
  });
  it("reports a missing envelope as exit 255 with the body in stderr", () => {
    const r = parseEnvelope("bash: not found");
    expect(r.exitCode).toBe(255);
    expect(r.stderr).toContain("bash: not found");
  });
});

describe("wrapCommand", () => {
  it("quotes argv and applies the server-side timeout", () => {
    const script = wrapCommand(["echo", "it's"], 30);
    expect(script).toContain("timeout --kill-after=5 30");
    expect(script).toContain(`'it'\\''s'`);
    expect(script).toContain("__UNCLE_EXIT__");
  });
});

describe("SpritesGarage", () => {
  const cfg = testConfig();

  it("execs through the wrapper and maps the envelope", async () => {
    const { t, calls } = transport(() => new Response(envelope(0, "hi\n")));
    const r = await new SpritesGarage(cfg, t).exec(["echo", "hi"], { env: { A: "1" }, cwd: "/work" });
    expect(r).toEqual({ exitCode: 0, stdout: "hi\n", stderr: "", timedOut: false });
    const u = new URL("https://x" + calls[0].path);
    expect(u.pathname).toBe("/v1/sprites/uncle-garage/exec");
    expect(u.searchParams.getAll("cmd")[0]).toBe("bash");
    expect(u.searchParams.getAll("cmd")[1]).toBe("-c");
    expect(u.searchParams.getAll("cmd")[2]).toContain("'echo' 'hi'");
    expect(u.searchParams.getAll("env")).toEqual(["A=1"]);
    expect(u.searchParams.get("dir")).toBe("/work");
    expect(calls[0].init.method).toBe("POST");
  });

  it("returns timedOut when the client-side timeout fires", async () => {
    const { t } = transport((_p, init) => new Promise((_res, rej) => {
      init.signal?.addEventListener("abort", () => rej(new DOMException("aborted", "AbortError")));
    }));
    const r = await new SpritesGarage(cfg, t, { graceMs: 0 }).exec(["sleep", "99"], { timeoutMs: 20 });
    expect(r.timedOut).toBe(true);
  });

  it("gives the server-side timeout a grace period before aborting client-side", async () => {
    const { t } = transport((_p, init) => new Promise((res, rej) => {
      const timer = setTimeout(() => res(new Response(envelope(0, "slow but fine"))), 30);
      init.signal?.addEventListener("abort", () => { clearTimeout(timer); rej(new DOMException("aborted", "AbortError")); });
    }));
    const r = await new SpritesGarage(cfg, t, { graceMs: 200 }).exec(["make", "test"], { timeoutMs: 10 });
    expect(r).toMatchObject({ exitCode: 0, stdout: "slow but fine", timedOut: false });
  });

  it("writes files with mkdir", async () => {
    const { t, calls } = transport(() => Response.json({ path: "/work/a", size: 2, mode: "0644" }));
    await new SpritesGarage(cfg, t).writeFile("/work/prompt.txt", "hi");
    const u = new URL("https://x" + calls[0].path);
    expect(u.pathname).toBe("/v1/sprites/uncle-garage/fs/write");
    expect(u.searchParams.get("path")).toBe("/work/prompt.txt");
    expect(u.searchParams.get("mkdir")).toBe("true");
    expect(calls[0].init.method).toBe("PUT");
    expect(calls[0].init.body).toBe("hi");
  });

  it("creates a checkpoint and returns its id from the listing", async () => {
    const { t, calls } = transport((path) => {
      if (path.endsWith("/checkpoint")) return new Response(JSON.stringify({ type: "complete", data: "Checkpoint v8 created" }) + "\n");
      return Response.json([
        { id: "v7", create_time: "2026-11-24T01:00:00Z", comment: "t0-abc" },
        { id: "v8", create_time: "2026-11-24T02:00:00Z", comment: "t0-abc" },
        { id: "v9", create_time: "2026-11-24T03:00:00Z", comment: "other" },
      ]);
    });
    expect(await new SpritesGarage(cfg, t).checkpoint("t0-abc")).toBe("v8");
    expect(JSON.parse(String(calls[0].init.body))).toEqual({ comment: "t0-abc" });
  });

  it("throws when checkpoint creation streams an error", async () => {
    const { t } = transport(() => new Response(JSON.stringify({ type: "error", error: "disk full" }) + "\n"));
    await expect(new SpritesGarage(cfg, t).checkpoint("x")).rejects.toThrow(/disk full/);
  });

  it("finds the newest checkpoint by comment", async () => {
    const { t } = transport(() => Response.json([
      { id: "v1", create_time: "2026-11-20T00:00:00Z", comment: "garage-clean" },
      { id: "v4", create_time: "2026-11-23T00:00:00Z", comment: "garage-clean" },
    ]));
    const g = new SpritesGarage(cfg, t);
    expect(await g.findCheckpoint("garage-clean")).toBe("v4");
    expect(await g.findCheckpoint("nope")).toBeNull();
  });

  it("restores and waits until the pre-restore marker is gone", async () => {
    let probes = 0;
    const { t, calls } = transport((path) => {
      if (path.includes("/fs/write")) return Response.json({ path: "m", size: 1, mode: "0644" });
      if (path.includes("/restore")) return new Response(JSON.stringify({ type: "complete", data: "Restored to v3" }) + "\n");
      probes++;
      if (probes === 1) return new Response("starting", { status: 503 });
      if (probes === 2) return new Response(envelope(1, "")); // marker still present: old disk
      return new Response(envelope(0, ""));
    });
    await new SpritesGarage(cfg, t, { pollMs: 1 }).restore("v3");
    expect(new URL("https://x" + calls[0].path).searchParams.get("path")).toBe("/work/.uncle-restore-marker");
    expect(calls[1].path).toBe("/v1/sprites/uncle-garage/checkpoints/v3/restore");
    const probe = new URL("https://x" + calls[2].path).searchParams.getAll("cmd")[2];
    expect(probe).toContain("/work/.uncle-restore-marker");
    expect(probes).toBe(3);
  });
});
