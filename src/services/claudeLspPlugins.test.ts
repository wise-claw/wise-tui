import { describe, expect, mock, test } from "bun:test";
import { getClaudeLspCoreCatalogEntries } from "../constants/claudePluginMarketCatalog";

mock.module("./claudePluginMarket", () => ({
  claudePluginMarketBootstrap: mock(async () => ({ ok: true, log: "" })),
  claudePluginListInstalled: mock(async () => []),
  claudePluginInstall: mock(async () => "ok"),
  claudePluginUninstall: mock(async () => "ok"),
}));

describe("claudeLspPlugins", () => {
  test("core bundle has four official LSP plugins", () => {
    const entries = getClaudeLspCoreCatalogEntries();
    expect(entries).toHaveLength(4);
    expect(entries.map((e) => e.pluginId).sort()).toEqual([
      "jdtls-lsp",
      "pyright-lsp",
      "rust-analyzer-lsp",
      "typescript-lsp",
    ]);
    expect(entries.every((e) => e.marketplace === "claude-plugins-official")).toBe(true);
  });

  test("installClaudeLspCoreBundle installs only missing plugins", async () => {
    const { claudePluginInstall, claudePluginListInstalled } = await import("./claudePluginMarket");
    (claudePluginListInstalled as ReturnType<typeof mock>).mockResolvedValueOnce([
      { id: "pyright-lsp@claude-plugins-official", scope: "user", enabled: true },
    ]);

    const { installClaudeLspCoreBundle } = await import("./claudeLspPlugins");
    const result = await installClaudeLspCoreBundle();

    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0]?.ref).toBe("pyright-lsp@claude-plugins-official");
    expect(result.installed).toHaveLength(3);
    expect(claudePluginInstall).toHaveBeenCalledTimes(3);
  });
});
