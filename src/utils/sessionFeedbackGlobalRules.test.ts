import { describe, expect, test } from "bun:test";
import type { FeedbackConfigPatch } from "./sessionFeedbackConfigPatch";
import {
  buildFeedbackGlobalRulesSystemPromptBlock,
  buildGlobalRuleFromPatch,
  isPatchPromotableToGlobalRule,
  isPatchSuggestedForGlobalPromotion,
  normalizeFeedbackGlobalRules,
  upsertGlobalRule,
} from "./sessionFeedbackGlobalRules";

function patch(partial: Partial<FeedbackConfigPatch>): FeedbackConfigPatch {
  return {
    id: "p1",
    kind: "rule",
    action: "append_section",
    path: ".claude/rules/explore.md",
    rationale: "减少重复 Grep",
    content: "- 合并相邻 Read/Grep 步骤",
    source: "ai",
    status: "applied",
    ...partial,
  };
}

describe("sessionFeedbackGlobalRules", () => {
  test("isPatchPromotableToGlobalRule accepts applied text patches", () => {
    expect(isPatchPromotableToGlobalRule(patch({}))).toBe(true);
    expect(isPatchPromotableToGlobalRule(patch({ status: "pending" }))).toBe(false);
    expect(isPatchPromotableToGlobalRule(patch({ action: "enable", kind: "mcp" }))).toBe(false);
  });

  test("isPatchSuggestedForGlobalPromotion uses score threshold", () => {
    expect(isPatchSuggestedForGlobalPromotion(patch({ source: "heuristic" }), 70)).toBe(true);
    expect(isPatchSuggestedForGlobalPromotion(patch({ source: "heuristic" }), 50)).toBe(false);
    expect(isPatchSuggestedForGlobalPromotion(patch({ source: "ai" }), null)).toBe(true);
  });

  test("buildGlobalRuleFromPatch and system prompt block", () => {
    const rule = buildGlobalRuleFromPatch(patch({}), { repositoryPath: "/repo" });
    expect(rule.title).toContain("rule");
    expect(rule.body).toContain("Read/Grep");
    const block = buildFeedbackGlobalRulesSystemPromptBlock([rule]);
    expect(block).toContain("全局配置规则");
    expect(block).toContain("Read/Grep");
  });

  test("normalizeFeedbackGlobalRules dedupes by id", () => {
    const rules = normalizeFeedbackGlobalRules([
      { id: "a", title: "t", body: "b", promotedAt: 1, enabled: true },
      { id: "a", title: "t2", body: "b2", promotedAt: 2, enabled: true },
    ]);
    expect(rules).toHaveLength(1);
  });

  test("upsertGlobalRule replaces same sourcePatchId", () => {
    const first = buildGlobalRuleFromPatch(patch({ id: "patch-1" }));
    const second = buildGlobalRuleFromPatch(patch({ id: "patch-1", content: "updated" }));
    const merged = upsertGlobalRule([first], second);
    expect(merged).toHaveLength(1);
    expect(merged[0]?.body).toContain("updated");
  });
});
