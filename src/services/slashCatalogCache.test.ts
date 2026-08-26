import { beforeEach, describe, expect, mock, test } from "bun:test";

const fetchCalls: string[] = [];

mock.module("@tauri-apps/api/core", () => ({
  invoke: mock(async () => []),
  isTauri: mock(() => true),
}));

// 保留 composerLocalSlashCommand 等测试文件依赖的导出：bun 的 mock.module 注册表按进程
// 共享，缺导出会在模块解析期抛 SyntaxError，污染同轮测试。
mock.module("./claude", () => ({
  getClaudeHooksStatus: async () => ({
    user: { sourcePath: "", disableAllHooks: false, hooks: {} },
    project: { sourcePath: "", disableAllHooks: false, hooks: {} },
    local: { sourcePath: "", disableAllHooks: false, hooks: {} },
    omc: { sourcePath: "", disableAllHooks: false, hooks: {} },
  }),
  getClaudeMcpRuntimeHealth: async () => [],
  getClaudeMcpStatus: async () => ({
    user: [],
    local: [],
    projectShared: [],
    legacyUserSettings: [],
    legacyProjectSettings: [],
    pluginMcp: [],
  }),
  isOmcPluginInstalled: async () => false,
  listClaudePluginCacheSkills: async (repo: string | null) => {
    fetchCalls.push(`cache:${repo ?? "__global__"}`);
    return [];
  },
  listClaudeProjectSkills: async (repo: string) => {
    fetchCalls.push(`project:${repo}`);
    return [];
  },
  listClaudeSubagents: async () => [],
  listClaudeUserSkills: async () => {
    fetchCalls.push("user:global");
    return [];
  },
  runClaudeCliCommand: async () => "ok",
}));

mock.module("./codex", () => ({
  listCodexUserSkills: async () => {
    fetchCalls.push("codex-user:global");
    return [];
  },
}));

// 与 composerLocalSlashCommand 测试共用 mock 注册表：补齐该模块的其它导出。
mock.module("./claudePluginMarket", () => ({
  claudePluginInstall: async () => "installed",
  claudePluginListInstalled: async (repo: string | null) => {
    fetchCalls.push(`installed:${repo ?? "__global__"}`);
    return [];
  },
  claudePluginMarketBootstrap: async () => ({ ok: true, log: "" }),
  claudePluginUninstall: async () => "removed",
}));

describe("slashCatalogCache", () => {
  beforeEach(async () => {
    fetchCalls.length = 0;
    const mod = await import("./slashCatalogCache");
    mod.invalidateSlashCatalogCache();
  });

  test("loadSlashCatalog dedupes inflight requests per repository key", async () => {
    const mod = await import("./slashCatalogCache");
    const [first, second] = await Promise.all([
      mod.loadSlashCatalog("/repo-a"),
      mod.loadSlashCatalog("/repo-a"),
    ]);
    expect(first).toBe(second);
    expect(fetchCalls.filter((call) => call.startsWith("cache:/repo-a"))).toHaveLength(1);
    expect(fetchCalls.filter((call) => call === "user:global")).toHaveLength(1);
  });

  test("loadSlashCatalog keeps separate inflight requests per repository key", async () => {
    const mod = await import("./slashCatalogCache");
    const [repoA, repoB] = await Promise.all([
      mod.loadSlashCatalog("/repo-a"),
      mod.loadSlashCatalog("/repo-b"),
    ]);
    expect(repoA).not.toBe(repoB);
    expect(fetchCalls.filter((call) => call.startsWith("cache:/repo-a"))).toHaveLength(1);
    expect(fetchCalls.filter((call) => call.startsWith("cache:/repo-b"))).toHaveLength(1);
  });

  test("codex engine loads codex user skills while claude keeps claude user skills", async () => {
    const mod = await import("./slashCatalogCache");

    const codexSnapshot = await mod.loadSlashCatalog("/repo-a", {
      executionEngine: "codex-rpc",
    });
    const claudeSnapshot = await mod.loadSlashCatalog("/repo-a", {
      executionEngine: "claude",
    });

    expect(fetchCalls.filter((call) => call === "codex-user:global")).toHaveLength(1);
    expect(fetchCalls.filter((call) => call === "user:global")).toHaveLength(1);
    expect(codexSnapshot).not.toBe(claudeSnapshot);
    expect(codexSnapshot.userSkills).toEqual([]);
    expect(claudeSnapshot.userSkills).toEqual([]);
  });

  test("codex and claude engines share fresh snapshot within cache TTL", async () => {
    const mod = await import("./slashCatalogCache");
    const first = await mod.loadSlashCatalog("/repo-a", { executionEngine: "codex" });
    const second = await mod.loadSlashCatalog("/repo-a", { executionEngine: "codex-rpc" });
    expect(first).toBe(second);
    expect(fetchCalls.filter((call) => call === "codex-user:global")).toHaveLength(1);
  });
});
