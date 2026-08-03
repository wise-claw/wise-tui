import { describe, expect, test } from "bun:test";
import { sessionShouldRetainMessagesWhenInactive } from "./sessionMessagesRetainPolicy";

describe("sessionShouldRetainMessagesWhenInactive", () => {
  test("retains legacy /执行环境: workers", () => {
    expect(
      sessionShouldRetainMessagesWhenInactive({
        repositoryName: "demo/执行环境:Claude Code",
      }),
    ).toBe(true);
  });

  test("retains feedback-loop workers", () => {
    expect(
      sessionShouldRetainMessagesWhenInactive({
        repositoryName: "demo/神经网:分析",
      }),
    ).toBe(true);
  });

  test("retains @引擎 spawned tabs via executionEngine", () => {
    expect(
      sessionShouldRetainMessagesWhenInactive({
        repositoryName: "demo",
        executionEngine: "claude",
      }),
    ).toBe(true);
    expect(
      sessionShouldRetainMessagesWhenInactive({
        repositoryName: "demo · 1",
        executionEngine: "codex",
      }),
    ).toBe(true);
  });

  test("does not retain plain sessions without engine tag", () => {
    expect(
      sessionShouldRetainMessagesWhenInactive({
        repositoryName: "demo",
      }),
    ).toBe(false);
  });
});
