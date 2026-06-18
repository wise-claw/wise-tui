import { beforeEach, describe, expect, mock, test } from "bun:test";

const fetchCalls: string[] = [];

mock.module("./claude", () => ({
  isOmcPluginInstalled: async () => false,
  listClaudePluginCacheSkills: async (repo: string | null) => {
    fetchCalls.push(`cache:${repo ?? "__global__"}`);
    return [];
  },
  listClaudeProjectSkills: async (repo: string) => {
    fetchCalls.push(`project:${repo}`);
    return [];
  },
  listClaudeUserSkills: async () => {
    fetchCalls.push("user:global");
    return [];
  },
}));

mock.module("./claudePluginMarket", () => ({
  claudePluginListInstalled: async (repo: string | null) => {
    fetchCalls.push(`installed:${repo ?? "__global__"}`);
    return [];
  },
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
});
