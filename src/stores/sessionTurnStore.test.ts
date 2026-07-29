import { beforeEach, describe, expect, test } from "bun:test";
import {
  beginSessionTurn,
  endSessionTurn,
  getActiveSessionTurnIdsSnapshot,
  hasActiveSessionTurn,
  observeSessionTurnStatus,
  pruneSessionTurns,
  resetSessionTurnStoreForTests,
  subscribeSessionTurns,
} from "./sessionTurnStore";

describe("sessionTurnStore", () => {
  beforeEach(() => {
    resetSessionTurnStoreForTests();
  });

  test("派发后立即可见，不依赖任何渲染或定时器", () => {
    expect(hasActiveSessionTurn("tab-1")).toBe(false);
    beginSessionTurn("tab-1");
    expect(hasActiveSessionTurn("tab-1")).toBe(true);
  });

  test("状态尚未渲染成 running 的窗口内不得判定为已结束", () => {
    beginSessionTurn("tab-1");
    // 队列在 onExecute resolve 后的微任务里看到的仍是旧的 idle 状态。
    observeSessionTurnStatus("tab-1", false);
    expect(hasActiveSessionTurn("tab-1")).toBe(true);
  });

  test("观察到 active 之后再转非 active 才结束轮次", () => {
    beginSessionTurn("tab-1");
    observeSessionTurnStatus("tab-1", true);
    expect(hasActiveSessionTurn("tab-1")).toBe(true);
    observeSessionTurnStatus("tab-1", false);
    expect(hasActiveSessionTurn("tab-1")).toBe(false);
  });

  test("未派发 / 失败路径可同步注销，队列无需等待状态翻转", () => {
    const turnId = beginSessionTurn("tab-1");
    expect(endSessionTurn("tab-1", turnId)).toBe(true);
    expect(hasActiveSessionTurn("tab-1")).toBe(false);
  });

  test("迟到的旧轮回调不会注销新轮次", () => {
    const staleTurnId = beginSessionTurn("tab-1");
    const freshTurnId = beginSessionTurn("tab-1");
    expect(freshTurnId).not.toBe(staleTurnId);

    expect(endSessionTurn("tab-1", staleTurnId)).toBe(false);
    expect(hasActiveSessionTurn("tab-1")).toBe(true);

    expect(endSessionTurn("tab-1", freshTurnId)).toBe(true);
    expect(hasActiveSessionTurn("tab-1")).toBe(false);
  });

  test("重复派发采用 latest-wins，未注销的旧轮不会永久阻塞", () => {
    beginSessionTurn("tab-1");
    observeSessionTurnStatus("tab-1", true);
    const freshTurnId = beginSessionTurn("tab-1");
    // 新轮次重置观察标记，避免继承旧轮的 observedActive 而被立刻结束。
    observeSessionTurnStatus("tab-1", false);
    expect(hasActiveSessionTurn("tab-1")).toBe(true);
    expect(endSessionTurn("tab-1", freshTurnId)).toBe(true);
  });

  test("多会话互不干扰", () => {
    beginSessionTurn("tab-1");
    beginSessionTurn("tab-2");
    observeSessionTurnStatus("tab-1", true);
    observeSessionTurnStatus("tab-1", false);
    expect(hasActiveSessionTurn("tab-1")).toBe(false);
    expect(hasActiveSessionTurn("tab-2")).toBe(true);
  });

  test("prune 清理已关闭标签的孤儿轮次", () => {
    beginSessionTurn("tab-1");
    beginSessionTurn("tab-2");
    expect(pruneSessionTurns(new Set(["tab-2"]))).toBe(true);
    expect(hasActiveSessionTurn("tab-1")).toBe(false);
    expect(hasActiveSessionTurn("tab-2")).toBe(true);
    expect(pruneSessionTurns(new Set(["tab-2"]))).toBe(false);
  });

  test("快照与订阅在轮次增删时更新", () => {
    let notified = 0;
    const unsubscribe = subscribeSessionTurns(() => {
      notified += 1;
    });

    beginSessionTurn("tab-1");
    expect(notified).toBe(1);
    expect([...getActiveSessionTurnIdsSnapshot()]).toEqual(["tab-1"]);

    observeSessionTurnStatus("tab-1", true);
    // 仅记录观察标记，不改变活跃集合，不应触发订阅者。
    expect(notified).toBe(1);

    observeSessionTurnStatus("tab-1", false);
    expect(notified).toBe(2);
    expect([...getActiveSessionTurnIdsSnapshot()]).toEqual([]);

    unsubscribe();
    beginSessionTurn("tab-2");
    expect(notified).toBe(2);
  });

  test("空 session id 不产生记录", () => {
    expect(beginSessionTurn("  ")).toBe(0);
    expect(hasActiveSessionTurn("  ")).toBe(false);
  });
});
