import { describe, expect, test } from "bun:test";
import { applySiderDragSnap, type SiderSnapState } from "./useSiderDragSnap";

const opts = { expandedWidth: 250, collapsedWidth: 64, hysteresisPx: 6 };
// snap point = 157, hysteresis band = [151, 163]

describe("applySiderDragSnap", () => {
  test("expanded → small inward drag stays expanded", () => {
    const prev: SiderSnapState = { width: 250, collapsed: false };
    const next = applySiderDragSnap(prev, -50, opts); // 250 - 50 = 200, > 163
    expect(next.collapsed).toBe(false);
    expect(next.width).toBe(200);
  });

  test("expanded → drag below (snap - hysteresis) snaps to collapsed", () => {
    const prev: SiderSnapState = { width: 250, collapsed: false };
    const next = applySiderDragSnap(prev, -100, opts); // 250 - 100 = 150, < 151
    expect(next.collapsed).toBe(true);
    expect(next.width).toBe(64);
  });

  test("expanded → drag inside hysteresis band stays expanded with new width", () => {
    const prev: SiderSnapState = { width: 250, collapsed: false };
    const next = applySiderDragSnap(prev, -90, opts); // 250 - 90 = 160, in [151,163]
    expect(next.collapsed).toBe(false);
    expect(next.width).toBe(160);
  });

  test("collapsed → small outward drag stays collapsed", () => {
    const prev: SiderSnapState = { width: 64, collapsed: true };
    const next = applySiderDragSnap(prev, 50, opts); // 64 + 50 = 114, < 151
    expect(next.collapsed).toBe(true);
    expect(next.width).toBe(114);
  });

  test("collapsed → drag above (snap + hysteresis) snaps to expanded", () => {
    const prev: SiderSnapState = { width: 64, collapsed: true };
    const next = applySiderDragSnap(prev, 110, opts); // 64 + 110 = 174, > 163
    expect(next.collapsed).toBe(false);
    expect(next.width).toBe(250);
  });

  test("collapsed → drag inside hysteresis band stays collapsed", () => {
    const prev: SiderSnapState = { width: 64, collapsed: true };
    const next = applySiderDragSnap(prev, 95, opts); // 64 + 95 = 159, in [151,163]
    expect(next.collapsed).toBe(true);
    expect(next.width).toBe(159);
  });

  test("hysteresis prevents flip-flop near midpoint", () => {
    let s: SiderSnapState = { width: 64, collapsed: true };
    // Up to 159 (in band, collapsed=true)
    s = applySiderDragSnap(s, 95, opts);
    expect(s.collapsed).toBe(true);
    // Wiggle back to 153 (still in band, still collapsed)
    s = applySiderDragSnap(s, -6, opts);
    expect(s.collapsed).toBe(true);
    // Forward to 161 (still in band, still collapsed because no upper crossing)
    s = applySiderDragSnap(s, 8, opts);
    expect(s.collapsed).toBe(true);
    // Now decisively cross above 163
    s = applySiderDragSnap(s, 5, opts); // 161 + 5 = 166, > 163
    expect(s.collapsed).toBe(false);
    expect(s.width).toBe(250);
  });

  test("clamps width to [collapsedWidth, expandedWidth]", () => {
    const fromExpanded = applySiderDragSnap({ width: 250, collapsed: false }, 200, opts);
    expect(fromExpanded.width).toBeLessThanOrEqual(250);
    const fromCollapsed = applySiderDragSnap({ width: 64, collapsed: true }, -200, opts);
    expect(fromCollapsed.width).toBeGreaterThanOrEqual(64);
  });

  test("default hysteresis is 6 when not provided", () => {
    const o = { expandedWidth: 250, collapsedWidth: 64 };
    const prev: SiderSnapState = { width: 250, collapsed: false };
    // 250 - 90 = 160, snap=157, band=[151,163]
    const next = applySiderDragSnap(prev, -90, o);
    expect(next.collapsed).toBe(false);
  });
});
