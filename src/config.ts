export interface Config {
  ownerAllowlist: string[];
  repoAllowlist: string[];
  botLogin: string;
  webhookSecret: string;
  garageName: string;
  maxTimelines: number;
  attemptTimeoutMs: number;
  recallTopK: number;
  conn: { github: string; pinecone: string; sprites: string; ollama?: string };
  dbPath: string;
  acceptanceDir: string;
  publicUrl: string;
  /** Gateway path prefix in front of Pinecone's `records/...` paths; pinned by the spike. */
  pineconePathPrefix: string;
}

type Env = Record<string, string | undefined>;

function required(env: Env, key: string): string {
  const v = env[key]?.trim();
  if (!v) throw new Error(`Missing required env var ${key}`);
  return v;
}

function list(v: string | undefined): string[] {
  return (v ?? "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
}

function int(v: string | undefined, dflt: number): number {
  const n = v === undefined || v === "" ? dflt : Number(v);
  if (!Number.isInteger(n) || n <= 0) throw new Error(`Invalid integer: ${v}`);
  return n;
}

export function loadConfig(env: Env): Config {
  const ownerAllowlist = list(required(env, "OWNER_ALLOWLIST"));
  return {
    ownerAllowlist,
    repoAllowlist: list(env.REPO_ALLOWLIST),
    botLogin: required(env, "BOT_LOGIN").toLowerCase(),
    webhookSecret: required(env, "WEBHOOK_SECRET"),
    garageName: env.GARAGE_NAME?.trim() || "uncle-garage",
    maxTimelines: int(env.MAX_TIMELINES, 3),
    attemptTimeoutMs: int(env.ATTEMPT_TIMEOUT_MS, 300000),
    recallTopK: int(env.RECALL_TOP_K, 5),
    conn: {
      github: required(env, "CONN_GITHUB"),
      pinecone: required(env, "CONN_PINECONE"),
      sprites: required(env, "CONN_SPRITES"),
      ollama: env.CONN_OLLAMA?.trim() || undefined,
    },
    dbPath: env.DB_PATH?.trim() || "/data/uncle.db",
    acceptanceDir: env.ACCEPTANCE_DIR?.trim() || "acceptance",
    publicUrl: required(env, "PUBLIC_URL").replace(/\/+$/, ""),
    pineconePathPrefix: (env.PINECONE_PATH_PREFIX ?? "").trim().replace(/^\/+|\/+$/g, ""),
  };
}
