import { describe, expect, test } from "bun:test";
import type { GitGraphCommit } from "../../types";
import {
  buildGitGraphBranchOptions,
  collectGitGraphAuthors,
  filterGitGraphCommits,
} from "./gitGraphFilters";

const sampleCommits: GitGraphCommit[] = [
  {
    sha: "abc123def456",
    summary: "feat: add graph",
    author: "Alice",
    timestamp: 1,
    parentShas: [],
    refs: [{ name: "main", kind: "branch", isHead: true }],
  },
  {
    sha: "fed987654321",
    summary: "fix: panel layout",
    author: "Bob",
    timestamp: 2,
    parentShas: ["abc123def456"],
    refs: [],
  },
];

describe("filterGitGraphCommits", () => {
  test("filters by author", () => {
    expect(filterGitGraphCommits(sampleCommits, { author: "Alice" })).toHaveLength(1);
    expect(filterGitGraphCommits(sampleCommits, { author: "Alice" })[0]?.sha).toBe("abc123def456");
  });

  test("filters by query across summary, author, sha, and refs", () => {
    expect(filterGitGraphCommits(sampleCommits, { query: "graph" })).toHaveLength(1);
    expect(filterGitGraphCommits(sampleCommits, { query: "bob" })).toHaveLength(1);
    expect(filterGitGraphCommits(sampleCommits, { query: "abc123" })).toHaveLength(1);
    expect(filterGitGraphCommits(sampleCommits, { query: "main" })).toHaveLength(1);
  });
});

describe("collectGitGraphAuthors", () => {
  test("returns sorted unique authors", () => {
    expect(collectGitGraphAuthors(sampleCommits)).toEqual(["Alice", "Bob"]);
  });
});

describe("buildGitGraphBranchOptions", () => {
  test("includes all branches option, local branches, and remote branches", () => {
    expect(
      buildGitGraphBranchOptions([
        { name: "origin/develop", isRemote: true, isCurrent: false, lastCommitTimestamp: 1, lastCommitSummary: null, author: null },
        { name: "master", isRemote: false, isCurrent: true, lastCommitTimestamp: 2, lastCommitSummary: null, author: null },
        { name: "feature/a", isRemote: false, isCurrent: false, lastCommitTimestamp: 3, lastCommitSummary: null, author: null },
      ]),
    ).toEqual([
      { label: "全部分支", value: "" },
      { label: "feature/a", value: "feature/a" },
      { label: "master (当前)", value: "master" },
      { label: "origin/develop", value: "origin/develop" },
    ]);
  });
});
