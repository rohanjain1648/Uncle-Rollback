// Hidden acceptance tests for uncle-demo-pantry. Lives on the brain only; never in the demo repo or a PR.
import { describe, it, expect } from "vitest";
import { parseQuantity, scaleRecipe, type Recipe } from "../src/pantry.js";
const stuffing: Recipe = {
  title: "Stuffing",
  serves: 3,
  ingredients: [
    { name: "bread cubes", qty: "1", unit: "loaf" },
    { name: "broth", qty: "1 1/2", unit: "cups" },
  ],
};

describe("hidden: issue #2 guest validation and eighths", () => {
  it("throws RangeError for zero, negative or fractional guest counts", () => {
    expect(() => scaleRecipe(stuffing, 0)).toThrow(RangeError);
    expect(() => scaleRecipe(stuffing, -2)).toThrow(RangeError);
    expect(() => scaleRecipe(stuffing, 2.5)).toThrow(RangeError);
  });
  it("rounds scaled amounts to the nearest 1/8", () => {
    const scaled = scaleRecipe(stuffing, 4);
    expect(scaled[0].amount).toBe(1.375); // 4/3 = 1.333… → 11/8
    expect(scaled[1].amount).toBe(2); // 2.0 exactly
  });
  it("never rounds a non-zero amount down to zero", () => {
    const tiny: Recipe = { title: "Gravy", serves: 12, ingredients: [{ name: "salt", qty: "1/8", unit: "tsp" }] };
    expect(scaleRecipe(tiny, 1)[0].amount).toBe(0.125);
  });
});
