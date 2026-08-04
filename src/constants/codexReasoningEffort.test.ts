import { describe, expect, test } from "bun:test";
import {
  CODEX_REASONING_EFFORT_DEFAULT,
  CODEX_REASONING_EFFORT_LABELS,
  CODEX_REASONING_EFFORTS,
  codexReasoningEffortLabel,
  isCodexReasoningEffort,
  normalizeCodexReasoningEffort,
} from "./codexReasoningEffort";

describe("codexReasoningEffort", () => {
  test("六档与中文标签对齐 ChatGPT 推理强度", () => {
    expect([...CODEX_REASONING_EFFORTS]).toEqual([
      "minimal",
      "low",
      "medium",
      "high",
      "xhigh",
      "ultra",
    ]);
    expect(CODEX_REASONING_EFFORT_LABELS.minimal).toBe("极低");
    expect(CODEX_REASONING_EFFORT_LABELS.low).toBe("轻度");
    expect(CODEX_REASONING_EFFORT_LABELS.medium).toBe("中");
    expect(CODEX_REASONING_EFFORT_LABELS.high).toBe("高");
    expect(CODEX_REASONING_EFFORT_LABELS.xhigh).toBe("极高");
    expect(CODEX_REASONING_EFFORT_LABELS.ultra).toBe("最高");
  });

  test("normalize 接受合法值并兜底默认", () => {
    expect(normalizeCodexReasoningEffort("xhigh")).toBe("xhigh");
    expect(normalizeCodexReasoningEffort(" XHIGH ")).toBe("xhigh");
    expect(normalizeCodexReasoningEffort("nope")).toBe(CODEX_REASONING_EFFORT_DEFAULT);
    expect(normalizeCodexReasoningEffort(null, "low")).toBe("low");
    expect(isCodexReasoningEffort("medium")).toBe(true);
    expect(isCodexReasoningEffort("max")).toBe(false);
    expect(codexReasoningEffortLabel("high")).toBe("高");
  });
});
