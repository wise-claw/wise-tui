import { describe, expect, test } from "bun:test";
import { formatPatchKindEffectivenessHint } from "../services/sessionFeedbackConfigPatchEffectiveness";

describe("sessionFeedbackConfigPatchEffectiveness", () => {
  test("formatPatchKindEffectivenessHint renders kind stats", () => {
    const hint = formatPatchKindEffectivenessHint([
      {
        kind: "rule",
        count: 3,
        avgSessionScore: 4.2,
        avgRulesDelta: -50,
        score: 4.5,
      },
      {
        kind: "claude_md",
        count: 2,
        avgSessionScore: 2.1,
        avgRulesDelta: 10,
        score: 1.8,
      },
    ]);
    expect(hint).toContain("rule");
    expect(hint).toContain("n=3");
    expect(hint).toContain("claude_md");
  });
});
