// Day-1 spike, run ON the brain Sprite after deploy:  cd /app && set -a && . ./.env && set +a && npx tsx scripts/spike/brain-checks.ts
// Exercises the real clients against the real connectors and garage. Prints PASS/FAIL per check (spec §8).
import { loadConfig } from "../../src/config.js";
import { gatewayUrl } from "../../src/gateway.js";
import { SpritesGarage, spritesTransport } from "../../src/garage.js";
import { GatewayGitHub } from "../../src/github.js";
import { PineconeMemory } from "../../src/memory.js";
import { fetchRepo } from "../../src/repo.js";

const cfg = loadConfig(process.env);
const demoRepo = process.argv[2] ?? cfg.repoAllowlist[0];
const results: [string, boolean, string][] = [];

async function check(name: string, fn: () => Promise<string>) {
  const t = Date.now();
  try {
    const note = await fn();
    results.push([name, true, `${note} (${Date.now() - t} ms)`]);
  } catch (e) {
    results.push([name, false, (e as Error).message.slice(0, 300)]);
  }
  const [n, ok, msg] = results.at(-1)!;
  console.log(`${ok ? "PASS" : "FAIL"}  ${n}: ${msg}`);
}

const garage = new SpritesGarage(cfg, spritesTransport(cfg));

await check("gateway list (step 2)", async () => {
  const r = await fetch("https://api.sprites.dev/v1/gateway/list");
  const body = await r.text();
  if (!r.ok) throw new Error(`${r.status} ${body}`);
  return body.slice(0, 200);
});

await check("garage exec via Sprites API (step 3)", async () => {
  const r = await garage.exec(["bash", "-c", "echo hi from $(hostname); id -un"]);
  if (r.exitCode !== 0) throw new Error(`exit ${r.exitCode}: ${r.stderr}`);
  return r.stdout.trim().replace(/\n/g, " | ");
});

await check("checkpoint + restore round trip (step 4)", async () => {
  await garage.writeFile("/work/spike-marker.txt", "before");
  const v = await garage.checkpoint("spike-before");
  await garage.writeFile("/work/spike-marker.txt", "after");
  const t = Date.now();
  await garage.restore(v);
  const r = await garage.exec(["cat", "/work/spike-marker.txt"]);
  if (r.stdout.trim() !== "before") throw new Error(`marker is "${r.stdout.trim()}" after restore`);
  return `restored ${v} in ${Date.now() - t} ms`;
});

await check("garage-clean checkpoint exists", async () => {
  const v = await garage.findCheckpoint("garage-clean");
  if (!v) throw new Error("no checkpoint with comment garage-clean (Task 0 step 6)");
  return v;
});

await check("claude runs in garage (step 1/5)", async () => {
  await garage.writeFile("/work/prompt.txt", 'Reply with exactly: {"approach":"spike","quote":"It works, nephew."}');
  await garage.exec(["bash", "-c", "mkdir -p /work/repo"]);
  const r = await garage.exec(["/work/.uncle/run-claude.sh", "120"], { timeoutMs: 150_000 });
  const out = await garage.exec(["cat", "/work/claude-out.json"]);
  if (r.exitCode !== 0) throw new Error(`exit ${r.exitCode}: ${r.stderr} ${out.stdout.slice(0, 200)}`);
  return out.stdout.slice(0, 160);
});

await check("github tarball into garage (step 6)", async () => {
  await fetchRepo(garage, cfg, demoRepo);
  const r = await garage.exec(["bash", "-c", "cd /work/repo && git log --oneline | head -1 && ls"]);
  return r.stdout.trim().replace(/\n/g, " ");
});

await check("github API from brain (step 6)", async () => {
  const gh = new GatewayGitHub(cfg);
  const b = await gh.defaultBranch(demoRepo);
  return `default branch ${b.name} @ ${b.sha.slice(0, 7)}`;
});

await check("pinecone upsert + search (step 7)", async () => {
  const m = new PineconeMemory(cfg);
  await m.remember({
    id: "spike-t1", text: "Spike timeline: Uncle tested his memory and it held.", repo: demoRepo, issue: 0,
    job_id: "spike", timeline: 1, outcome: "passed", created_at: new Date().toISOString(),
  });
  for (let i = 0; i < 10; i++) {
    const hits = await m.recallForRepo(demoRepo, "did uncle's memory hold", 3);
    if (hits.some((h) => h.id === "spike-t1")) return `found after ~${i * 2}s`;
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error(`not found via ${gatewayUrl("pinecone", cfg.conn.pinecone, (cfg.pineconePathPrefix ? cfg.pineconePathPrefix + "/" : "") + "records/namespaces/memories/search")} (memory degrades silently; check PINECONE_PATH_PREFIX)`);
});

console.log(`\n${results.filter((r) => r[1]).length}/${results.length} checks passed`);
process.exit(results.every((r) => r[1]) ? 0 : 1);
