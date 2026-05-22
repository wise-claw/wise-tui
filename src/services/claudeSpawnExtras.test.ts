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

import {
  buildClaudeSpawnExtrasFromAssistantRuntime,
  claudeAllowedToolsFromRuntimeTools,
  compactClaudeSpawnCliExtras,
} from "./claudeSpawnExtras";

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
});
