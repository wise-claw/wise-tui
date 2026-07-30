import { afterEach, describe, expect, test } from "bun:test";
import {
  MINUTE_TICK_INTERVAL_MS,
  getMinuteTick,
  isMinuteTickTimerActiveForTests,
  resetMinuteTickStoreForTests,
  subscribeMinuteTick,
} from "./minuteTickStore";

afterEach(() => {
  resetMinuteTickStoreForTests();
});

function setVisibility(state: "visible" | "hidden"): () => void {
  const original = Object.getOwnPropertyDescriptor(document, "visibilityState");
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => state,
  });
  return () => {
    if (original) Object.defineProperty(document, "visibilityState", original);
  };
}

describe("minuteTickStore", () => {
  test("心跳周期为一分钟：更短不值得整列表重渲染", () => {
    expect(MINUTE_TICK_INTERVAL_MS).toBe(60_000);
  });

  test("多个订阅者共用一个定时器，全部退订后不再空转", () => {
    if (typeof document === "undefined") return;
    const restore = setVisibility("visible");
    try {
      const unsubA = subscribeMinuteTick(() => {});
      expect(isMinuteTickTimerActiveForTests()).toBe(true);

      const unsubB = subscribeMinuteTick(() => {});
      expect(isMinuteTickTimerActiveForTests()).toBe(true);

      unsubA();
      // 仍有订阅者，定时器不应被提前清掉。
      expect(isMinuteTickTimerActiveForTests()).toBe(true);

      unsubB();
      expect(isMinuteTickTimerActiveForTests()).toBe(false);
    } finally {
      restore();
    }
  });

  test("窗口隐藏时停表，回到前台立即补一拍并复表", () => {
    if (typeof document === "undefined") return;
    let restore = setVisibility("visible");
    try {
      const unsub = subscribeMinuteTick(() => {});
      expect(isMinuteTickTimerActiveForTests()).toBe(true);
      const before = getMinuteTick();

      restore();
      restore = setVisibility("hidden");
      document.dispatchEvent(new Event("visibilitychange"));
      expect(isMinuteTickTimerActiveForTests()).toBe(false);
      expect(getMinuteTick()).toBe(before);

      restore();
      restore = setVisibility("visible");
      document.dispatchEvent(new Event("visibilitychange"));
      // 回到前台不能等满一分钟才刷新，否则会显示隐藏前的旧时间。
      expect(getMinuteTick()).toBe(before + 1);
      expect(isMinuteTickTimerActiveForTests()).toBe(true);

      unsub();
    } finally {
      restore();
    }
  });

  test("隐藏状态下新订阅不启动定时器", () => {
    if (typeof document === "undefined") return;
    const restore = setVisibility("hidden");
    try {
      const unsub = subscribeMinuteTick(() => {});
      expect(isMinuteTickTimerActiveForTests()).toBe(false);
      unsub();
    } finally {
      restore();
    }
  });
});
