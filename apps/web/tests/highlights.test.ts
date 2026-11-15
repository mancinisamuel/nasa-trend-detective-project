import { describe, expect, it } from "vitest";

import {
  extremePoints,
  HIGHLIGHT,
  trendDirection,
} from "../src/features/evidence/chartHighlights";

describe("chart highlights (UI-DESIGN-10)", () => {
  it("picks the highest and lowest delivered value without computing anything new", () => {
    expect(
      extremePoints([
        { year: 2000, value: 1.5 },
        { year: 2001, value: null },
        { year: 2002, value: 3.25 },
        { year: 2003, value: -0.5 },
        { year: 2004, value: 3.25 },
      ]),
    ).toEqual({
      max: { year: 2002, value: 3.25 },
      min: { year: 2003, value: -0.5 },
    });
  });

  it("marks nothing for fewer than two values or a flat series", () => {
    expect(extremePoints([])).toBeNull();
    expect(extremePoints([{ year: 2000, value: 1 }])).toBeNull();
    expect(
      extremePoints([
        { year: 2000, value: 2 },
        { year: 2001, value: 2 },
      ]),
    ).toBeNull();
  });

  it("takes the arrow from the sign of the API slope", () => {
    expect(trendDirection(0.45)).toBe("up");
    expect(trendDirection(-0.1)).toBe("down");
    expect(trendDirection(0)).toBe("flat");
  });

  it("uses the same colours as the highlight tokens", () => {
    expect(HIGHLIGHT.max).toBe("#f08a3c");
    expect(HIGHLIGHT.min).toBe("#4aa8e0");
  });
});
