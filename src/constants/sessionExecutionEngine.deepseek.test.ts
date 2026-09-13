import { describe, expect, test } from "bun:test";
import {
  SESSION_EXECUTION_ENGINE_LABELS,
  SESSION_EXECUTION_ENGINES_OFFERED,
  isSessionExecutionEngine,
  normalizeSessionExecutionEngine,
} from "./sessionExecutionEngine";

describe("deepseek execution engine identity", () => {
  test("is offered with built-in Chinese-friendly labels", () => {
    expect(SESSION_EXECUTION_ENGINES_OFFERED).toContain("deepseek");
    expect(SESSION_EXECUTION_ENGINE_LABELS.deepseek.title).toBe("DeepSeek Harness");
    expect(SESSION_EXECUTION_ENGINE_LABELS.deepseek.description).toContain("dsh");
  });

  test("normalizes and guards the engine id", () => {
    expect(normalizeSessionExecutionEngine("DeepSeek")).toBe("deepseek");
    expect(normalizeSessionExecutionEngine(" deepseek ")).toBe("deepseek");
    expect(isSessionExecutionEngine("deepseek")).toBe(true);
    expect(normalizeSessionExecutionEngine("unknown-engine")).toBe("claude");
  });
});
