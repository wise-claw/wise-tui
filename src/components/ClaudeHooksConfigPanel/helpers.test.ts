import { describe, expect, test } from "bun:test";
import type { ClaudeHookHandler } from "../../types";
import { getHelpTextByTitle, getSupportedTypesByEvent, getSupportedTypesText, handlerSummary } from "./helpers";

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
    expect(getSupportedTypesText("SessionStart")).toBe("command");
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
});

