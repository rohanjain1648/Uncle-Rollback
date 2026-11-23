import { serve } from "@hono/node-server";
import { loadConfig } from "./config.js";
import { Db } from "./db.js";
import { SpritesGarage, spritesTransport } from "./garage.js";
import { GatewayGitHub } from "./github.js";
import { PineconeMemory } from "./memory.js";
import { IdentityNarrator } from "./narrate.js";
import { OllamaNarrator } from "./ollama.js";
import { JobQueue } from "./queue.js";
import { runJob, type Deps } from "./runner.js";
import { createApp, boot } from "./server.js";
import { readAcceptanceFrom } from "./acceptance.js";
import { withKeepAwake, socketTasks } from "./keepawake.js";

const cfg = loadConfig(process.env);
const db = new Db(cfg.dbPath);

const deps: Deps = {
  cfg,
  db,
  garage: new SpritesGarage(cfg, spritesTransport(cfg)),
  github: new GatewayGitHub(cfg),
  memory: new PineconeMemory(cfg),
  // Optional 4th connector: Ollama Cloud polishes Uncle's comments; falls back to the template text on any problem.
  narrator: cfg.conn.ollama
    ? new OllamaNarrator(cfg.conn.ollama, process.env.OLLAMA_MODEL ?? "gpt-oss:20b", process.env.OLLAMA_GATEWAY_PROVIDER ?? "ollama")
    : new IdentityNarrator(),
  readAcceptance: (repo, issue) => readAcceptanceFrom(cfg.acceptanceDir, repo, issue),
  now: () => Date.now(),
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
};

// Spike Step 8 decides whether an open exec keeps the brain awake; if not, set KEEP_AWAKE=tasks.
const runner = process.env.KEEP_AWAKE === "tasks" ? withKeepAwake(runJob, socketTasks()) : runJob;
const queue = new JobQueue(deps, runner);
const app = createApp({ cfg, db, queue });

const port = Number(process.env.PORT ?? 8080);
serve({ fetch: app.fetch, port, hostname: "0.0.0.0" }, () => console.log(`[uncle] brain listening on :${port}`));
boot({ db, queue });
