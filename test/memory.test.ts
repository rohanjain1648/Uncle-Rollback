import { describe, it, expect } from "vitest";
import { PineconeMemory, type MemoryRecord } from "../src/memory.js";
import { testConfig } from "./helpers.js";

function recorder(respond: (url: string, init: RequestInit) => Response) {
  const calls: { url: string; init: RequestInit }[] = [];
  const f = (async (url: any, init: any) => { calls.push({ url: String(url), init }); return respond(String(url), init); }) as typeof fetch;
  return { f, calls };
}

const rec: MemoryRecord = {
  id: "abc12345-t1", text: "Timeline 1: patched split; tests failed", repo: "alice/pantry", issue: 7,
  job_id: "abc12345", timeline: 1, outcome: "failed", created_at: "2026-11-24T00:00:00.000Z",
};

describe("PineconeMemory", () => {
  const cfg = testConfig({ PINECONE_PATH_PREFIX: "indexes/uncle-memories" });

  it("upserts one flat record into the memories namespace via the gateway", async () => {
    const { f, calls } = recorder(() => new Response("", { status: 201 }));
    await new PineconeMemory(cfg, f).remember(rec);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://api.sprites.dev/v1/gateway/pinecone/pc1/indexes/uncle-memories/records/namespaces/memories/upsert");
    const body = JSON.parse(String(calls[0].init.body).trim());
    expect(body).toEqual({
      _id: "abc12345-t1", text: rec.text, repo: "alice/pantry", issue: 7, job_id: "abc12345",
      timeline: 1, outcome: "failed", created_at: rec.created_at,
    });
    expect(body).not.toHaveProperty("metadata");
  });

  it("searches by repo with top_k and maps hits back", async () => {
    const hit = { _id: rec.id, _score: 0.9, fields: { ...rec, id: undefined } };
    const { f, calls } = recorder(() => Response.json({ result: { hits: [hit] } }));
    const out = await new PineconeMemory(cfg, f).recallForRepo("alice/pantry", "fraction bug", 5);
    const body = JSON.parse(String(calls[0].init.body));
    expect(calls[0].url).toMatch(/records\/namespaces\/memories\/search$/);
    expect(body.query.top_k).toBe(5);
    expect(body.query.inputs).toEqual({ text: "fraction bug" });
    expect(body.query.filter).toEqual({ repo: { $eq: "alice/pantry" } });
    expect(out).toEqual([rec]);
  });

  it("recalls a job's timelines by job_id filter", async () => {
    const { f, calls } = recorder(() => Response.json({ result: { hits: [] } }));
    await new PineconeMemory(cfg, f).recallForJob("abc12345");
    expect(JSON.parse(String(calls[0].init.body)).query.filter).toEqual({ job_id: { $eq: "abc12345" } });
  });

  it("degrades on gateway errors", async () => {
    const { f } = recorder(() => new Response("boom", { status: 500 }));
    const m = new PineconeMemory(cfg, f);
    await expect(m.remember(rec)).resolves.toBeUndefined();
    await expect(m.recallForRepo("alice/pantry", "x", 5)).resolves.toEqual([]);
    await expect(m.recallForJob("abc12345")).resolves.toEqual([]);
  });
});
