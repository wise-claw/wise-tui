import { describe, expect, test } from "bun:test";
import {
  DEFAULT_WORKSPACE_BOOTSTRAP_SELECTION,
  setWiseTrellisBootstrapEnabled,
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
    ).toBe("project_owned");
  });

  test("Wise Trellis switch disables all external bootstrap choices", () => {
    expect(setWiseTrellisBootstrapEnabled(DEFAULT_WORKSPACE_BOOTSTRAP_SELECTION, false)).toMatchObject({
      trellis: false,
      openspec: false,
      omc: false,
      superpowers: false,
      gsd: false,
    });
    expect(
      setWiseTrellisBootstrapEnabled(
        {
          trellis: false,
          openspec: true,
          omc: true,
          superpowers: true,
          gsd: true,
        },
        true,
      ),
    ).toMatchObject({
      trellis: true,
      openspec: false,
      omc: false,
      superpowers: false,
      gsd: false,
    });
  });
});
