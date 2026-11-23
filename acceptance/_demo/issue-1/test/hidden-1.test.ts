// Hidden acceptance tests for uncle-demo-pantry. Lives on the brain only; never in the demo repo or a PR.
import { describe, it, expect } from "vitest";
import { parseQuantity, scaleRecipe, type Recipe } from "../src/pantry.js";
describe("hidden: issue #1 mixed and unicode fractions", () => {
  it("parses mixed numbers", () => {
    expect(parseQuantity("2 3/4")).toBe(2.75);
    expect(parseQuantity("1 1/2")).toBe(1.5);
  });
  it("ignores surrounding whitespace and repeated spaces", () => {
    expect(parseQuantity("  1   1/4 ")).toBe(1.25);
  });
  it("parses unicode vulgar fractions", () => {
    expect(parseQuantity("½")).toBe(0.5);
    expect(parseQuantity("¾")).toBe(0.75);
    expect(parseQuantity("⅛")).toBe(0.125);
  });
  it("parses whole numbers followed by unicode fractions, with or without a space", () => {
    expect(parseQuantity("1½")).toBe(1.5);
    expect(parseQuantity("2 ¼")).toBe(2.25);
  });
  it("parses thirds closely enough", () => {
    expect(parseQuantity("1 ⅓")).toBeCloseTo(4 / 3, 6);
  });
  it("throws a RangeError for unparseable quantities instead of returning NaN", () => {
    expect(() => parseQuantity("a pinch")).toThrow(RangeError);
    expect(() => parseQuantity("1/0")).toThrow(RangeError);
  });
});
