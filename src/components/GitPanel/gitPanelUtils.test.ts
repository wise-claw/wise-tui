import { describe, expect, it } from "bun:test";
import type { GitStatusResponse } from "../../types";
import {
  GIT_PANEL_LARGE_CHANGE_COUNT,
  GIT_PANEL_VIRTUAL_LIST_THRESHOLD,
  gitStatusHeaderSnapshotEqual,
  gitStatusSnapshotEqual,
  shouldUseGitVirtualFileList,
} from "./gitPanelUtils";

describe("shouldUseGitVirtualFileList", () => {
  it("enables virtualization above the virtual-list threshold", () => {
    expect(shouldUseGitVirtualFileList(GIT_PANEL_VIRTUAL_LIST_THRESHOLD)).toBe(false);
    expect(shouldUseGitVirtualFileList(GIT_PANEL_VIRTUAL_LIST_THRESHOLD + 1)).toBe(true);
    expect(shouldUseGitVirtualFileList(GIT_PANEL_LARGE_CHANGE_COUNT + 1)).toBe(true);
  });
});

describe("gitStatusSnapshotEqual", () => {
  it("detects identical git status snapshots", () => {
    const status: GitStatusResponse = {
      staged: [{ path: "a.ts", status: "M", additions: 1, deletions: 0 }],
      unstaged: [],
      branch: "main",
      additions: 1,
      deletions: 0,
      ahead: 0,
      behind: 0,
      upstream: null,
    };
    expect(gitStatusSnapshotEqual(status, { ...status })).toBe(true);
    expect(
      gitStatusSnapshotEqual(status, {
        ...status,
        unstaged: [{ path: "b.ts", status: "M", additions: 0, deletions: 0 }],
      }),
    ).toBe(false);
  });

  it("detects per-file line stat changes for the same path and status", () => {
    const status: GitStatusResponse = {
      staged: [],
      unstaged: [{ path: "a.ts", status: "M", additions: 1, deletions: 0 }],
      branch: "main",
      additions: 1,
      deletions: 0,
      ahead: 0,
      behind: 0,
      upstream: null,
    };
    expect(
      gitStatusSnapshotEqual(status, {
        ...status,
        unstaged: [{ path: "a.ts", status: "M", additions: 3, deletions: 1 }],
        additions: 3,
        deletions: 1,
      }),
    ).toBe(false);
  });
});

describe("gitStatusHeaderSnapshotEqual", () => {
  it("detects identical git status header snapshots", () => {
    const snapshot = {
      branch: "master",
      ahead: 0,
      behind: 0,
      stagedCount: 1,
      unstagedCount: 3,
    };
    expect(gitStatusHeaderSnapshotEqual(snapshot, { ...snapshot })).toBe(true);
    expect(
      gitStatusHeaderSnapshotEqual(snapshot, {
        ...snapshot,
        unstagedCount: 5,
      }),
    ).toBe(false);
  });
});
