import { describe, expect, it } from "vitest";
import { formatTime } from "./draw";

describe("formatTime", () => {
  it("shows a placeholder when there is no run yet", () => {
    expect(formatTime(0)).toBe("-:--.--");
    expect(formatTime(Number.NaN)).toBe("-:--.--");
  });

  it("pads seconds so the digits do not jump", () => {
    expect(formatTime(3.5)).toBe("0:03.50");
    expect(formatTime(63.25)).toBe("1:03.25");
  });

  it("rolls into minutes", () => {
    expect(formatTime(125.5)).toBe("2:05.50");
  });
});
