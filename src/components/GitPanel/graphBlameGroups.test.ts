import { describe, expect, it } from "bun:test";
import { groupBlameLinesByCommit } from "./graphBlameGroups";
import type { GitBlameLineEntry } from "../../types";

function line(partial: Partial<GitBlameLineEntry> & Pick<GitBlameLineEntry, "line" | "sha">): GitBlameLineEntry {
  return {
    author: "Alice",
    summary: "init",
    timestamp: 1,
    content: "code",
    ...partial,
  };
}

describe("groupBlameLinesByCommit", () => {
  it("groups consecutive and non-consecutive lines by sha", () => {
    const groups = groupBlameLinesByCommit([
      line({ line: 1, sha: "aaa" }),
      line({ line: 2, sha: "aaa" }),
      line({ line: 3, sha: "bbb", author: "Bob", summary: "fix" }),
      line({ line: 4, sha: "aaa" }),
    ]);

    expect(groups).toHaveLength(2);
    expect(groups[0]?.sha).toBe("aaa");
    expect(groups[0]?.lines.map((entry) => entry.line)).toEqual([1, 2, 4]);
    expect(groups[1]?.sha).toBe("bbb");
    expect(groups[1]?.lines.map((entry) => entry.line)).toEqual([3]);
  });
});
