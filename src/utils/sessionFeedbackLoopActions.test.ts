import { describe, expect, test } from "bun:test";
import {
  isLowRiskAutoApplyPatch,
  parseFeedbackLoopStructuredActions,
} from "./sessionFeedbackLoopActions";

describe("parseFeedbackLoopStructuredActions", () => {
  test("extracts numbered actions from 立即执行清单 section", () => {
    const text = `
## 分析
一些背景

## 立即执行清单
1. 执行 /compact 压缩上下文
2. 禁用未使用的 MCP server foo
3. 将习惯写入 composer 常用语
`;
    const actions = parseFeedbackLoopStructuredActions(text);
    expect(actions.length).toBe(3);
    expect(actions[0]?.kind).toBe("compact");
    expect(actions[1]?.kind).toBe("disable_mcp");
    expect(actions[2]?.kind).toBe("composer_phrase");
  });

  test("falls back to inline /compact when no list found", () => {
    const actions = parseFeedbackLoopStructuredActions("建议尽快 /compact 以释放上下文");
    expect(actions).toHaveLength(1);
    expect(actions[0]?.kind).toBe("compact");
  });

  test("links apply_patch to first pending patch id", () => {
    const text = `
## 可执行动作
- 应用配置补丁到 rules/exploration.md
`;
    const actions = parseFeedbackLoopStructuredActions(text, {
      pendingPatchIds: ["patch-abc"],
    });
    expect(actions[0]?.kind).toBe("apply_patch");
    expect(actions[0]?.patchId).toBe("patch-abc");
  });
});

describe("isLowRiskAutoApplyPatch", () => {
  test("only heuristic MCP disable patches qualify", () => {
    expect(
      isLowRiskAutoApplyPatch({ kind: "mcp", action: "disable", source: "heuristic" }),
    ).toBe(true);
    expect(
      isLowRiskAutoApplyPatch({ kind: "mcp", action: "disable", source: "ai" }),
    ).toBe(false);
    expect(
      isLowRiskAutoApplyPatch({ kind: "rule", action: "append", source: "heuristic" }),
    ).toBe(false);
  });
});
