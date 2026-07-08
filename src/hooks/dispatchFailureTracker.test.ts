import { describe, expect, test } from "bun:test";
import { createDispatchFailureTracker } from "./dispatchFailureTracker";

/**
 * 派发失败追踪器的单元测试
 *
 * 覆盖核心契约：
 * - 首次失败 requeue + 退避（count * baseMs）。
 * - 重复失败 count 累加，退避线性增长。
 * - 达 max 次 drop，并清零该 fingerprint（后续同指纹从 0 重新计数）。
 * - onSuccess 清除计数（成功后下次失败不再叠加旧计数）。
 * - clear 清空所有计数（会话切换）。
 * - 不同 fingerprint 互不影响。
 * - max=1 边界（首次失败即 drop）。
 */

describe("createDispatchFailureTracker", () => {
  test("首次失败：requeue + 退避 = 1 * baseMs", () => {
    const t = createDispatchFailureTracker({ max: 3, baseMs: 2000 });
    const out = t.onFailure("fp1");
    expect(out).toEqual({ action: "requeue", backoffMs: 2000, count: 1 });
    expect(t.peek("fp1")).toBe(1);
  });

  test("重复失败：count 累加，退避线性增长", () => {
    const t = createDispatchFailureTracker({ max: 3, baseMs: 2000 });
    expect(t.onFailure("fp1")).toEqual({ action: "requeue", backoffMs: 2000, count: 1 });
    expect(t.onFailure("fp1")).toEqual({ action: "requeue", backoffMs: 4000, count: 2 });
    expect(t.peek("fp1")).toBe(2);
  });

  test("达 max 次：drop + 清零该 fingerprint", () => {
    const t = createDispatchFailureTracker({ max: 3, baseMs: 2000 });
    t.onFailure("fp1");
    t.onFailure("fp1");
    const out = t.onFailure("fp1");
    expect(out).toEqual({ action: "drop", backoffMs: 0, count: 3 });
    // drop 后清零：再次失败从 1 重新计数（用户手动重入队场景）
    expect(t.peek("fp1")).toBe(0);
    const again = t.onFailure("fp1");
    expect(again).toEqual({ action: "requeue", backoffMs: 2000, count: 1 });
  });

  test("max=1 边界：首次失败即 drop", () => {
    const t = createDispatchFailureTracker({ max: 1, baseMs: 1000 });
    expect(t.onFailure("fp1")).toEqual({ action: "drop", backoffMs: 0, count: 1 });
    expect(t.peek("fp1")).toBe(0);
  });

  test("onSuccess 清除计数：后续失败从 1 重新计数", () => {
    const t = createDispatchFailureTracker({ max: 3, baseMs: 2000 });
    t.onFailure("fp1");
    t.onFailure("fp1");
    expect(t.peek("fp1")).toBe(2);
    t.onSuccess("fp1");
    expect(t.peek("fp1")).toBe(0);
    // 成功后再次失败：不叠加旧计数
    expect(t.onFailure("fp1")).toEqual({ action: "requeue", backoffMs: 2000, count: 1 });
  });

  test("onSuccess 幂等：无该 fingerprint 时 no-op 不抛错", () => {
    const t = createDispatchFailureTracker();
    expect(() => t.onSuccess("never")).not.toThrow();
    t.onSuccess("never");
  });

  test("不同 fingerprint 互不影响", () => {
    const t = createDispatchFailureTracker({ max: 2, baseMs: 1000 });
    expect(t.onFailure("fp1")).toEqual({ action: "requeue", backoffMs: 1000, count: 1 });
    expect(t.onFailure("fp1")).toEqual({ action: "drop", backoffMs: 0, count: 2 }); // fp1 达上限 drop 并清零
    // fp2 不受 fp1 影响，从 1 开始
    expect(t.onFailure("fp2")).toEqual({ action: "requeue", backoffMs: 1000, count: 1 });
  });

  test("clear 清空所有 fingerprint 计数", () => {
    const t = createDispatchFailureTracker({ max: 3, baseMs: 2000 });
    t.onFailure("fp1");
    t.onFailure("fp2");
    t.onFailure("fp2");
    t.clear();
    expect(t.peek("fp1")).toBe(0);
    expect(t.peek("fp2")).toBe(0);
    // clear 后重新失败从 1 计数
    expect(t.onFailure("fp2")).toEqual({ action: "requeue", backoffMs: 2000, count: 1 });
  });

  test("默认参数：max=3, baseMs=2000", () => {
    const t = createDispatchFailureTracker();
    expect(t.onFailure("fp1")).toEqual({ action: "requeue", backoffMs: 2000, count: 1 });
    expect(t.onFailure("fp1")).toEqual({ action: "requeue", backoffMs: 4000, count: 2 });
    expect(t.onFailure("fp1")).toEqual({ action: "drop", backoffMs: 0, count: 3 });
  });

  test("典型竞态：连续两次失败后第三次成功 -> 计数清零", () => {
    const t = createDispatchFailureTracker({ max: 3, baseMs: 2000 });
    t.onFailure("fp1");
    t.onFailure("fp1");
    // 第三次派发成功
    t.onSuccess("fp1");
    expect(t.peek("fp1")).toBe(0);
    // 后续失败重新从 1 计数，不会因旧计数被误判 drop
    expect(t.onFailure("fp1")).toEqual({ action: "requeue", backoffMs: 2000, count: 1 });
  });
});
