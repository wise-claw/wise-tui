import { describe, expect, test } from "bun:test";
import { deriveRepoPanelRenderState } from "./repoPanelPlacement";

describe("repoPanelPlacement", () => {
  test("both visible tab mode toggles by activeTab", () => {
    expect(deriveRepoPanelRenderState("visible", "visible", "git")).toMatchObject({
      showGitOnLeft: true,
      showFilesOnLeft: false,
      leftTabMode: true,
      usesRightRail: false,
    });
    expect(deriveRepoPanelRenderState("visible", "visible", "files")).toMatchObject({
      showGitOnLeft: false,
      showFilesOnLeft: true,
      leftTabMode: true,
    });
  });

  test("both visible split mode shows both", () => {
    expect(
      deriveRepoPanelRenderState("visible", "visible", "git", { splitMode: true }),
    ).toMatchObject({
      showGitOnLeft: true,
      showFilesOnLeft: true,
      leftTabMode: false,
      rightTabMode: false,
      usesRightRail: false,
    });
  });

  test("only git visible", () => {
    expect(deriveRepoPanelRenderState("visible", "hidden", "files")).toMatchObject({
      showGitOnLeft: true,
      showFilesOnLeft: false,
      leftTabMode: false,
      showGitOnRight: false,
      showFilesOnRight: false,
      usesRightRail: false,
    });
  });

  test("only files visible", () => {
    expect(deriveRepoPanelRenderState("hidden", "visible", "git")).toMatchObject({
      showGitOnLeft: false,
      showFilesOnLeft: true,
      leftTabMode: false,
      usesRightRail: false,
    });
  });

  test("both hidden", () => {
    expect(deriveRepoPanelRenderState("hidden", "hidden", "git")).toMatchObject({
      showGitOnLeft: false,
      showFilesOnLeft: false,
      leftTabMode: false,
      usesRightRail: false,
    });
  });
});
