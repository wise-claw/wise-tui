import { describe, expect, test } from "bun:test";
import { clampRange, deriveAnchorFromRange, shiftAnchorEdge } from "./anchorEdits";

const PRD =
  "# Login flow\n" +
  "\n" +
  "用户登录后跳转到 dashboard。\n" +
  "登录失败提示错误。\n" +
  "支持忘记密码链接。\n";

describe("clampRange", () => {
  test("normalizes valid range", () => {
    expect(clampRange(PRD, 5, 10)).toEqual({ from: 5, to: 10 });
  });

  test("clamps negative from / oversized to", () => {
    expect(clampRange(PRD, -5, PRD.length + 100)).toEqual({ from: 0, to: PRD.length });
  });

  test("zero-length range expands to 1 char when text non-empty", () => {
    const r = clampRange(PRD, 10, 10);
    expect(r.to - r.from).toBe(1);
  });

  test("returns (0,0) for empty text", () => {
    expect(clampRange("", 5, 10)).toEqual({ from: 0, to: 0 });
  });
});

describe("deriveAnchorFromRange", () => {
  test("populates contextBefore / contextAfter + recomputes hash", () => {
    const anchor = deriveAnchorFromRange(PRD, 14, 28);
    expect(anchor.from).toBe(14);
    expect(anchor.to).toBe(28);
    expect(anchor.textHash).toMatch(/^[0-9a-f]{16}$/);
    expect(anchor.contextBefore.endsWith(PRD.slice(0, 14))).toBe(true);
    expect(anchor.contextAfter.startsWith(PRD.slice(28, 30))).toBe(true);
  });

  test("respects clamping", () => {
    const anchor = deriveAnchorFromRange(PRD, -10, PRD.length + 10);
    expect(anchor.from).toBe(0);
    expect(anchor.to).toBe(PRD.length);
  });

  test("same range produces same textHash deterministically", () => {
    const a = deriveAnchorFromRange(PRD, 14, 28);
    const b = deriveAnchorFromRange(PRD, 14, 28);
    expect(a.textHash).toBe(b.textHash);
  });

  test("different ranges produce different textHash", () => {
    const a = deriveAnchorFromRange(PRD, 14, 28);
    const b = deriveAnchorFromRange(PRD, 14, 27);
    expect(a.textHash).not.toBe(b.textHash);
  });
});

describe("shiftAnchorEdge", () => {
  const base = deriveAnchorFromRange(PRD, 14, 28);

  test("extends end edge forward", () => {
    const shifted = shiftAnchorEdge(base, "end", 5, PRD);
    expect(shifted.to).toBe(33);
    expect(shifted.from).toBe(14);
    expect(shifted.textHash).not.toBe(base.textHash);
  });

  test("retracts start edge inward", () => {
    const shifted = shiftAnchorEdge(base, "start", 4, PRD);
    expect(shifted.from).toBe(18);
    expect(shifted.to).toBe(28);
  });

  test("clamps when shifting past edges", () => {
    const right = shiftAnchorEdge(base, "end", 9999, PRD);
    expect(right.to).toBe(PRD.length);
    const left = shiftAnchorEdge(base, "start", -9999, PRD);
    expect(left.from).toBe(0);
  });

  test("auto-expands degenerate range to 1 char", () => {
    const collapsed = shiftAnchorEdge({ ...base, from: 20, to: 21 }, "end", -1, PRD);
    expect(collapsed.to - collapsed.from).toBe(1);
  });
});
