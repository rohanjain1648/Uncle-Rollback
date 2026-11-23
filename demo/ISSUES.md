# Issues to open on the demo repo

Open these two issues on `uncle-demo-pantry` (as yourself, not the bot), in this order. Then comment `@uncle fix this` on each.
They describe every behavior the hidden acceptance tests check, so the hidden tests are honest. Uncle just can't see them.

---

## Issue 1: parseQuantity breaks on mixed and unicode fractions

Grandma's recipes are full of quantities that `parseQuantity` gets wrong:

- Mixed numbers like `2 3/4` return `2` instead of `2.75`. Extra spaces (`"  1   1/4 "`) should be fine too.
- Unicode vulgar fractions (`½`, `¾`, `⅛`, `⅓`, and the rest) return `NaN`.
- A whole number glued to a unicode fraction (`1½`), or separated by a space (`2 ¼`), should work.
- Anything that isn't a quantity (`"a pinch"`, or a zero denominator like `1/0`) should throw a `RangeError` instead of quietly returning `NaN`.

## Issue 2: scaleRecipe accepts nonsense guest counts and returns ugly amounts

- `scaleRecipe(recipe, guests)` should throw a `RangeError` unless `guests` is a positive whole number (so `0`, `-2` and `2.5` all throw).
- Scaled amounts should be rounded to the nearest 1/8 (nobody measures 1.3333 cups).
- Rounding should never turn a non-zero amount into `0`. The smallest result is 1/8.
