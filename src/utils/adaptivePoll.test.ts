import { describe, expect, test } from "bun:test";
import { readVisiblePollIntervalMs, startAdaptiveInterval, stringSetEqual } from "./adaptivePoll";

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
      expect(readVisiblePollIntervalMs(1000, 5000)).toBe(5000);
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
});
