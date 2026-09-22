import { describe, expect, test } from "bun:test";
import type { GitBlameLineEntry } from "../types";
import {
  blameShasByRecency,
  diffSourceTooLarge,
  pickLatestBlameSha,
  sameRepoFilePath,
} from "./workingTreeFileDiff";

function blame(partial: Partial<GitBlameLineEntry> & Pick<GitBlameLineEntry, "sha" | "timestamp">): GitBlameLineEntry {
  return {
    line: 1,
    author: "a",
    summary: "s",
    content: "",
    ...partial,
  };
}

describe("pickLatestBlameSha", () => {
  test("picks the newest commit even when it is not the first line", () => {
    const sha = pickLatestBlameSha([
      blame({ sha: "old", timestamp: 10, line: 1 }),
      blame({ sha: "new", timestamp: 50, line: 40 }),
      blame({ sha: "mid", timestamp: 20, line: 12 }),
    ]);
    expect(sha).toBe("new");
  });

  test("returns empty when blame has no sha", () => {
    expect(pickLatestBlameSha([blame({ sha: "  ", timestamp: 1 })])).toBe("");
  });

  test("matches a commit file path to the repository relative path", () => {
    expect(sameRepoFilePath("src/pages/Articles.jsx", "src/pages/Articles.jsx")).toBe(true);
    expect(sameRepoFilePath("./src/components/TocMarkdown.jsx", "src/components/TocMarkdown.jsx")).toBe(true);
    expect(sameRepoFilePath("src/styles/global.css", "src/pages/Articles.jsx")).toBe(false);
  });

  test("skips full-file diff when either side is huge", () => {
    expect(diffSourceTooLarge("a", "b")).toBe(false);
    expect(diffSourceTooLarge("x".repeat(120_001), "y")).toBe(true);
    expect(diffSourceTooLarge("x", "y".repeat(120_001))).toBe(true);
  });

  test("lists commits from newest to oldest", () => {
    expect(
      blameShasByRecency([
        blame({ sha: "old", timestamp: 10 }),
        blame({ sha: "new", timestamp: 50 }),
        blame({ sha: "old", timestamp: 11 }),
      ]),
    ).toEqual(["new", "old"]);
  });
});
