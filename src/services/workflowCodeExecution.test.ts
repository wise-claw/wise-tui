import { describe, expect, test } from "bun:test";
import {
  codeConfigFromNodeData,
  normalizeCodeInputBindings,
  renderCodeExecutionBlock,
  summarizeCodeConfig,
} from "./workflowCodeExecution";

describe("workflowCodeExecution", () => {
  test("migrates legacy codeScript string", () => {
    const config = codeConfigFromNodeData({
      label: "RUN",
      codeScript: "bun test src/services/workflowGraphRuntime.test.ts",
    });
    expect(config.mode).toBe("command");
    expect(config.language).toBe("shell");
    expect(config.source).toContain("bun test");
  });

  test("renders block with bindings and variable substitution", () => {
    const block = renderCodeExecutionBlock(
      {
        mode: "command",
        language: "shell",
        source: "echo {{topic}} && echo {{alias}}",
        inputBindings: normalizeCodeInputBindings([{ id: "1", source: "topic", target: "alias" }]),
        outputVariables: [{ id: "1", name: "stdout", description: "命令输出" }],
        requireStructuredOutput: true,
      },
      { variables: { topic: "Wise" }, taskContent: "任务正文" },
    );
    expect(block).toContain("【代码执行");
    expect(block).toContain("Wise");
    expect(block).toContain("输入变量映射");
    expect(block).toContain("alias ← {{topic}}");
    expect(block).toContain("stdout");
    expect(block).toContain("结构化输出要求");
  });

  test("summarizes config for canvas node card", () => {
    const summary = summarizeCodeConfig({
      mode: "script",
      language: "typescript",
      source: "export function main() {}",
      inputBindings: [],
      outputVariables: [{ id: "1", name: "result" }],
      requireStructuredOutput: false,
    });
    expect(summary).toContain("脚本");
    expect(summary).toContain("TypeScript");
    expect(summary).toContain("输出 1");
  });
});
