import { describe, expect, mock, test } from "bun:test";
import { DEFAULT_WORKSPACE_BOOTSTRAP_SELECTION } from "../constants/workspaceBootstrapAddons";

mock.module("./claudePluginMarket", () => ({
  claudePluginMarketBootstrap: mock(async () => ({ ok: true, log: "" })),
  claudePluginInstall: mock(async () => "ok"),
}));

describe("runWorkspaceBootstrap", () => {
  test("runs omc when selected in bootstrap addons", async () => {
    const { claudePluginInstall } = await import("./claudePluginMarket");
    (claudePluginInstall as ReturnType<typeof mock>).mockClear();
    const { runWorkspaceBootstrap } = await import("./workspaceBootstrap");

    await runWorkspaceBootstrap("/tmp/ws2", {
      trellis: false,
      trellisInit: false,
      omc: true,
      superpowers: false,
      gsd: false,
      openspec: false,
    });

    expect(claudePluginInstall).toHaveBeenCalled();
  });

  test("no-op when no bootstrap addons selected", async () => {
    const { claudePluginInstall } = await import("./claudePluginMarket");
    (claudePluginInstall as ReturnType<typeof mock>).mockClear();
    const { runWorkspaceBootstrap } = await import("./workspaceBootstrap");

    await runWorkspaceBootstrap("/tmp/workspace", {
      trellis: false,
      trellisInit: false,
      omc: false,
      superpowers: false,
      gsd: false,
      openspec: false,
    });

    expect(claudePluginInstall).not.toHaveBeenCalled();
  });

  test("default selection only installs omc when trellis is disabled", async () => {
    const { claudePluginInstall } = await import("./claudePluginMarket");
    (claudePluginInstall as ReturnType<typeof mock>).mockClear();
    const { runWorkspaceBootstrap } = await import("./workspaceBootstrap");

    await runWorkspaceBootstrap("/tmp/workspace", DEFAULT_WORKSPACE_BOOTSTRAP_SELECTION);

    if (DEFAULT_WORKSPACE_BOOTSTRAP_SELECTION.omc) {
      expect(claudePluginInstall).toHaveBeenCalled();
    } else {
      expect(claudePluginInstall).not.toHaveBeenCalled();
    }
  });
});
