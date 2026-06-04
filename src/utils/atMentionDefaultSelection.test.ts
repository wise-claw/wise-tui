import { describe, expect, test } from "bun:test";
import { DEFAULT_AT_MENTION_DEFAULT_TARGET } from "../constants/atMentionDefault";
import { resolveAtMentionSelectedIndex } from "./atMentionDefaultSelection";

describe("resolveAtMentionSelectedIndex", () => {
  const options = [
    { type: "execution_engine" as const, executionEngine: "claude" as const, name: "Claude Code" },
    { type: "execution_engine" as const, executionEngine: "codex" as const, name: "Codex CLI" },
    { type: "agent" as const, name: "终端01" },
    { type: "agent" as const, name: "终端02" },
  ];

  test("selects configured execution engine", () => {
    expect(
      resolveAtMentionSelectedIndex(options, { kind: "execution_engine", engine: "codex" }),
    ).toBe(1);
  });

  test("selects configured terminal by name", () => {
    expect(resolveAtMentionSelectedIndex(options, { kind: "terminal", employeeName: "终端02" })).toBe(
      3,
    );
  });

  test("falls back to first option when target missing", () => {
    expect(
      resolveAtMentionSelectedIndex(options, { kind: "terminal", employeeName: "不存在" }),
    ).toBe(0);
  });

  test("default claude engine is index 0", () => {
    expect(resolveAtMentionSelectedIndex(options, DEFAULT_AT_MENTION_DEFAULT_TARGET)).toBe(0);
  });
});
