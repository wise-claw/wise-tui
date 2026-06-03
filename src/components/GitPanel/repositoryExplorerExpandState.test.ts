import { describe, expect, test } from "bun:test";
import {
  INITIAL_REPOSITORY_EXPLORER_EXPAND_STATE,
  mergeExpandedAncestorDirs,
  pruneExpandedSubtree,
  reduceRepositoryExplorerExpandState,
} from "./repositoryExplorerExpandState";

describe("reduceRepositoryExplorerExpandState", () => {
  test("toggle adds and removes paths in one update", () => {
    const opened = reduceRepositoryExplorerExpandState(INITIAL_REPOSITORY_EXPLORER_EXPAND_STATE, {
      type: "toggle",
      path: "a/b",
    });
    expect(opened.dirs.has("a/b")).toBe(true);
    expect(opened.epoch).toBe(1);
    expect(opened.lastPath).toBe("a/b");

    const closed = reduceRepositoryExplorerExpandState(opened, { type: "toggle", path: "a/b" });
    expect(closed.dirs.has("a/b")).toBe(false);
    expect(closed.epoch).toBe(2);
  });

  test("expandAncestors opens parent chain", () => {
    const next = reduceRepositoryExplorerExpandState(INITIAL_REPOSITORY_EXPLORER_EXPAND_STATE, {
      type: "expandAncestors",
      parentDir: "repo-page/claude-code",
    });
    expect(next.dirs.has("repo-page")).toBe(true);
    expect(next.dirs.has("repo-page/claude-code")).toBe(true);
  });

  test("expandAncestors is no-op when ancestors already open", () => {
    const opened = reduceRepositoryExplorerExpandState(INITIAL_REPOSITORY_EXPLORER_EXPAND_STATE, {
      type: "expandAncestors",
      parentDir: "repo-page/claude-code",
    });
    const again = reduceRepositoryExplorerExpandState(opened, {
      type: "expandAncestors",
      parentDir: "repo-page/claude-code",
    });
    expect(again).toBe(opened);
  });
});

describe("expanded dir set helpers", () => {
  test("pruneExpandedSubtree removes nested paths", () => {
    const prev = new Set(["a", "a/b", "a/b/c", "x"]);
    const next = pruneExpandedSubtree(prev, "a/b");
    expect([...next].sort()).toEqual(["a", "x"]);
  });

  test("mergeExpandedAncestorDirs adds ancestors only", () => {
    const next = mergeExpandedAncestorDirs(new Set(), "repo-page/claude-code");
    expect([...next].sort()).toEqual(["repo-page", "repo-page/claude-code"]);
  });
});
