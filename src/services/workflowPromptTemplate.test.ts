import { describe, expect, test } from "bun:test";
import {
  normalizePromptMessages,
  promptConfigFromNodeData,
  renderPromptConfigBlock,
  summarizePromptConfig,
} from "./workflowPromptTemplate";

describe("workflowPromptTemplate", () => {
  test("migrates legacy promptTemplate string to user message", () => {
    const config = promptConfigFromNodeData({
      label: "TPL",
      promptTemplate: "请处理 {{topic}}",
    });
    expect(config.messages).toHaveLength(1);
    expect(config.messages[0].role).toBe("user");
    expect(config.messages[0].content).toContain("{{topic}}");
  });

  test("renders structured multi-role block with variable substitution", () => {
    const block = renderPromptConfigBlock(
      {
        messages: [
          { id: "1", role: "system", content: "你是评审助手" },
          { id: "2", role: "user", content: "主题：{{topic}}" },
        ],
        injectionMode: "structured_block",
        requireAcknowledgement: true,
      },
      { variables: { topic: "工作流增强" }, taskContent: "原始任务" },
    );
    expect(block).toContain("System");
    expect(block).toContain("User");
    expect(block).toContain("工作流增强");
    expect(block).toContain("模板确认要求");
  });

  test("summarizes config for canvas node card", () => {
    const summary = summarizePromptConfig({
      messages: [{ id: "1", role: "user", content: "编写实现方案" }],
      injectionMode: "structured_block",
      requireAcknowledgement: false,
    });
    expect(summary).toContain("User");
    expect(summary).toContain("编写");
  });

  test("normalizes prompt messages array", () => {
    const messages = normalizePromptMessages([
      { id: "a", role: "user", content: "hello" },
      { id: "b", role: "invalid", content: "x" },
    ]);
    expect(messages[1].role).toBe("user");
  });
});
