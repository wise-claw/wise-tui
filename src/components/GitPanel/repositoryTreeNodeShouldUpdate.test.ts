import { describe, expect, test } from "bun:test";
import { expandTouchAffectsDir } from "./repositoryTreeNodeExpandTouch";

describe("expandTouchAffectsDir", () => {
  test("marks ancestors of the toggled path", () => {
    expect(expandTouchAffectsDir("repo-page-pixel-replica", "repo-page-pixel-replica/claude-code")).toBe(
      true,
    );
    expect(expandTouchAffectsDir("examples", "repo-page-pixel-replica/claude-code")).toBe(false);
  });

  test("marks the toggled directory itself", () => {
    expect(expandTouchAffectsDir("repo-page-pixel-replica/claude-code", "repo-page-pixel-replica/claude-code")).toBe(
      true,
    );
  });
});
