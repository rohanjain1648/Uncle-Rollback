import { loadConfig, type Config } from "../src/config.js";

export function testConfig(over: Record<string, string> = {}): Config {
  return loadConfig({
    WEBHOOK_SECRET: "s3cret",
    BOT_LOGIN: "uncle-rollback",
    OWNER_ALLOWLIST: "alice",
    REPO_ALLOWLIST: "alice/pantry",
    CONN_GITHUB: "gh1",
    CONN_PINECONE: "pc1",
    CONN_SPRITES: "sp1",
    PUBLIC_URL: "https://brain.example",
    DB_PATH: ":memory:",
    ...over,
  });
}
