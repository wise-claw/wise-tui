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
  isOmcPluginInstalled: mock(async () => false),
  listClaudePluginCacheSkills: mock(async () => []),
  listClaudeProjectSkills: mock(async () => []),
  listClaudeSubagents: mock(async () => []),
  listClaudeUserSkills: mock(async () => [
    {
      name: "claude-global-skill",
      hasSkillMd: true,
      description: "Claude user skill",
      fileCount: 1,
      skillScope: "user",
      skillRootPath: "/Users/me/.claude/skills/claude-global-skill",
    },
  ]),
  runClaudeCliCommand: mock(async () => "ok"),
}));

mock.module("./codex", () => ({
  listCodexUserSkills: mock(async () => [
    {
      name: "find-skills",
      hasSkillMd: true,
      description: "Discover installable agent skills",
      fileCount: 2,
      skillScope: "user",
      skillRootPath: "/Users/me/.agents/skills/find-skills",
    },
  ]),
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

  test("installs plugin without full marketplace bootstrap", async () => {
    const market = await import("./claudePluginMarket");
    const bootstrap = market.claudePluginMarketBootstrap as ReturnType<typeof mock>;
    const install = market.claudePluginInstall as ReturnType<typeof mock>;
    bootstrap.mockClear();
    install.mockClear();

    const result = await executeComposerLocalSlashCommand(
      {
        kind: "plugin",
        raw: "/plugin install oh-my-claudecode@omc",
        plugin: { action: "install", installRef: "oh-my-claudecode@omc", scope: "user" },
      },
      { sessionId: "s1", repositoryPath: "/repo" },
    );

    expect(bootstrap).not.toHaveBeenCalled();
    expect(install).toHaveBeenCalledWith("oh-my-claudecode@omc", "user", "/repo");
    expect(result).toContain("## ✅ 插件安装完成");
  });

  test("skills command lists codex user skills under codex engine", async () => {
    const result = await executeComposerLocalSlashCommand(
      { kind: "skills", raw: "/skills" },
      {
        sessionId: "s1",
        repositoryPath: "/repo",
        session: { executionEngine: "codex-rpc" } as never,
      },
    );
    expect(result).toContain("【用户级 Codex Skills（~/.codex/skills 等）】");
    expect(result).toContain("find-skills");
    expect(result).not.toContain("【项目级 .claude/skills】");
  });

  test("skills command keeps claude user skills under claude engine", async () => {
    const result = await executeComposerLocalSlashCommand(
      { kind: "skills", raw: "/skills" },
      { sessionId: "s1", repositoryPath: "/repo" },
    );
    expect(result).toContain("【用户级 ~/.claude/skills】");
    expect(result).toContain("claude-global-skill");
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
