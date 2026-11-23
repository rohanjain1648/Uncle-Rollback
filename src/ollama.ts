import { gatewayFetch, type FetchImpl } from "./gateway.js";
import type { Narrator } from "./narrate.js";

/** Tokens a polished text must keep verbatim: links, "Fixes #n" (closes the issue), markdown headings. */
export function requiredTokens(text: string): string[] {
  const urls = text.match(/https?:\/\/[^\s)>\]]+/g) ?? [];
  const fixes = text.match(/Fixes #\d+/g) ?? [];
  const headings = text.match(/^#{1,6} .+$/gm) ?? [];
  return [...urls, ...fixes, ...headings];
}

const SYSTEM = [
  "You are the copy editor for Uncle Rollback, a confident, rambling, self-mythologizing relative who fixes code.",
  "Rewrite the given GitHub comment so it sounds more like him: warm, funny, a bit too proud, never mean.",
  "Keep it about the same length. Keep every fact, every link, every markdown heading, and any 'Fixes #N' line exactly as written.",
  "Reply with the rewritten comment only.",
].join(" ");

/** Polishes Uncle's narration with a small model via the Ollama Cloud connector. Never loses facts: falls back to the input. */
export class OllamaNarrator implements Narrator {
  constructor(
    private connectionId: string,
    private model: string,
    private provider = "ollama",
    private fetchImpl: FetchImpl = fetch,
  ) {}

  async polish(text: string): Promise<string> {
    try {
      const res = await gatewayFetch(this.provider, this.connectionId, "api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: this.model,
          stream: false,
          messages: [{ role: "system", content: SYSTEM }, { role: "user", content: text }],
        }),
        signal: AbortSignal.timeout(30_000),
      }, this.fetchImpl);
      const out = String(((await res.json()) as any)?.message?.content ?? "").trim();
      if (!out) return text;
      const missing = requiredTokens(text).filter((t) => !out.includes(t));
      if (missing.length) {
        console.warn("[ollama] polish dropped required tokens, using original:", missing);
        return text;
      }
      return out;
    } catch (e) {
      console.warn("[ollama] polish failed, using original:", (e as Error).message);
      return text;
    }
  }
}
