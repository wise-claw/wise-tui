import { describe, expect, test } from "bun:test";
import {
  DEFAULT_WORKSPACE_BOOTSTRAP_SELECTION,
  setWiseTrellisBootstrapEnabled,
  setWorkspaceBootstrapAddonEnabled,
  workspaceBootstrapNeedsTrellisInit,
  workspaceBootstrapSelectionToSddMode,
} from "./workspaceBootstrapAddons";

describe("workspaceBootstrapAddons", () => {
  test("defaults trellis on", () => {
    expect(DEFAULT_WORKSPACE_BOOTSTRAP_SELECTION.trellis).toBe(true);
    expect(DEFAULT_WORKSPACE_BOOTSTRAP_SELECTION.trellisInit).toBe(false);
    expect(DEFAULT_WORKSPACE_BOOTSTRAP_SELECTION.omc).toBe(false);
  });

  test("maps selection to repository sddMode", () => {
    expect(workspaceBootstrapSelectionToSddMode(DEFAULT_WORKSPACE_BOOTSTRAP_SELECTION)).toBe(
      "wise_trellis",
    );
    expect(
      workspaceBootstrapSelectionToSddMode({
        trellis: false,
        trellisInit: true,
        omc: false,
        superpowers: false,
        gsd: false,
        openspec: true,
      }),
    ).toBe("project_owned");
    expect(
      workspaceBootstrapSelectionToSddMode({
        trellis: false,
        trellisInit: false,
        omc: true,
        superpowers: false,
        gsd: false,
        openspec: false,
      }),
    ).toBe("project_owned");
  });

  test("trellis init when wise or trellis-only", () => {
    expect(workspaceBootstrapNeedsTrellisInit(DEFAULT_WORKSPACE_BOOTSTRAP_SELECTION)).toBe(true);
    expect(
      workspaceBootstrapNeedsTrellisInit({
        ...DEFAULT_WORKSPACE_BOOTSTRAP_SELECTION,
        trellis: false,
        trellisInit: true,
      }),
    ).toBe(true);
    expect(
      workspaceBootstrapNeedsTrellisInit({
        ...DEFAULT_WORKSPACE_BOOTSTRAP_SELECTION,
        trellis: false,
        trellisInit: false,
        omc: true,
      }),
    ).toBe(false);
  });

  test("Wise Trellis switch disables trellisInit and omc when enabled", () => {
    expect(setWiseTrellisBootstrapEnabled(DEFAULT_WORKSPACE_BOOTSTRAP_SELECTION, false)).toMatchObject({
      trellis: false,
    });
    expect(
      setWiseTrellisBootstrapEnabled(
        {
          trellis: false,
          trellisInit: true,
          openspec: true,
          omc: true,
          superpowers: true,
          gsd: true,
        },
        true,
      ),
    ).toMatchObject({
      trellis: true,
      trellisInit: false,
      omc: false,
    });
  });

  test("addon toggles are blocked while Wise Trellis is on", () => {
    expect(
      setWorkspaceBootstrapAddonEnabled(DEFAULT_WORKSPACE_BOOTSTRAP_SELECTION, "omc", true),
    ).toEqual(DEFAULT_WORKSPACE_BOOTSTRAP_SELECTION);
    expect(
      setWorkspaceBootstrapAddonEnabled(
        { ...DEFAULT_WORKSPACE_BOOTSTRAP_SELECTION, trellis: false },
        "omc",
        true,
      ).omc,
    ).toBe(true);
  });
});
