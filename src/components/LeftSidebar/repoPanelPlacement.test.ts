import { describe, expect, test } from "bun:test";
import { deriveRepoPanelRenderState } from "./repoPanelPlacement";

describe("repoPanelPlacement", () => {
  // ── Tab 模式（默认） ──

  test("tab mode: same left toggles by activeTab", () => {
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

  test("tab mode: same right toggles by activeTab", () => {
    expect(deriveRepoPanelRenderState("right", "right", "files")).toMatchObject({
      showFilesOnRight: true,
      rightTabMode: true,
      usesRightRail: true,
    });
  });

  // ── 分栏模式（splitMode: true） ──

  test("split mode: same left shows both", () => {
    expect(
      deriveRepoPanelRenderState("left", "left", "git", { splitMode: true }),
    ).toMatchObject({
      showGitOnLeft: true,
      showFilesOnLeft: true,
      leftTabMode: false,
      rightTabMode: false,
      usesRightRail: false,
    });
    expect(
      deriveRepoPanelRenderState("left", "left", "files", { splitMode: true }),
    ).toMatchObject({
      showGitOnLeft: true,
      showFilesOnLeft: true,
      leftTabMode: false,
    });
  });

  test("split mode: same right shows both", () => {
    expect(
      deriveRepoPanelRenderState("right", "right", "files", { splitMode: true }),
    ).toMatchObject({
      showGitOnRight: true,
      showFilesOnRight: true,
      leftTabMode: false,
      rightTabMode: false,
      usesRightRail: true,
    });
  });

  // ── 跨栏（不受 splitMode 影响） ──

  test("splits across columns unaffected by splitMode", () => {
    expect(
      deriveRepoPanelRenderState("left", "right", "git", { splitMode: true }),
    ).toMatchObject({
      showGitOnLeft: true,
      showFilesOnRight: true,
      leftTabMode: false,
      rightTabMode: false,
      usesRightRail: true,
    });
    expect(
      deriveRepoPanelRenderState("left", "right", "git", { splitMode: false }),
    ).toMatchObject({
      showGitOnLeft: true,
      showFilesOnRight: true,
      leftTabMode: false,
      rightTabMode: false,
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

  test("tab mode hides right panes when right rail unavailable", () => {
    expect(
      deriveRepoPanelRenderState("right", "right", "git", { rightRailAvailable: false }),
    ).toMatchObject({
      showGitOnRight: false,
      showFilesOnRight: false,
      rightTabMode: true,
      usesRightRail: true,
    });
  });

  test("split mode hides right panes when right rail unavailable", () => {
    expect(
      deriveRepoPanelRenderState("right", "right", "git", {
        rightRailAvailable: false,
        splitMode: true,
      }),
    ).toMatchObject({
      showGitOnRight: false,
      showFilesOnRight: false,
      leftTabMode: false,
      rightTabMode: false,
      usesRightRail: true,
    });
  });
});
