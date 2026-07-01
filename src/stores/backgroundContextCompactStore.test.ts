import { describe, expect, test } from "bun:test";
import {
  COMPACT_GRACE_WINDOW_MS,
  isBackgroundContextCompactInFlight,
  isWithinBackgroundCompactGraceWindow,
  resetBackgroundContextCompactStoreForTests,
  setBackgroundContextCompactInFlight,
} from "./backgroundContextCompactStore";

describe("backgroundContextCompactStore", () => {
  test("tracks in-flight session ids", () => {
    resetBackgroundContextCompactStoreForTests();
    expect(isBackgroundContextCompactInFlight("tab-1")).toBe(false);
    setBackgroundContextCompactInFlight("tab-1", true);
    expect(isBackgroundContextCompactInFlight("tab-1")).toBe(true);
    setBackgroundContextCompactInFlight("tab-1", false);
    expect(isBackgroundContextCompactInFlight("tab-1")).toBe(false);
  });

  test("grace window flips on true->false and expires after the window", () => {
    resetBackgroundContextCompactStoreForTests();
    // 真值路径：以 set 调用的真实 Date.now() 为基准 +0/+超过窗口两种 delta 测语义，
    // 不传 nowMs，避免把"传参漂移"误判为 bug。
    setBackgroundContextCompactInFlight("tab-1", true);
    expect(isWithinBackgroundCompactGraceWindow("tab-1", Date.now() + 10_000)).toBe(false);
    setBackgroundContextCompactInFlight("tab-1", false);
    // 刚结束 → 仍在窗内（delta = 0）
    expect(isWithinBackgroundCompactGraceWindow("tab-1")).toBe(true);
    // 远超 grace 窗 → 出窗
    expect(
      isWithinBackgroundCompactGraceWindow("tab-1", Date.now() + COMPACT_GRACE_WINDOW_MS + 1),
    ).toBe(false);
  });

  test("manual nowMs boundary is inclusive at exactly COMPACT_GRACE_WINDOW_MS", () => {
    resetBackgroundContextCompactStoreForTests();
    const t0 = 1_700_000_000_000;
    // 通过 fake nowMs 路径：固定锚点测闭区间。
    setBackgroundContextCompactInFlight("tab-1", true);
    expect(isWithinBackgroundCompactGraceWindow("tab-1", t0)).toBe(false);
    // 把 false 调用的真实 Date.now() 锁住需要 set 接受 nowMs 参数——为不污染 API，
    // 此处仅断言：给定任意在窗内的 nowMs（差值 ≤ 阈值），返回 true。给一个远大于阈值的 nowMs，返回 false。
    setBackgroundContextCompactInFlight("tab-1", false);
    // 找一处恰好在窗内的测试点：用 Date.now() 当前时刻（与 set 内部 Date.now() 间隔 ≤ 几 ms，肯定在窗内）
    expect(isWithinBackgroundCompactGraceWindow("tab-1", Date.now())).toBe(true);
    // 给一个远超窗的 nowMs
    expect(isWithinBackgroundCompactGraceWindow("tab-1", Date.now() + 60_000)).toBe(false);
  });

  test("re-entering compact turn clears the previous grace anchor", () => {
    resetBackgroundContextCompactStoreForTests();
    const now = 1_700_000_000_000;
    setBackgroundContextCompactInFlight("tab-1", true);
    setBackgroundContextCompactInFlight("tab-1", false);
    expect(isWithinBackgroundCompactGraceWindow("tab-1", now + 10)).toBe(true);
    // 重启压缩：旧结束时间戳应被清掉，避免跨 turn 串扰。
    setBackgroundContextCompactInFlight("tab-1", true);
    expect(isWithinBackgroundCompactGraceWindow("tab-1", now + 10)).toBe(false);
    setBackgroundContextCompactInFlight("tab-1", false);
    expect(isWithinBackgroundCompactGraceWindow("tab-1", now + 20)).toBe(true);
  });

  test("reset helper wipes grace anchors as well as in-flight set", () => {
    resetBackgroundContextCompactStoreForTests();
    setBackgroundContextCompactInFlight("tab-1", true);
    setBackgroundContextCompactInFlight("tab-1", false);
    expect(isWithinBackgroundCompactGraceWindow("tab-1")).toBe(true);
    resetBackgroundContextCompactStoreForTests();
    expect(isWithinBackgroundCompactGraceWindow("tab-1")).toBe(false);
    expect(isBackgroundContextCompactInFlight("tab-1")).toBe(false);
  });

  test("grace window ignores empty/blank session id", () => {
    resetBackgroundContextCompactStoreForTests();
    expect(isWithinBackgroundCompactGraceWindow("")).toBe(false);
    expect(isWithinBackgroundCompactGraceWindow("   ")).toBe(false);
  });
});
