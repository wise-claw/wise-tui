import { describe, expect, test } from "bun:test";
import {
  DEFAULT_WORKSPACE_BOOTSTRAP_SELECTION,
  workspaceBootstrapPluginInstallRefs,
  workspaceBootstrapSelectionToSddMode,
} from "./workspaceBootstrapAddons";

describe("workspaceBootstrapAddons", () => {
  test("defaults trellis on", () => {
    expect(DEFAULT_WORKSPACE_BOOTSTRAP_SELECTION.trellis).toBe(true);
    expect(DEFAULT_WORKSPACE_BOOTSTRAP_SELECTION.omc).toBe(false);
  });

  test("maps selection to repository sddMode", () => {
    expect(workspaceBootstrapSelectionToSddMode(DEFAULT_WORKSPACE_BOOTSTRAP_SELECTION)).toBe(
      "wise_trellis",
    );
    expect(
      workspaceBootstrapSelectionToSddMode({
        trellis: false,
        omc: false,
        superpowers: false,
        gsd: false,
        openspec: true,
      }),
    ).toBe("project_owned");
    expect(
      workspaceBootstrapSelectionToSddMode({
        trellis: false,
        omc: false,
        superpowers: false,
        gsd: false,
        openspec: false,
      }),
    ).toBe("auto");
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
