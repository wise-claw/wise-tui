import { describe, expect, it } from "bun:test";
import {
  computeGraphVirtualRange,
  isGraphEdgeVisible,
  shouldVirtualizeGraphRows,
} from "./graphVirtualRange";

describe("graphVirtualRange", () => {
  it("virtualizes only above threshold", () => {
    expect(shouldVirtualizeGraphRows(50)).toBe(false);
    expect(shouldVirtualizeGraphRows(51)).toBe(true);
  });

  it("computes visible row range with overscan", () => {
    const range = computeGraphVirtualRange(480, 240, 200, 48, 4);
    expect(range.start).toBe(6);
    expect(range.end).toBe(19);
  });

  it("detects edges crossing visible band", () => {
    const range = { start: 20, end: 40 };
    expect(isGraphEdgeVisible({ fromRow: 10, toRow: 25 }, range, 5)).toBe(true);
    expect(isGraphEdgeVisible({ fromRow: 0, toRow: 5 }, range, 5)).toBe(false);
  });
});
