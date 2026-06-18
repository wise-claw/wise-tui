import { describe, expect, test } from "bun:test";
import {
  DEFAULT_WORKSPACE_BOOTSTRAP_SELECTION,
  setWiseTrellisBootstrapEnabled,
  setWorkspaceBootstrapAddonEnabled,
  workspaceBootstrapNeedsTrellisInit,
  workspaceBootstrapSelectionToSddMode,
} from "./workspaceBootstrapAddons";

describe("workspaceBootstrapAddons", () => {
  test("defaults all bootstrap addons off", () => {
    expect(DEFAULT_WORKSPACE_BOOTSTRAP_SELECTION.trellis).toBe(false);
    expect(DEFAULT_WORKSPACE_BOOTSTRAP_SELECTION.trellisInit).toBe(false);
    expect(DEFAULT_WORKSPACE_BOOTSTRAP_SELECTION.omc).toBe(false);
  });

  test("maps selection to repository sddMode", () => {
    expect(workspaceBootstrapSelectionToSddMode(DEFAULT_WORKSPACE_BOOTSTRAP_SELECTION)).toBe(
      "project_owned",
    );
    expect(
      workspaceBootstrapSelectionToSddMode({
        trellis: true,
        trellisInit: false,
        omc: false,
        superpowers: false,
        gsd: false,
        openspec: false,
      }),
    ).toBe("wise_trellis");
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
    expect(workspaceBootstrapNeedsTrellisInit(DEFAULT_WORKSPACE_BOOTSTRAP_SELECTION)).toBe(false);
    expect(
      workspaceBootstrapNeedsTrellisInit({
        ...DEFAULT_WORKSPACE_BOOTSTRAP_SELECTION,
        trellis: true,
      }),
    ).toBe(true);
    expect(
      workspaceBootstrapNeedsTrellisInit({
        ...DEFAULT_WORKSPACE_BOOTSTRAP_SELECTION,
        trellisInit: true,
      }),
    ).toBe(true);
    expect(
      workspaceBootstrapNeedsTrellisInit({
        ...DEFAULT_WORKSPACE_BOOTSTRAP_SELECTION,
        omc: true,
      }),
    ).toBe(false);
  });

  test("Wise Trellis switch disables trellisInit and omc when enabled", () => {
    expect(setWiseTrellisBootstrapEnabled(DEFAULT_WORKSPACE_BOOTSTRAP_SELECTION, true)).toMatchObject({
      trellis: true,
      trellisInit: false,
      omc: false,
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
      setWorkspaceBootstrapAddonEnabled(
        { ...DEFAULT_WORKSPACE_BOOTSTRAP_SELECTION, trellis: true },
        "omc",
        true,
      ),
    ).toEqual({ ...DEFAULT_WORKSPACE_BOOTSTRAP_SELECTION, trellis: true });
    expect(
      setWorkspaceBootstrapAddonEnabled(DEFAULT_WORKSPACE_BOOTSTRAP_SELECTION, "omc", true).omc,
    ).toBe(true);
  });
});
