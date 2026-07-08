import { describe, expect, test } from "bun:test";
import {
  createMainLaneDispatchGate,
  type MainLaneDispatchRecord,
} from "./mainLaneDispatchGate";

/**
 * 主 lane 派发握手门闸的单元测试
 *
 * 覆盖核心契约：
 * - mark 之后 canDispatch 必须为 false（hold 期间不再派发下一条 main）。
 * - release / releaseIfMatchesActive(active) 释放后 canDispatch 回归 true。
 * - releaseIfExpired 仅在 now - dispatchedAt >= ttlMs 时释放。
 * - 多次 mark latest-wins（防止前一条卡死后续）。
 * - 幂等：重复 release 不抛错、第二次返回 null。
 *
 * 关键 race 序列：mark → releaseIfMatchesActive(false) 不应释放（status 还没翻）→ releaseIfMatchesActive(true) 释放。
 */

function makeGate(options?: { now?: () => number; ttlMs?: number }) {
  return createMainLaneDispatchGate(options);
}

describe("createMainLaneDispatchGate", () => {
  test("初始 canDispatch === true", () => {
    const gate = makeGate();
    expect(gate.canDispatch()).toBe(true);
    expect(gate.peek()).toBeNull();
  });

  test("markDispatched 后 canDispatch === false", () => {
    const gate = makeGate();
    gate.markDispatched("m1");
    expect(gate.canDispatch()).toBe(false);
    expect(gate.peek()).toEqual<MainLaneDispatchRecord>({
      taskId: "m1",
      dispatchedAt: expect.any(Number) as number,
    });
  });

  test("markDispatched 接受外部 now（单测确定性）", () => {
    const gate = makeGate();
    gate.markDispatched("m1", 1000);
    expect(gate.peek()?.dispatchedAt).toBe(1000);
  });

  test("release 释放后 canDispatch 回归 true", () => {
    const gate = makeGate();
    gate.markDispatched("m1", 1000);
    const released = gate.release();
    expect(released).toEqual({ taskId: "m1", dispatchedAt: 1000 });
    expect(gate.canDispatch()).toBe(true);
    expect(gate.peek()).toBeNull();
  });

  test("release 幂等：无 record 时返回 null 不抛错", () => {
    const gate = makeGate();
    expect(gate.release()).toBeNull();
    expect(gate.canDispatch()).toBe(true);
  });

  test("releaseIfMatchesActive(true) 在有 record 时释放", () => {
    const gate = makeGate();
    gate.markDispatched("m1", 1000);
    const released = gate.releaseIfMatchesActive(true);
    expect(released).toEqual({ taskId: "m1", dispatchedAt: 1000 });
    expect(gate.canDispatch()).toBe(true);
  });

  test("releaseIfMatchesActive(true) 在无 record 时 no-op", () => {
    const gate = makeGate();
    expect(gate.releaseIfMatchesActive(true)).toBeNull();
    expect(gate.canDispatch()).toBe(true);
  });

  test("releaseIfMatchesActive(false) 永不释放（status 未翻）", () => {
    const gate = makeGate();
    gate.markDispatched("m1", 1000);
    expect(gate.releaseIfMatchesActive(false)).toBeNull();
    expect(gate.canDispatch()).toBe(false);
    expect(gate.peek()).toEqual({ taskId: "m1", dispatchedAt: 1000 });
  });

  test("releaseIfExpired 在 ttl 内 no-op（checkAt - dispatchedAt < ttlMs 不释放）", () => {
    const gate = makeGate({ ttlMs: 5000 });
    gate.markDispatched("m1", 1000);
    // 5999 - 1000 = 4999 < 5000，不释放
    expect(gate.releaseIfExpired(5999)).toBeNull();
    expect(gate.canDispatch()).toBe(false);
  });

  test("releaseIfExpired 在 ttl 到达时释放（checkAt - dispatchedAt >= ttlMs 释放）", () => {
    const gate = makeGate({ ttlMs: 5000 });
    gate.markDispatched("m1", 1000);
    // 6000 - 1000 = 5000 >= 5000，释放
    const released = gate.releaseIfExpired(6000);
    expect(released).toEqual({ taskId: "m1", dispatchedAt: 1000 });
    expect(gate.canDispatch()).toBe(true);
  });

  test("releaseIfExpired 边界：5999 仍 no-op，6000 释放（验证 < vs >= 一致性）", () => {
    const gate = makeGate({ ttlMs: 5000 });
    gate.markDispatched("m1", 1000);
    expect(gate.releaseIfExpired(5999)).toBeNull();
    expect(gate.releaseIfExpired(6000)).toEqual({
      taskId: "m1",
      dispatchedAt: 1000,
    });
  });

  test("releaseIfExpired 接受外部 ttlMs（覆盖默认）", () => {
    const gate = makeGate({ ttlMs: 999_999 });
    gate.markDispatched("m1", 1000);
    expect(gate.releaseIfExpired(10_000, 8000)).toEqual({
      taskId: "m1",
      dispatchedAt: 1000,
    });
    expect(gate.canDispatch()).toBe(true);
  });

  test("releaseIfExpired 无 record 时 no-op", () => {
    const gate = makeGate();
    expect(gate.releaseIfExpired(999_999)).toBeNull();
  });

  test("多次 markDispatched latest-wins（防止前一条卡死后续）", () => {
    const gate = makeGate();
    gate.markDispatched("m1", 1000);
    gate.markDispatched("m2", 2000);
    expect(gate.peek()).toEqual({ taskId: "m2", dispatchedAt: 2000 });
    // 释放时拿到的是最新一条
    expect(gate.release()).toEqual({ taskId: "m2", dispatchedAt: 2000 });
  });

  test("典型 race 序列：mark → status 未翻 → status 翻 → 释放", () => {
    const gate = makeGate();
    // 派发 m1
    gate.markDispatched("m1", 1000);
    expect(gate.canDispatch()).toBe(false);
    // onExecute 同步翻 store 但 React 重渲染延迟，status effect 还没跑
    expect(gate.releaseIfMatchesActive(false)).toBeNull();
    // 此时 m2 不应可派发
    expect(gate.canDispatch()).toBe(false);
    // 下次 status effect 跑到 idle→running
    expect(gate.releaseIfMatchesActive(true)).toEqual({
      taskId: "m1",
      dispatchedAt: 1000,
    });
    // 现在 m2 可派发
    expect(gate.canDispatch()).toBe(true);
  });

  test("并发阻断场景：mark → 立即 release（模拟 started===false）", () => {
    const gate = makeGate();
    gate.markDispatched("m1", 1000);
    // onExecute resolve 返回 false，立即 release 避免 hold 死锁
    expect(gate.release()).toEqual({ taskId: "m1", dispatchedAt: 1000 });
    // 后续 m2 立即可派发
    expect(gate.canDispatch()).toBe(true);
  });

  test("极端故障：onExecute 既不翻 status 也不抛错 → 5s 后自动释放", () => {
    const gate = makeGate({ ttlMs: 5000 });
    gate.markDispatched("m1", 1000);
    // 模拟定时器 effect 每 1s 轮询
    expect(gate.releaseIfExpired(2000)).toBeNull();
    expect(gate.releaseIfExpired(3000)).toBeNull();
    expect(gate.releaseIfExpired(5999)).toBeNull();
    expect(gate.canDispatch()).toBe(false);
    // 5s 到点
    expect(gate.releaseIfExpired(6001)).toEqual({
      taskId: "m1",
      dispatchedAt: 1000,
    });
    expect(gate.canDispatch()).toBe(true);
  });

  test("完整接力序列：m1 mark → release → m2 mark → release", () => {
    const gate = makeGate();
    // m1 派发
    gate.markDispatched("m1", 1000);
    expect(gate.canDispatch()).toBe(false);
    // m1 完成，status 翻 active
    expect(gate.releaseIfMatchesActive(true)).toEqual({
      taskId: "m1",
      dispatchedAt: 1000,
    });
    // m2 接力
    gate.markDispatched("m2", 2000);
    expect(gate.canDispatch()).toBe(false);
    // m2 完成
    expect(gate.releaseIfMatchesActive(true)).toEqual({
      taskId: "m2",
      dispatchedAt: 2000,
    });
    expect(gate.canDispatch()).toBe(true);
  });

  test("peek 不修改状态", () => {
    const gate = makeGate();
    gate.markDispatched("m1", 1000);
    expect(gate.peek()).toEqual({ taskId: "m1", dispatchedAt: 1000 });
    expect(gate.peek()).toEqual({ taskId: "m1", dispatchedAt: 1000 });
    expect(gate.canDispatch()).toBe(false);
  });
});
