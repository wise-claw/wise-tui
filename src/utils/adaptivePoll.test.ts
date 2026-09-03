import { describe, expect, test } from "bun:test";
import {
  pollInteractionReliefRef,
  readVisiblePollIntervalMs,
  scalePollIntervalMs,
  shouldDeferAdaptivePollTick,
  startAdaptiveInterval,
  stringSetEqual,
} from "./adaptivePoll";

describe("adaptivePoll", () => {
  test("stringSetEqual compares set membership", () => {
    expect(stringSetEqual(new Set(["a", "b"]), new Set(["b", "a"]))).toBe(true);
    expect(stringSetEqual(new Set(["a"]), new Set(["b"]))).toBe(false);
    expect(stringSetEqual(new Set(), new Set())).toBe(true);
  });

  test("readVisiblePollIntervalMs uses hidden interval when document is hidden", () => {
    if (typeof document === "undefined") return;
    const originalDescriptor = Object.getOwnPropertyDescriptor(document, "visibilityState");
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => "hidden",
    });
    try {
      expect(readVisiblePollIntervalMs(1000, 5000)).toBe(scalePollIntervalMs(5000));
    } finally {
      if (originalDescriptor) {
        Object.defineProperty(document, "visibilityState", originalDescriptor);
      }
    }
  });

  test("startAdaptiveInterval skips ticks while hidden and disposes cleanly", () => {
    if (typeof document === "undefined") return;
    const originalDescriptor = Object.getOwnPropertyDescriptor(document, "visibilityState");
    let visible = false;
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => (visible ? "visible" : "hidden"),
    });
    let ticks = 0;
    const dispose = startAdaptiveInterval(() => {
      ticks += 1;
    }, 20, 40);
    try {
      expect(ticks).toBe(0);
      visible = true;
      document.dispatchEvent(new Event("visibilitychange"));
      expect(ticks).toBe(1);
    } finally {
      dispose();
      if (originalDescriptor) {
        Object.defineProperty(document, "visibilityState", originalDescriptor);
      }
    }
  });

  test("shouldDeferAdaptivePollTick follows relief ref", () => {
    const prev = pollInteractionReliefRef.current;
    try {
      pollInteractionReliefRef.current = null;
      expect(shouldDeferAdaptivePollTick()).toBe(false);
      pollInteractionReliefRef.current = () => true;
      expect(shouldDeferAdaptivePollTick()).toBe(true);
      pollInteractionReliefRef.current = () => false;
      expect(shouldDeferAdaptivePollTick()).toBe(false);
    } finally {
      pollInteractionReliefRef.current = prev;
    }
  });

  test("startAdaptiveInterval skips ticks while interaction relief is active", () => {
    if (typeof document === "undefined") return;
    const originalDescriptor = Object.getOwnPropertyDescriptor(document, "visibilityState");
    const prevRelief = pollInteractionReliefRef.current;
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => "visible",
    });
    let defer = true;
    pollInteractionReliefRef.current = () => defer;
    let ticks = 0;
    const dispose = startAdaptiveInterval(() => {
      ticks += 1;
    }, 20, 40);
    try {
      document.dispatchEvent(new Event("visibilitychange"));
      expect(ticks).toBe(0);
      defer = false;
      document.dispatchEvent(new Event("visibilitychange"));
      expect(ticks).toBe(1);
    } finally {
      dispose();
      pollInteractionReliefRef.current = prevRelief;
      if (originalDescriptor) {
        Object.defineProperty(document, "visibilityState", originalDescriptor);
      }
    }
  });

  test("startAdaptiveInterval never overlaps slow asynchronous ticks", async () => {
    if (typeof document === "undefined") return;
    const originalDescriptor = Object.getOwnPropertyDescriptor(document, "visibilityState");
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => "visible",
    });
    const releases: Array<() => void> = [];
    let ticks = 0;
    const dispose = startAdaptiveInterval(
      () => new Promise<void>((resolve) => {
        ticks += 1;
        releases.push(resolve);
      }),
      1,
      10,
    );
    try {
      await new Promise((resolve) => setTimeout(resolve, 30));
      expect(ticks).toBe(1);
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(ticks).toBe(1);
      releases.shift()?.();
      await new Promise((resolve) => setTimeout(resolve, 30));
      expect(ticks).toBe(2);
    } finally {
      dispose();
      for (const release of releases) release();
      if (originalDescriptor) {
        Object.defineProperty(document, "visibilityState", originalDescriptor);
      }
    }
  });

  test("startAdaptiveInterval keeps polling after a synchronous failure", async () => {
    if (typeof document === "undefined") return;
    const originalDescriptor = Object.getOwnPropertyDescriptor(document, "visibilityState");
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => "visible",
    });
    let attempts = 0;
    const dispose = startAdaptiveInterval(() => {
      attempts += 1;
      if (attempts === 1) throw new Error("transient");
    }, 1, 10);
    try {
      await new Promise((resolve) => setTimeout(resolve, 30));
      expect(attempts).toBeGreaterThanOrEqual(2);
    } finally {
      dispose();
      if (originalDescriptor) {
        Object.defineProperty(document, "visibilityState", originalDescriptor);
      }
    }
  });
});
