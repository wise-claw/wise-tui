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
  test("non-destructive patches qualify regardless of source", () => {
    // append_section：向已存在文件追加章节，不覆盖既有内容
    expect(
      isLowRiskAutoApplyPatch({ kind: "claude_md", action: "append_section", source: "heuristic" }),
    ).toBe(true);
    expect(
      isLowRiskAutoApplyPatch({ kind: "memory", action: "append_section", source: "ai" }),
    ).toBe(true);
    // mcp disable：禁用 MCP server，可经备份回滚
    expect(
      isLowRiskAutoApplyPatch({ kind: "mcp", action: "disable", source: "heuristic" }),
    ).toBe(true);
    expect(
      isLowRiskAutoApplyPatch({ kind: "mcp", action: "disable", source: "ai" }),
    ).toBe(true);
  });

  test("destructive patches are excluded from auto-apply", () => {
    expect(
      isLowRiskAutoApplyPatch({ kind: "rule", action: "create", source: "heuristic" }),
    ).toBe(false);
    expect(
      isLowRiskAutoApplyPatch({ kind: "claude_md", action: "update", source: "heuristic" }),
    ).toBe(false);
    expect(
      isLowRiskAutoApplyPatch({ kind: "settings", action: "merge_json", source: "heuristic" }),
    ).toBe(false);
    // enable MCP 可能引入新副作用，需人工审阅
    expect(
      isLowRiskAutoApplyPatch({ kind: "mcp", action: "enable", source: "heuristic" }),
    ).toBe(false);
  });
});
