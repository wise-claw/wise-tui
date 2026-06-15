import { describe, expect, test } from "bun:test";
import {
  buildExecutionEnvironmentWorkerRepositoryName,
  buildExecutionEnvironmentWorkerUserBubble,
  hasExecutionEnvironmentMention,
  listExecutionEnvironmentEngineMentionOptions,
  parseExecutionEnvironmentDispatch,
  parseExecutionEnvironmentWorkerRepositoryName,
} from "./executionEnvironmentDispatch";

describe("parseExecutionEnvironmentDispatch", () => {
  test("returns null without mention", () => {
    expect(parseExecutionEnvironmentDispatch("普通任务")).toBeNull();
  });

  test("defaults to single session for legacy @执行环境", () => {
    const plan = parseExecutionEnvironmentDispatch("@执行环境 修复登录 bug");
    expect(plan).not.toBeNull();
    expect(plan?.executionEngine).toBe("claude");
    expect(plan?.sessionCount).toBe(1);
    expect(plan?.cleanedPrompt).toBe("修复登录 bug");
  });

  test("parses @Claude Code mention", () => {
    const plan = parseExecutionEnvironmentDispatch("@Claude Code 写单元测试");
    expect(plan?.executionEngine).toBe("claude");
    expect(plan?.cleanedPrompt).toBe("写单元测试");
  });

  test("buildExecutionEnvironmentWorkerUserBubble strips @mention for worker display", () => {
    expect(buildExecutionEnvironmentWorkerUserBubble("@Claude Code 你好")).toBe("你好");
    expect(
      buildExecutionEnvironmentWorkerUserBubble("@Claude Code /oh-my-claudecode:autopilot 你好"),
    ).toBe("/oh-my-claudecode:autopilot 你好");
  });

  test("parses @Codex CLI mention", () => {
    const plan = parseExecutionEnvironmentDispatch("@Codex CLI 重构接口层");
    expect(plan?.executionEngine).toBe("codex");
    expect(plan?.cleanedPrompt).toBe("重构接口层");
  });

  test("parses @Gemini CLI mention", () => {
    const plan = parseExecutionEnvironmentDispatch("@Gemini CLI 生成测试用例");
    expect(plan?.executionEngine).toBe("gemini");
    expect(plan?.cleanedPrompt).toBe("生成测试用例");
  });

  test("parses @OpenCode mention", () => {
    const plan = parseExecutionEnvironmentDispatch("@OpenCode 重构模块");
    expect(plan?.executionEngine).toBe("opencode");
    expect(plan?.cleanedPrompt).toBe("重构模块");
  });

  test("parses numeric batch session count", () => {
    const plan = parseExecutionEnvironmentDispatch("@Claude Code 起5个会话来执行这批接口测试");
    expect(plan?.sessionCount).toBe(5);
    expect(plan?.cleanedPrompt).not.toMatch(/5\s*个会话/);
    expect(plan?.batchHint).toBeTruthy();
  });

  test("parses chinese numeral batch", () => {
    const plan = parseExecutionEnvironmentDispatch("@Codex CLI 启动三个会话处理拆分任务");
    expect(plan?.sessionCount).toBe(3);
    expect(plan?.executionEngine).toBe("codex");
  });

  test("parses implicit multi session", () => {
    const plan = parseExecutionEnvironmentDispatch("@执行环境 启动多个会话来处理这批任务");
    expect(plan?.sessionCount).toBe(2);
  });

  test("hasExecutionEnvironmentMention detects fullwidth at", () => {
    expect(hasExecutionEnvironmentMention("＠Claude Code 写测试")).toBe(true);
  });
});

describe("execution environment worker repository name", () => {
  test("encodes engine in worker tab name", () => {
    const name = buildExecutionEnvironmentWorkerRepositoryName("demo", "任务 1", "codex");
    expect(parseExecutionEnvironmentWorkerRepositoryName(name)).toEqual({
      engine: "codex",
      label: "任务 1",
    });
  });

  test("legacy worker tab without engine defaults to claude", () => {
    expect(parseExecutionEnvironmentWorkerRepositoryName("demo/执行环境:任务 1")).toEqual({
      engine: "claude",
      label: "任务 1",
    });
  });
});

describe("listExecutionEnvironmentEngineMentionOptions", () => {
  test("omits codex when not detected", () => {
    const rows = listExecutionEnvironmentEngineMentionOptions({
      codexAvailable: false,
      cursorAvailable: true,
    });
    expect(rows.find((r) => r.engine === "codex")).toBeUndefined();
    expect(rows.find((r) => r.engine === "claude")?.available).toBe(true);
    expect(rows).toHaveLength(2);
  });

  test("includes gemini and opencode when available", () => {
    const rows = listExecutionEnvironmentEngineMentionOptions({
      codexAvailable: true,
      cursorAvailable: false,
      geminiAvailable: true,
      opencodeAvailable: true,
    });
    expect(rows.map((r) => r.engine)).toEqual(["claude", "codex", "gemini", "opencode"]);
  });
});
