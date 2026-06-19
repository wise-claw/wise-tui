import { describe, expect, test } from "bun:test";
import type { ClaudeHookHandler } from "../../types";
import {
  derivePluginRootFromSourcePath,
  formatHookOpenTargetTooltip,
  formatHookTargetPathTooltip,
  getHelpTextByTitle,
  getSupportedTypesByEvent,
  getSupportedTypesText,
  handlerSummary,
  resolveHookHandlerOpenTarget,
  resolveHookHandlerTargetPath,
} from "./helpers";

const baseHandler = (overrides: Partial<ClaudeHookHandler>): ClaudeHookHandler => ({
  id: "h1",
  type: "command",
  command: null,
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
  ...overrides,
});

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
    expect(
      handlerSummary(
        baseHandler({
          id: "h1",
          type: "http",
          url: "https://example.com",
        }),
      ),
    ).toBe("https://example.com");
  });

  test("resolveHookHandlerOpenTarget extracts repo-relative script path", () => {
    expect(
      resolveHookHandlerOpenTarget(
        baseHandler({ command: "python3 .claude/hooks/ralph-loop.py" }),
        "ralph-loop.py",
        { repositoryPath: "/Users/dev/repo" },
      ),
    ).toEqual({
      kind: "repository",
      repositoryPath: "/Users/dev/repo",
      relativePath: ".claude/hooks/ralph-loop.py",
    });
  });

  test("resolveHookHandlerOpenTarget picks last OMC hook script and resolves plugin root", () => {
    const pluginRoot = "/Users/dev/.claude/plugins/cache/omc/oh-my-claudecode/4.14.7";
    expect(
      resolveHookHandlerOpenTarget(
        baseHandler({
          command:
            'sh "$CLAUDE_PLUGIN_ROOT"/scripts/find-node.sh "$CLAUDE_PLUGIN_ROOT"/scripts/run.cjs "$CLAUDE_PLUGIN_ROOT"/scripts/pre-tool-enforcer.mjs',
        }),
        "*",
        {
          pluginSourcePaths: [`${pluginRoot}/hooks/hooks.json`],
        },
      ),
    ).toEqual({
      kind: "absolute",
      absolutePath: `${pluginRoot}/scripts/pre-tool-enforcer.mjs`,
    });
  });

  test("resolveHookHandlerOpenTarget handles empty plugin-root expansion artifacts", () => {
    const pluginRoot = "/Users/dev/.claude/plugins/cache/omc/oh-my-claudecode/4.14.7";
    expect(
      resolveHookHandlerOpenTarget(
        baseHandler({
          command: 'sh ""/scripts/find-node.sh ""/scripts/run.cjs ""/scripts/session-start.mjs',
        }),
        "*",
        {
          pluginSourcePaths: [`${pluginRoot}/hooks/hooks.json`],
        },
      ),
    ).toEqual({
      kind: "absolute",
      absolutePath: `${pluginRoot}/scripts/session-start.mjs`,
    });
  });

  test("resolveHookHandlerOpenTarget uses expanded absolute plugin paths", () => {
    const absoluteScript =
      "/Users/dev/.claude/plugins/cache/omc/oh-my-claudecode/4.14.7/scripts/session-start.mjs";
    expect(
      resolveHookHandlerOpenTarget(
        baseHandler({
          command: `sh /Users/dev/.claude/plugins/cache/omc/oh-my-claudecode/4.14.7/scripts/find-node.sh /Users/dev/.claude/plugins/cache/omc/oh-my-claudecode/4.14.7/scripts/run.cjs ${absoluteScript}`,
        }),
        "*",
      ),
    ).toEqual({
      kind: "absolute",
      absolutePath: absoluteScript,
    });
  });

  test("resolveHookHandlerOpenTarget falls back to matcher under .claude/hooks", () => {
    expect(
      resolveHookHandlerOpenTarget(
        baseHandler({ command: "bash -lc statusline" }),
        "statusline.py",
        { repositoryPath: "/Users/dev/repo" },
      ),
    ).toEqual({
      kind: "repository",
      repositoryPath: "/Users/dev/repo",
      relativePath: ".claude/hooks/statusline.py",
    });
  });

  test("derivePluginRootFromSourcePath reads hooks.json parent", () => {
    expect(
      derivePluginRootFromSourcePath(
        "/Users/dev/.claude/plugins/cache/omc/oh-my-claudecode/4.14.7/hooks/hooks.json",
      ),
    ).toBe("/Users/dev/.claude/plugins/cache/omc/oh-my-claudecode/4.14.7");
  });

  test("resolveHookHandlerTargetPath returns absolute display path", () => {
    expect(
      resolveHookHandlerTargetPath(
        baseHandler({ command: "python3 .claude/hooks/ralph-loop.py" }),
        "ralph-loop.py",
        { repositoryPath: "/Users/dev/repo" },
      ),
    ).toBe("/Users/dev/repo/.claude/hooks/ralph-loop.py");
  });

  test("formatHookOpenTargetTooltip renders absolute and repository targets", () => {
    expect(
      formatHookOpenTargetTooltip({
        kind: "absolute",
        absolutePath: "/Users/dev/.claude/plugins/cache/omc/oh-my-claudecode/4.14.7/scripts/session-start.mjs",
      }),
    ).toBe("/Users/dev/.claude/plugins/cache/omc/oh-my-claudecode/4.14.7/scripts/session-start.mjs");
    expect(
      formatHookOpenTargetTooltip({
        kind: "repository",
        repositoryPath: "/Users/dev/repo",
        relativePath: ".claude/hooks/statusline.py",
      }),
    ).toBe("/Users/dev/repo/.claude/hooks/statusline.py");
  });

  test("formatHookTargetPathTooltip joins repository root with relative path", () => {
    expect(formatHookTargetPathTooltip(".omc/scripts/session-start.mjs", "/Users/dev/repo")).toBe(
      "/Users/dev/repo/.omc/scripts/session-start.mjs",
    );
    expect(formatHookTargetPathTooltip(".omc/scripts/session-start.mjs", null)).toBe(
      ".omc/scripts/session-start.mjs",
    );
    expect(formatHookTargetPathTooltip(null, "/Users/dev/repo")).toBeUndefined();
  });
});
