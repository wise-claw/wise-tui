import { describe, expect, test } from "bun:test";
import {
  clampTwoPaneSplitRatio,
  DEFAULT_TWO_PANE_SPLIT_RATIO,
  formatTwoPaneSplitGridTemplateColumns,
  formatTwoPaneSplitGridTemplateColumnsPx,
  resolveTwoPaneLeftWidthPx,
} from "./twoPaneSplitRatio";

describe("clampTwoPaneSplitRatio", () => {
  test("defaults to 0.5 for invalid container width", () => {
    expect(clampTwoPaneSplitRatio(0.3, 0, 420)).toBe(DEFAULT_TWO_PANE_SPLIT_RATIO);
  });

  test("clamps to minimum pane width on each side", () => {
    expect(clampTwoPaneSplitRatio(0.1, 1000, 420)).toBeCloseTo(0.42);
    expect(clampTwoPaneSplitRatio(0.9, 1000, 420)).toBeCloseTo(0.58);
  });

  test("preserves valid ratio inside bounds", () => {
    expect(clampTwoPaneSplitRatio(0.55, 1200, 420)).toBeCloseTo(0.55);
  });
});

describe("resolveTwoPaneLeftWidthPx", () => {
  test("aligns grid column and resizer to the same pixel boundary", () => {
    expect(resolveTwoPaneLeftWidthPx(0.5, 1000, 420)).toBe(500);
    expect(formatTwoPaneSplitGridTemplateColumnsPx(500)).toBe("500px minmax(0, 1fr)");
  });
});

describe("formatTwoPaneSplitGridTemplateColumns", () => {
  test("uses fr units so both panes shrink with container", () => {
    expect(formatTwoPaneSplitGridTemplateColumns(0.5)).toBe("0.5fr 0.5fr");
  });
});
