import { describe, expect, test } from "bun:test";
import { deriveRepoPanelRenderState } from "./repoPanelPlacement";

describe("repoPanelPlacement", () => {
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

  test("keeps configured usesRightRail when right rail is temporarily unavailable", () => {
    expect(
      deriveRepoPanelRenderState("left", "right", "git", { rightRailAvailable: false }),
    ).toMatchObject({
      showGitOnLeft: true,
      showFilesOnRight: false,
      usesRightRail: true,
    });
  });

  test("hides right tab panes when right rail is temporarily unavailable", () => {
    expect(
      deriveRepoPanelRenderState("right", "right", "git", { rightRailAvailable: false }),
    ).toMatchObject({
      showGitOnRight: false,
      showFilesOnRight: false,
      rightTabMode: true,
      usesRightRail: true,
    });
  });
});
