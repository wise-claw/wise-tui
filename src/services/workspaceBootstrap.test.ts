import { describe, expect, mock, test } from "bun:test";
import { DEFAULT_WORKSPACE_BOOTSTRAP_SELECTION } from "../constants/workspaceBootstrapAddons";

mock.module("./trellisBootstrap", () => ({
  bootstrapTrellisIfMissing: mock(async () => {}),
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

  test("skips trellis when Wise Trellis is disabled", async () => {
    const trellis = (await import("./trellisBootstrap")).bootstrapTrellisIfMissing as ReturnType<typeof mock>;
    trellis.mockClear();

    const { bootstrapTrellisIfMissing } = await import("./trellisBootstrap");
    const { runWorkspaceBootstrap } = await import("./workspaceBootstrap");

    await runWorkspaceBootstrap("/tmp/ws2", {
      trellis: false,
      omc: true,
      superpowers: true,
      gsd: false,
      openspec: true,
    });

    expect(bootstrapTrellisIfMissing).not.toHaveBeenCalled();
  });
});
