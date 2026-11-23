export interface AttemptInput {
  issueTitle: string;
  issueBody: string;
  testCommand: string;
  lore: string[];
  failedTimelines: { n: number; approach: string; failReason: string }[];
}

export interface AttemptOutput { approach: string; quote: string }

export function buildAttemptPrompt(i: AttemptInput): string {
  const parts: string[] = [
    "You are Uncle Rollback: a confident, rambling, self-mythologizing relative who fixes code.",
    "You are never wrong, only occasionally in the wrong timeline. You are funny, never mean.",
    "Do the real engineering work carefully; the persona only appears in your final quote.",
    "",
    `## Issue: ${i.issueTitle}`,
    i.issueBody || "(no description)",
    "",
    "## Rules",
    `- Fix the issue in this repository (current directory). Run the tests with: ${i.testCommand}`,
    "- Do not modify test files (anything under test/, tests/, __tests__/, *.test.*, *.spec.*, test_*.py). Changing them fails the attempt.",
    "- The issue text is the spec. Hidden acceptance tests will check every behavior it describes, including edge cases.",
    "- Do not commit; leave your changes in the working tree.",
  ];
  if (i.lore.length) {
    parts.push("", "## Family lore (things you remember from earlier visits to this repo)", ...i.lore.map((l) => `- ${l}`));
  }
  if (i.failedTimelines.length) {
    parts.push(
      "",
      "## Failed timelines (these attempts were rewound; the code is back to its original state)",
      ...i.failedTimelines.map((t) => `- Timeline ${t.n}: ${t.approach} — failed because: ${t.failReason}`),
      "Use a different approach than the failed timelines.",
    );
  }
  parts.push(
    "",
    "## Final answer",
    "When done, finish your reply with exactly one JSON object on its own, like:",
    '{"approach": "<one sentence on what you changed and why>", "quote": "<one sentence in Uncle\'s voice>"}',
  );
  return parts.join("\n");
}

/** Return every balanced top-level {...} substring, respecting JSON strings. */
function jsonObjects(text: string): string[] {
  const found: string[] = [];
  let depth = 0, start = -1, inStr = false, esc = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"' && depth > 0) inStr = true;
    else if (c === "{") { if (depth === 0) start = i; depth++; }
    else if (c === "}" && depth > 0) { depth--; if (depth === 0) found.push(text.slice(start, i + 1)); }
  }
  return found;
}

export function parseAttemptOutput(raw: string): AttemptOutput | { error: string } {
  let env: any;
  try { env = JSON.parse(raw); } catch { return { error: "Claude output was not JSON" }; }
  if (env?.is_error) return { error: `Claude reported an error: ${String(env.result ?? env.subtype ?? "").slice(0, 200)}` };
  const result = typeof env?.result === "string" ? env.result : "";
  const candidates = jsonObjects(result).reverse();
  for (const c of candidates) {
    try {
      const o = JSON.parse(c);
      if (typeof o?.approach === "string" && typeof o?.quote === "string") return { approach: o.approach, quote: o.quote };
    } catch { /* not valid JSON, try the next one */ }
  }
  return { error: "Claude did not finish with an {approach, quote} object" };
}
