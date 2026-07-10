import { describe, expect, mock, test } from "bun:test";

const materializeClaudeSpawnMcpConfig = mock(async () => "/tmp/wise-spawn-mcp/test.json");

mock.module("./claude", () => ({
  materializeClaudeSpawnMcpConfig,
}));

mock.module("./assistantPromptLayers", () => ({
  resolveAssistantRuntime: mock(async () => ({
    assistantId: "builtin:test",
    source: "builtin",
    systemPrompt: "You are a test assistant.",
    tools: ["Read", "Edit", "Bash"],
    model: null,
    engineId: "claude",
    promptBundleJson: "{}",
    skillBundleJson: "{}",
    mcpBundleJson: JSON.stringify({
      disabled: [],
      custom: [{ id: "user::demo-mcp", label: "Demo MCP", origin: "builtin" }],
    }),
    engineeringJson: "{}",
  })),
}));

// ultracode 全局开关默认关闭；按测试需要可 override。
let mockedGlobalUltracodeRaw: string | null = '{"ultracode": false}';
mock.module("./appSettingsStore", () => ({
  getAppSetting: mock(async () => mockedGlobalUltracodeRaw),
  setAppSetting: mock(async () => undefined),
  WISE_CLAUDE_DEFAULT_SETTINGS_KEY: "wise.claudeDefaultSettings.v1",
}));

// 反馈神经网默认关闭，避免影响 appendSystemPrompt 断言。
mock.module("./wiseDefaultConfigStore", () => ({
  loadSessionFeedbackLoopSettingsFromStore: mock(async () => ({
    enabled: false,
    injectHabitsToSystemPrompt: false,
    injectGlobalRules: false,
    globalRules: [],
  })),
}));

import {
  buildClaudeSpawnExtrasFromAssistantRuntime,
  claudeAllowedToolsFromRuntimeTools,
  claudeSpawnExtrasForNativeSlashCommand,
  compactClaudeSpawnCliExtras,
  resolveClaudeSpawnExtrasForSession,
} from "./claudeSpawnExtras";
import { ULTRACODE_SYSTEM_PROMPT_BLOCK } from "../constants/ultracodeSystemPrompt";

describe("claudeSpawnExtras", () => {
  test("claudeAllowedToolsFromRuntimeTools joins tool names", () => {
    expect(claudeAllowedToolsFromRuntimeTools(["Read", " Edit ", ""])).toBe("Read, Edit");
    expect(claudeAllowedToolsFromRuntimeTools([])).toBeUndefined();
  });

  test("buildClaudeSpawnExtrasFromAssistantRuntime maps runtime fields", async () => {
    const extras = await buildClaudeSpawnExtrasFromAssistantRuntime({
      assistantId: "builtin:test",
      projectId: "p1",
      repositoryId: 3,
      repositoryPath: "/repo/a",
    });
    expect(extras).toEqual({
      allowedTools: "Read, Edit, Bash",
      appendSystemPrompt: "You are a test assistant.",
      mcpConfigPath: "/tmp/wise-spawn-mcp/test.json",
    });
    expect(materializeClaudeSpawnMcpConfig).toHaveBeenCalledWith({
      repositoryPath: "/repo/a",
      serverKeys: ["user::demo-mcp"],
      extraConfigPaths: [],
    });
  });

  test("compactClaudeSpawnCliExtras drops empty payload", () => {
    expect(compactClaudeSpawnCliExtras({})).toBeNull();
    expect(compactClaudeSpawnCliExtras({ addDirs: ["  ", ""] })).toBeNull();
  });

  test("claudeSpawnExtrasForNativeSlashCommand strips assistant runtime overrides", () => {
    expect(
      claudeSpawnExtrasForNativeSlashCommand({
        allowedTools: "Read",
        disallowedTools: "Bash",
        appendSystemPrompt: "You are Wise.",
        mcpConfigPath: "/tmp/mcp.json",
        strictMcpConfig: true,
        addDirs: ["/extra"],
      }),
    ).toEqual({ addDirs: ["/extra"] });
  });

  describe("resolveClaudeSpawnExtrasForSession ultracode merging", () => {
    const baseSession = {
      id: "s1",
      repositoryPath: "/repo/a",
      repositoryName: "repo",
    };
    const baseParams = {
      session: baseSession,
      projects: [],
      repositories: [],
      preferredProjectId: null,
      activeAssistantId: null,
    };

    test("全局关闭 + 未设 override → 不注入", async () => {
      mockedGlobalUltracodeRaw = '{"ultracode": false}';
      const extras = await resolveClaudeSpawnExtrasForSession(baseParams);
      // 仅 assistant runtime 注入；ultracode 不追加
      if (extras?.appendSystemPrompt) {
        expect(extras.appendSystemPrompt).not.toContain(ULTRACODE_SYSTEM_PROMPT_BLOCK);
      }
    });

    test("全局开启 → 注入 ultracode block", async () => {
      mockedGlobalUltracodeRaw = '{"ultracode": true}';
      const extras = await resolveClaudeSpawnExtrasForSession(baseParams);
      expect(extras?.appendSystemPrompt).toContain(ULTRACODE_SYSTEM_PROMPT_BLOCK);
      expect(extras?.effort).toBe("max");
    });

    test("per-session true beats global false → 注入", async () => {
      mockedGlobalUltracodeRaw = '{"ultracode": false}';
      const extras = await resolveClaudeSpawnExtrasForSession({
        ...baseParams,
        session: { ...baseSession, ultracodeEnabled: true },
      });
      expect(extras?.appendSystemPrompt).toContain(ULTRACODE_SYSTEM_PROMPT_BLOCK);
      expect(extras?.effort).toBe("max");
    });

    test("per-session false beats global true → 不注入", async () => {
      mockedGlobalUltracodeRaw = '{"ultracode": true}';
      const extras = await resolveClaudeSpawnExtrasForSession({
        ...baseParams,
        session: { ...baseSession, ultracodeEnabled: false },
      });
      expect(extras?.appendSystemPrompt ?? "").not.toContain(ULTRACODE_SYSTEM_PROMPT_BLOCK);
    });

    test("全局 JSON 读取失败时按关闭处理", async () => {
      mockedGlobalUltracodeRaw = "{not-json}";
      const extras = await resolveClaudeSpawnExtrasForSession(baseParams);
      expect(extras?.appendSystemPrompt ?? "").not.toContain(ULTRACODE_SYSTEM_PROMPT_BLOCK);
    });
  });
});
