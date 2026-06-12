import { describe, expect, test } from "bun:test";
import type { ClaudeHookHandler } from "../../types";
import { getHelpTextByTitle, getSupportedTypesByEvent, getSupportedTypesText, handlerSummary, resolveHookHandlerTargetPath } from "./helpers";

describe("ClaudeHooksConfigPanel helpers", () => {
  test("getHelpTextByTitle combines paired lifecycle descriptions", () => {
    const text = getHelpTextByTitle("PostToolUse / PostToolUseFailure");
    expect(text).toContain("工具成功执行后触发");
    expect(text).toContain("工具执行失败后触发");
  });

  test("getSupportedTypesByEvent falls back to all types for unknown events", () => {
    expect(getSupportedTypesByEvent("UnknownEvent")).toEqual(["command", "http", "prompt", "agent"]);
  });

  test("getSupportedTypesText renders filtered types", () => {
    expect(getSupportedTypesText("SessionStart")).toBe("command / mcp_tool");
    expect(getSupportedTypesText("PostToolBatch")).toBe("command / http / mcp_tool / prompt / agent");
    expect(getSupportedTypesText("MessageDisplay")).toBe("command / http / mcp_tool");
  });

  test("handlerSummary reads the relevant field by handler type", () => {
    const handler: ClaudeHookHandler = {
      id: "h1",
      type: "http",
      url: "https://example.com",
      if: null,
      timeout: null,
      statusMessage: null,
      shell: null,
      async: null,
      asyncRewake: null,
      command: null,
      headers: null,
      allowedEnvVars: null,
      prompt: null,
      model: null,
    };
    expect(handlerSummary(handler)).toBe("https://example.com");
  });

  test("resolveHookHandlerTargetPath extracts script path from command", () => {
    expect(
      resolveHookHandlerTargetPath(
        {
          id: "h1",
          type: "command",
          command: "python3 .claude/hooks/ralph-loop.py",
          if: null,
          timeout: null,
          statusMessage: null,
          shell: null,
          async: null,
          asyncRewake: null,
          url: null,
          headers: null,
          allowedEnvVars: null,
          prompt: null,
          model: null,
        },
        "ralph-loop.py",
      ),
    ).toBe(".claude/hooks/ralph-loop.py");
  });

  test("resolveHookHandlerTargetPath falls back to matcher under .claude/hooks", () => {
    expect(
      resolveHookHandlerTargetPath(
        {
          id: "h2",
          type: "command",
          command: "bash -lc statusline",
          if: null,
          timeout: null,
          statusMessage: null,
          shell: null,
          async: null,
          asyncRewake: null,
          url: null,
          headers: null,
          allowedEnvVars: null,
          prompt: null,
          model: null,
        },
        "statusline.py",
      ),
    ).toBe(".claude/hooks/statusline.py");
  });
});

