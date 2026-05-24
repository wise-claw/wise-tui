import { describe, expect, mock, test } from "bun:test";
import { DEFAULT_WORKSPACE_BOOTSTRAP_SELECTION } from "../constants/workspaceBootstrapAddons";

mock.module("./trellisBootstrap", () => ({
  bootstrapTrellisIfMissing: mock(async () => {}),
}));

mock.module("./claudePluginMarket", () => ({
  claudePluginMarketBootstrap: mock(async () => ({ ok: true, log: "" })),
  claudePluginInstall: mock(async () => "ok"),
}));

describe("runWorkspaceBootstrap", () => {
  test("runs trellis by default selection", async () => {
    const trellis = (await import("./trellisBootstrap")).bootstrapTrellisIfMissing as ReturnType<typeof mock>;
    trellis.mockClear();
    const { bootstrapTrellisIfMissing } = await import("./trellisBootstrap");
    const { runWorkspaceBootstrap } = await import("./workspaceBootstrap");

    await runWorkspaceBootstrap("/tmp/workspace", DEFAULT_WORKSPACE_BOOTSTRAP_SELECTION);

    expect(bootstrapTrellisIfMissing).toHaveBeenCalledWith("/tmp/workspace");
  });

  test("skips trellis when only omc is selected", async () => {
    const trellis = (await import("./trellisBootstrap")).bootstrapTrellisIfMissing as ReturnType<typeof mock>;
    trellis.mockClear();

    const { bootstrapTrellisIfMissing } = await import("./trellisBootstrap");
    const { claudePluginInstall } = await import("./claudePluginMarket");
    const { runWorkspaceBootstrap } = await import("./workspaceBootstrap");

    await runWorkspaceBootstrap("/tmp/ws2", {
      trellis: false,
      trellisInit: false,
      omc: true,
      superpowers: false,
      gsd: false,
      openspec: false,
    });

    expect(bootstrapTrellisIfMissing).not.toHaveBeenCalled();
    expect(claudePluginInstall).toHaveBeenCalled();
  });

  test("runs trellis init for trellis-only selection", async () => {
    const trellis = (await import("./trellisBootstrap")).bootstrapTrellisIfMissing as ReturnType<typeof mock>;
    trellis.mockClear();

    const { bootstrapTrellisIfMissing } = await import("./trellisBootstrap");
    const { runWorkspaceBootstrap } = await import("./workspaceBootstrap");

    await runWorkspaceBootstrap("/tmp/ws3", {
      trellis: false,
      trellisInit: true,
      omc: false,
      superpowers: false,
      gsd: false,
      openspec: false,
    });

    expect(bootstrapTrellisIfMissing).toHaveBeenCalledWith("/tmp/ws3");
  });
});
