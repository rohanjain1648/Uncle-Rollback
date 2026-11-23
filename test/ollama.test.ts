import { describe, it, expect } from "vitest";
import { OllamaNarrator, requiredTokens } from "../src/ollama.js";

const TEXT = "Fixes #7\n\n## Family History\n- **Timeline 1** — split. *Rewound.*\n\n📸 Album: https://brain.example/job/abc12345";

function fake(content: string | null, status = 200) {
  const calls: { url: string; body: any }[] = [];
  const f = (async (url: any, init: any) => {
    calls.push({ url: String(url), body: JSON.parse(init.body) });
    return status === 200 ? Response.json({ message: { role: "assistant", content } }) : new Response("nope", { status });
  }) as typeof fetch;
  return { f, calls };
}

describe("requiredTokens", () => {
  it("collects urls, Fixes refs and markdown headings", () => {
    expect(requiredTokens(TEXT)).toEqual(["https://brain.example/job/abc12345", "Fixes #7", "## Family History"]);
  });
});

describe("OllamaNarrator", () => {
  it("sends a non-streaming chat request through the gateway", async () => {
    const { f, calls } = fake(TEXT + "\nExtra flavor.");
    await new OllamaNarrator("conn9", "gpt-oss:20b", "ollama", f).polish(TEXT);
    expect(calls[0].url).toBe("https://api.sprites.dev/v1/gateway/ollama/conn9/api/chat");
    expect(calls[0].body.model).toBe("gpt-oss:20b");
    expect(calls[0].body.stream).toBe(false);
    expect(calls[0].body.messages.at(-1).content).toContain(TEXT);
  });

  it("returns the polished text when every required token survives", async () => {
    const polished = "Well now.\n" + TEXT + "\nPass the gravy.";
    const { f } = fake(polished);
    expect(await new OllamaNarrator("c", "m", "ollama", f).polish(TEXT)).toBe(polished);
  });

  it("falls back to the original when the model drops a link or heading", async () => {
    const { f } = fake("Fixes #7. I fixed it. Trust me.");
    expect(await new OllamaNarrator("c", "m", "ollama", f).polish(TEXT)).toBe(TEXT);
  });

  it("falls back on gateway errors and empty replies", async () => {
    expect(await new OllamaNarrator("c", "m", "ollama", fake(null, 500).f).polish(TEXT)).toBe(TEXT);
    expect(await new OllamaNarrator("c", "m", "ollama", fake("").f).polish(TEXT)).toBe(TEXT);
  });
});
