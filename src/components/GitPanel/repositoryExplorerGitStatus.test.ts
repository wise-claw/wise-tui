import { describe, expect, it } from "bun:test";
import {
  buildExplorerGitStatusIndex,
  explorerGitStatusIndexEqual,
} from "./repositoryExplorerGitStatus";
import type { GitStatusResponse } from "../../types";

const emptyStatus: GitStatusResponse = {
  staged: [],
  unstaged: [],
  branch: "main",
  additions: 0,
  deletions: 0,
  ahead: 0,
  behind: 0,
  upstream: null,
};

describe("buildExplorerGitStatusIndex", () => {
  it("maps files and ancestor dirs", () => {
    const index = buildExplorerGitStatusIndex({
      ...emptyStatus,
      staged: [],
      unstaged: [{ path: "src/cli/ask.ts", status: "M", additions: 1, deletions: 0 }],
    });
    expect(index.fileStatusByPath.get("src/cli/ask.ts")).toBe("M");
    expect(index.dirsWithChanges.has("src")).toBe(true);
    expect(index.dirsWithChanges.has("src/cli")).toBe(true);
    expect(index.dirsWithChanges.has("src/cli/ask.ts")).toBe(false);
  });

  it("prefers unstaged status over staged for the same path", () => {
    const index = buildExplorerGitStatusIndex({
      ...emptyStatus,
      staged: [{ path: "foo.ts", status: "M", additions: 0, deletions: 0 }],
      unstaged: [{ path: "foo.ts", status: "D", additions: 0, deletions: 1 }],
    });
    expect(index.fileStatusByPath.get("foo.ts")).toBe("D");
  });

  it("returns empty index for null status", () => {
    const index = buildExplorerGitStatusIndex(null);
    expect(index.fileStatusByPath.size).toBe(0);
    expect(index.dirsWithChanges.size).toBe(0);
    expect(index.dirStatusByPath.size).toBe(0);
  });

  it("computes dir status by aggregating child severity", () => {
    const index = buildExplorerGitStatusIndex({
      ...emptyStatus,
      unstaged: [
        { path: "src/cli/ask.ts", status: "A", additions: 1, deletions: 0 },
        { path: "src/util.ts", status: "M", additions: 0, deletions: 1 },
      ],
    });
    expect(index.dirStatusByPath.get("src")).toBe("M");
    expect(index.dirStatusByPath.get("src/cli")).toBe("A");
    // D 取最高优先级
    const index2 = buildExplorerGitStatusIndex({
      ...emptyStatus,
      unstaged: [
        { path: "src/a.ts", status: "M", additions: 0, deletions: 0 },
        { path: "src/b.ts", status: "D", additions: 0, deletions: 0 },
      ],
    });
    expect(index2.dirStatusByPath.get("src")).toBe("D");
  });
});

describe("explorerGitStatusIndexEqual", () => {
  it("compares file and dir sets", () => {
    const left = buildExplorerGitStatusIndex({
      ...emptyStatus,
      unstaged: [{ path: "a.ts", status: "M", additions: 0, deletions: 0 }],
    });
    const right = buildExplorerGitStatusIndex({
      ...emptyStatus,
      unstaged: [{ path: "a.ts", status: "M", additions: 0, deletions: 0 }],
    });
    expect(explorerGitStatusIndexEqual(left, right)).toBe(true);
  });
});
