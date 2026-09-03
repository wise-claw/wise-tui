import { describe, expect, test } from "bun:test";
import { createPointerClickGate } from "./pointerClickGate";

describe("createPointerClickGate", () => {
  test("pointerdown 后紧跟 click 只触发一次", () => {
    const gate = createPointerClickGate();
    let n = 0;
    expect(gate.tryInvoke(() => {
      n += 1;
    })).toBe(true);
    expect(gate.tryInvoke(() => {
      n += 1;
    })).toBe(false);
    expect(n).toBe(1);
  });

  test("事件队列结束后未阻塞则可再次触发", async () => {
    const gate = createPointerClickGate();
    let n = 0;
    gate.tryInvoke(() => {
      n += 1;
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(gate.tryInvoke(() => {
      n += 1;
    })).toBe(true);
    expect(n).toBe(2);
  });

  test("isBlocked 为 true 时超时后仍保持锁定，reset 后恢复", async () => {
    let blocked = false;
    const gate = createPointerClickGate({ isBlocked: () => blocked });
    let n = 0;
    blocked = false;
    expect(gate.tryInvoke(() => {
      n += 1;
    })).toBe(true);
    blocked = true;
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(gate.tryInvoke(() => {
      n += 1;
    })).toBe(false);
    expect(n).toBe(1);
    blocked = false;
    gate.reset();
    expect(gate.tryInvoke(() => {
      n += 1;
    })).toBe(true);
    expect(n).toBe(2);
  });

  test("一开始就被阻塞时不进入锁", () => {
    const gate = createPointerClickGate({ isBlocked: () => true });
    let n = 0;
    expect(gate.tryInvoke(() => {
      n += 1;
    })).toBe(false);
    expect(n).toBe(0);
  });
});
