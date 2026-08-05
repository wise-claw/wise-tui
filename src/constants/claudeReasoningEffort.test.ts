import { describe, expect, test } from "bun:test";
import {
  CLAUDE_REASONING_EFFORT_DEFAULT,
  CLAUDE_REASONING_EFFORT_LABELS,
  CLAUDE_REASONING_EFFORTS,
  claudeReasoningEffortLabel,
  isClaudeReasoningEffort,
  normalizeClaudeReasoningEffort,
} from "./claudeReasoningEffort";

describe("claudeReasoningEffort", () => {
  test("六档与中文标签对齐 Claude Code --effort", () => {
    expect([...CLAUDE_REASONING_EFFORTS]).toEqual([
      "low",
      "medium",
      "high",
      "xhigh",
      "max",
      "ultracode",
    ]);
    expect(CLAUDE_REASONING_EFFORT_LABELS.low).toBe("轻度");
    expect(CLAUDE_REASONING_EFFORT_LABELS.medium).toBe("中");
    expect(CLAUDE_REASONING_EFFORT_LABELS.high).toBe("高");
    expect(CLAUDE_REASONING_EFFORT_LABELS.xhigh).toBe("极高");
    expect(CLAUDE_REASONING_EFFORT_LABELS.max).toBe("最高");
    expect(CLAUDE_REASONING_EFFORT_LABELS.ultracode).toBe("编排");
    expect(CLAUDE_REASONING_EFFORT_DEFAULT).toBe("high");
  });

  test("normalize 接受合法值并兜底默认", () => {
    expect(normalizeClaudeReasoningEffort("xhigh")).toBe("xhigh");
    expect(normalizeClaudeReasoningEffort(" MAX ")).toBe("max");
    expect(normalizeClaudeReasoningEffort("ultracode")).toBe("ultracode");
    expect(normalizeClaudeReasoningEffort(" ULTRACODE ")).toBe("ultracode");
    expect(normalizeClaudeReasoningEffort("nope")).toBe(CLAUDE_REASONING_EFFORT_DEFAULT);
    expect(normalizeClaudeReasoningEffort(null, "low")).toBe("low");
    expect(isClaudeReasoningEffort("medium")).toBe(true);
    expect(isClaudeReasoningEffort("ultracode")).toBe(true);
    expect(isClaudeReasoningEffort("minimal")).toBe(false);
    expect(claudeReasoningEffortLabel("high")).toBe("高");
    expect(claudeReasoningEffortLabel("ultracode")).toBe("编排");
  });
});
