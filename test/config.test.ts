import { describe, it, expect } from "vitest";
import { loadConfig } from "../src/config.js";

const base = {
  WEBHOOK_SECRET: "s3cret",
  BOT_LOGIN: "Uncle-Rollback",
  OWNER_ALLOWLIST: " Alice ,bob",
  REPO_ALLOWLIST: "Alice/Pantry",
  CONN_GITHUB: "gh1",
  CONN_PINECONE: "pc1",
  CONN_SPRITES: "sp1",
  PUBLIC_URL: "https://uncle-brain.sprites.app",
};

describe("loadConfig", () => {
  it("applies defaults", () => {
    const c = loadConfig(base);
    expect(c.maxTimelines).toBe(3);
    expect(c.attemptTimeoutMs).toBe(300000);
    expect(c.recallTopK).toBe(5);
    expect(c.garageName).toBe("uncle-garage");
    expect(c.dbPath).toBe("/data/uncle.db");
    expect(c.conn).toEqual({ github: "gh1", pinecone: "pc1", sprites: "sp1", ollama: undefined });
  });

  it("trims and lowercases allowlists and bot login", () => {
    const c = loadConfig(base);
    expect(c.ownerAllowlist).toEqual(["alice", "bob"]);
    expect(c.repoAllowlist).toEqual(["alice/pantry"]);
    expect(c.botLogin).toBe("uncle-rollback");
  });

  it("throws when WEBHOOK_SECRET is missing", () => {
    const { WEBHOOK_SECRET, ...rest } = base;
    expect(() => loadConfig(rest)).toThrow(/WEBHOOK_SECRET/);
  });

  it("throws when a required connection id is missing", () => {
    const { CONN_PINECONE, ...rest } = base;
    expect(() => loadConfig(rest)).toThrow(/CONN_PINECONE/);
  });

  it("parses numeric overrides", () => {
    const c = loadConfig({ ...base, MAX_TIMELINES: "2", ATTEMPT_TIMEOUT_MS: "1000" });
    expect(c.maxTimelines).toBe(2);
    expect(c.attemptTimeoutMs).toBe(1000);
  });
});
