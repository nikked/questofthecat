import { describe, expect, it } from "vitest";
import { MEOWS, randomMeow, type Meow } from "./audio";

describe("random meows", () => {
  for (const [sound, bounds] of Object.entries(MEOWS)) {
    it(`${sound} respects its bounds, including fixed parameters`, () => {
      for (const fraction of [0, 0.25, 0.5, 0.75, 1]) {
        const meow = randomMeow(bounds, () => fraction);
        for (const key of Object.keys(meow) as (keyof Meow)[]) {
          const [min, max] = bounds[key];
          expect(meow[key]).toBeGreaterThanOrEqual(min);
          expect(meow[key]).toBeLessThanOrEqual(max);
          if (fraction === 0) expect(meow[key]).toBe(min);
          if (fraction === 1) expect(meow[key]).toBeCloseTo(max);
        }
      }
    });

    it(`${sound} samples each parameter independently on every call`, () => {
      let calls = 0;
      const random = () => ++calls / 16;
      const first = randomMeow(bounds, random);
      const second = randomMeow(bounds, random);
      expect(calls).toBe(12);
      expect(second).not.toEqual(first);
      expect(first.pitch).toBeCloseTo(bounds.pitch[0] + (bounds.pitch[1] - bounds.pitch[0]) / 16);
      expect(first.rise).toBeCloseTo(bounds.rise[0] + (bounds.rise[1] - bounds.rise[0]) * 2 / 16);
    });
  }
});
