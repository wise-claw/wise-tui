import { describe, expect, test } from "bun:test";
import {
  deriveRepoPanelRenderState,
  resolveRepoPanelPlacements,
} from "./repoPanelPlacement";

describe("repoPanelPlacement", () => {
  test("resolveRepoPanelPlacements coerces right to left when rail unavailable", () => {
    expect(resolveRepoPanelPlacements("right", "left", false)).toEqual({
      git: "left",
      files: "left",
      coerced: true,
    });
  });

  test("deriveRepoPanelRenderState uses left tab mode", () => {
    expect(deriveRepoPanelRenderState("left", "left", "git")).toMatchObject({
      showGitOnLeft: true,
      showFilesOnLeft: false,
      leftTabMode: true,
      usesRightRail: false,
    });
    expect(deriveRepoPanelRenderState("left", "left", "files")).toMatchObject({
      showGitOnLeft: false,
      showFilesOnLeft: true,
      leftTabMode: true,
    });
  });

  test("deriveRepoPanelRenderState splits across columns", () => {
    expect(deriveRepoPanelRenderState("left", "right", "git")).toMatchObject({
      showGitOnLeft: true,
      showFilesOnRight: true,
      leftTabMode: false,
      rightTabMode: false,
      usesRightRail: true,
    });
  });

  test("deriveRepoPanelRenderState uses right tab mode", () => {
    expect(deriveRepoPanelRenderState("right", "right", "files")).toMatchObject({
      showFilesOnRight: true,
      rightTabMode: true,
      usesRightRail: true,
    });
  });
});
