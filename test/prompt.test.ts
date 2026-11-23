import { describe, it, expect } from "vitest";
import { buildAttemptPrompt, parseAttemptOutput } from "../src/prompt.js";

describe("buildAttemptPrompt", () => {
  const p = buildAttemptPrompt({
    issueTitle: "Unicode fractions break parseQuantity",
    issueBody: "½ cup returns NaN",
    testCommand: "npm test",
    lore: ["Timeline 2 of issue #3: I rewrote the parser in regex and it exploded"],
    failedTimelines: [{ n: 1, approach: "patched the split on spaces", failReason: "tests failed" }],
  });
  it("includes issue, test command, lore and failed timelines", () => {
    expect(p).toContain("Unicode fractions break parseQuantity");
    expect(p).toContain("½ cup returns NaN");
    expect(p).toContain("npm test");
    expect(p).toContain("I rewrote the parser in regex and it exploded");
    expect(p).toContain("patched the split on spaces");
    expect(p).toContain("tests failed");
  });
  it("carries the rules", () => {
    expect(p).toMatch(/do not modify test files/i);
    expect(p).toMatch(/different approach than the failed timelines/i);
    expect(p).toContain('{"approach"');
    expect(p).toContain('"quote"');
  });
  it("omits the failed-timelines section when there are none", () => {
    const q = buildAttemptPrompt({ issueTitle: "t", issueBody: "", testCommand: "npm test", lore: [], failedTimelines: [] });
    expect(q).not.toMatch(/different approach than the failed timelines/i);
  });
});

const envelope = (result: string) => JSON.stringify({ type: "result", subtype: "success", is_error: false, result });

describe("parseAttemptOutput", () => {
  it("extracts the last approach/quote object", () => {
    const r = parseAttemptOutput(envelope('I did stuff {"x":1}\n```json\n{"approach":"normalize unicode first","quote":"Never wrong, nephew."}\n```'));
    expect(r).toEqual({ approach: "normalize unicode first", quote: "Never wrong, nephew." });
  });
  it("handles a bare object with braces inside strings", () => {
    const r = parseAttemptOutput(envelope('done. {"approach":"use {a} map","quote":"Ha}"}'));
    expect(r).toEqual({ approach: "use {a} map", quote: "Ha}" });
  });
  it("errors on non-JSON envelope", () => {
    expect(parseAttemptOutput("Claude crashed")).toHaveProperty("error");
  });
  it("errors when the result has no JSON object", () => {
    expect(parseAttemptOutput(envelope("I fixed it, trust me"))).toHaveProperty("error");
  });
  it("errors when quote is missing", () => {
    expect(parseAttemptOutput(envelope('{"approach":"x"}'))).toHaveProperty("error");
  });
  it("errors when the envelope reports is_error", () => {
    expect(parseAttemptOutput(JSON.stringify({ type: "result", is_error: true, result: '{"approach":"a","quote":"q"}' }))).toHaveProperty("error");
  });
});
