import { describe, expect, mock, test } from "bun:test";
import { DEFAULT_WORKSPACE_BOOTSTRAP_SELECTION } from "../constants/workspaceBootstrapAddons";

mock.module("./trellisBootstrap", () => ({
  bootstrapTrellisIfMissing: mock(async () => {}),
}));

mock.module("./openspecBootstrap", () => ({
  bootstrapOpenspecIfMissing: mock(async () => {}),
}));

mock.module("./claudePluginMarket", () => ({
  claudePluginMarketBootstrap: mock(async () => ({ ok: true, log: "" })),
  claudePluginInstall: mock(async () => "ok"),
}));

describe("runWorkspaceBootstrap", () => {
  test("runs trellis only by default selection", async () => {
    const trellis = (await import("./trellisBootstrap")).bootstrapTrellisIfMissing as ReturnType<typeof mock>;
    const openspec = (await import("./openspecBootstrap")).bootstrapOpenspecIfMissing as ReturnType<typeof mock>;
    const market = (await import("./claudePluginMarket")).claudePluginMarketBootstrap as ReturnType<typeof mock>;
    const install = (await import("./claudePluginMarket")).claudePluginInstall as ReturnType<typeof mock>;
    trellis.mockClear();
    openspec.mockClear();
    market.mockClear();
    install.mockClear();
    const { bootstrapTrellisIfMissing } = await import("./trellisBootstrap");
    const { bootstrapOpenspecIfMissing } = await import("./openspecBootstrap");
    const { claudePluginMarketBootstrap, claudePluginInstall } = await import("./claudePluginMarket");
    const { runWorkspaceBootstrap } = await import("./workspaceBootstrap");

    await runWorkspaceBootstrap("/tmp/workspace", DEFAULT_WORKSPACE_BOOTSTRAP_SELECTION);

    expect(bootstrapTrellisIfMissing).toHaveBeenCalledWith("/tmp/workspace");
    expect(bootstrapOpenspecIfMissing).not.toHaveBeenCalled();
    expect(claudePluginMarketBootstrap).not.toHaveBeenCalled();
    expect(claudePluginInstall).not.toHaveBeenCalled();
  });

  test("installs selected plugins and openspec", async () => {
    const trellis = (await import("./trellisBootstrap")).bootstrapTrellisIfMissing as ReturnType<typeof mock>;
    const openspec = (await import("./openspecBootstrap")).bootstrapOpenspecIfMissing as ReturnType<typeof mock>;
    const market = (await import("./claudePluginMarket")).claudePluginMarketBootstrap as ReturnType<typeof mock>;
    const install = (await import("./claudePluginMarket")).claudePluginInstall as ReturnType<typeof mock>;
    trellis.mockClear();
    openspec.mockClear();
    market.mockClear();
    install.mockClear();

    const { bootstrapTrellisIfMissing } = await import("./trellisBootstrap");
    const { bootstrapOpenspecIfMissing } = await import("./openspecBootstrap");
    const { claudePluginMarketBootstrap, claudePluginInstall } = await import("./claudePluginMarket");
    const { runWorkspaceBootstrap } = await import("./workspaceBootstrap");

    await runWorkspaceBootstrap("/tmp/ws2", {
      trellis: false,
      omc: true,
      superpowers: true,
      gsd: false,
      openspec: true,
    });

    expect(bootstrapTrellisIfMissing).not.toHaveBeenCalled();
    expect(bootstrapOpenspecIfMissing).toHaveBeenCalledWith("/tmp/ws2");
    expect(claudePluginMarketBootstrap).toHaveBeenCalled();
    expect(claudePluginInstall).toHaveBeenCalledTimes(2);
    expect(claudePluginInstall).toHaveBeenCalledWith("oh-my-claudecode@omc", "user");
    expect(claudePluginInstall).toHaveBeenCalledWith("superpowers@superpowers-marketplace", "user");
  });
});
