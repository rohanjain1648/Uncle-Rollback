export interface Ingredient {
  name: string;
  /** Free-text quantity as written in the recipe, e.g. "2", "1/2", "2 3/4", "½". */
  qty: string;
  unit: string;
}

export interface Recipe {
  title: string;
  serves: number;
  ingredients: Ingredient[];
}

export interface ScaledIngredient {
  name: string;
  amount: number;
  unit: string;
}

/** Parse a recipe quantity like "2", "0.5", "1/2" into a number. */
export function parseQuantity(qty: string): number {
  const token = qty.trim().split(" ")[0];
  if (token.includes("/")) {
    const [num, den] = token.split("/");
    return Number(num) / Number(den);
  }
  return Number(token);
}

/** Scale every ingredient of `recipe` from `recipe.serves` people to `guests` people. */
export function scaleRecipe(recipe: Recipe, guests: number): ScaledIngredient[] {
  const factor = guests / recipe.serves;
  return recipe.ingredients.map((i) => ({
    name: i.name,
    amount: parseQuantity(i.qty) * factor,
    unit: i.unit,
  }));
}
