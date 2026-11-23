import { describe, it, expect } from "vitest";
import { parseQuantity, scaleRecipe, type Recipe } from "../src/pantry.js";

describe("parseQuantity", () => {
  it("parses whole numbers", () => {
    expect(parseQuantity("3")).toBe(3);
  });
  it("parses decimals", () => {
    expect(parseQuantity("0.5")).toBe(0.5);
  });
  it("parses simple fractions", () => {
    expect(parseQuantity("1/2")).toBe(0.5);
  });
});

const pie: Recipe = {
  title: "Pumpkin pie",
  serves: 8,
  ingredients: [
    { name: "pumpkin puree", qty: "2", unit: "cups" },
    { name: "sugar", qty: "1/2", unit: "cup" },
  ],
};

describe("scaleRecipe", () => {
  it("doubles a recipe", () => {
    expect(scaleRecipe(pie, 16)).toEqual([
      { name: "pumpkin puree", amount: 4, unit: "cups" },
      { name: "sugar", amount: 1, unit: "cup" },
    ]);
  });
  it("halves a recipe", () => {
    expect(scaleRecipe(pie, 4)[0].amount).toBe(1);
  });
});
