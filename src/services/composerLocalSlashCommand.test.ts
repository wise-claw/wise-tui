import { describe, expect, mock, test } from "bun:test";

mock.module("./claude", () => ({
  getClaudeHooksStatus: mock(async () => ({
    user: { sourcePath: "", disableAllHooks: false, hooks: {} },
    project: { sourcePath: "", disableAllHooks: false, hooks: {} },
    local: { sourcePath: "", disableAllHooks: false, hooks: {} },
    omc: { sourcePath: "", disableAllHooks: false, hooks: {} },
  })),
  getClaudeMcpRuntimeHealth: mock(async () => []),
  getClaudeMcpStatus: mock(async () => ({
    user: [],
    local: [],
    projectShared: [],
    legacyUserSettings: [],
    legacyProjectSettings: [],
    pluginMcp: [],
  })),
  listClaudeProjectSkills: mock(async () => []),
  listClaudeSubagents: mock(async () => []),
  listClaudeUserSkills: mock(async () => []),
  runClaudeCliCommand: mock(async () => "ok"),
}));

mock.module("./claudePluginMarket", () => ({
  claudePluginInstall: mock(async () => "installed"),
  claudePluginListInstalled: mock(async () => [
    { id: "oh-my-claudecode@omc", version: "1.0.0", scope: "user", enabled: true },
  ]),
  claudePluginMarketBootstrap: mock(async () => ({ ok: true, log: "" })),
  claudePluginUninstall: mock(async () => "removed"),
}));

const { executeComposerLocalSlashCommand } = await import("./composerLocalSlashCommand");

describe("executeComposerLocalSlashCommand", () => {
  test("returns redirect message without IPC", async () => {
    const result = await executeComposerLocalSlashCommand(
      {
        kind: "redirect",
        raw: "/agents",
        redirectMessage: "use team panel",
      },
      { sessionId: "s1", repositoryPath: "/repo" },
    );
    expect(result).toBe("use team panel");
  });

  test("lists plugins", async () => {
    const result = await executeComposerLocalSlashCommand(
      {
        kind: "plugin",
        raw: "/plugin list",
        plugin: { action: "list", scope: "user" },
      },
      { sessionId: "s1", repositoryPath: "/repo" },
    );
    expect(result).toContain("## 已安装插件");
    expect(result).toContain("oh-my-claudecode@omc");
  });

  test("runs marketplace add via cli and appends installed list", async () => {
    const result = await executeComposerLocalSlashCommand(
      {
        kind: "plugin",
        raw: "/plugin marketplace add Yeachan-Heo/oh-my-claudecode",
        plugin: {
          action: "marketplace_add",
          scope: "user",
          marketplaceSource: "Yeachan-Heo/oh-my-claudecode",
        },
      },
      { sessionId: "s1", repositoryPath: "/repo" },
    );
    expect(result).toContain("## ✅ 插件市场已添加");
    expect(result).toContain("oh-my-claudecode@omc");
  });

  test("formats session status", async () => {
    const result = await executeComposerLocalSlashCommand(
      { kind: "status", raw: "/status" },
      {
        sessionId: "s1",
        repositoryPath: "/repo",
        session: {
          id: "s1",
          claudeSessionId: "cc-1",
          repositoryPath: "/repo",
          repositoryName: "wise",
          model: "sonnet",
          status: "idle",
          messages: [],
          createdAt: 0,
          pendingPrompt: "",
        },
      },
    );
    expect(result).toContain("cc-1");
    expect(result).toContain("空闲");
  });
});
