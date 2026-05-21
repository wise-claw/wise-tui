import { describe, expect, test } from "bun:test";
import {
  DEFAULT_WORKSPACE_BOOTSTRAP_SELECTION,
  workspaceBootstrapPluginInstallRefs,
} from "./workspaceBootstrapAddons";

describe("workspaceBootstrapAddons", () => {
  test("defaults trellis on", () => {
    expect(DEFAULT_WORKSPACE_BOOTSTRAP_SELECTION.trellis).toBe(true);
    expect(DEFAULT_WORKSPACE_BOOTSTRAP_SELECTION.omc).toBe(false);
  });

  test("collects plugin install refs", () => {
    expect(
      workspaceBootstrapPluginInstallRefs({
        ...DEFAULT_WORKSPACE_BOOTSTRAP_SELECTION,
        omc: true,
        gsd: true,
      }),
    ).toEqual(["oh-my-claudecode@omc", "gsd@gsd-plugin"]);
  });
});
