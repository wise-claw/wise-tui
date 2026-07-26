import { describe, expect, test } from "bun:test";
import type { CodeReviewFinding } from "../../types/codeReview";
import {
  buildCodeReviewFindingEntries,
  filterCodeReviewFindingEntries,
  findCodeReviewEntryIndex,
  groupCodeReviewFindingsByFile,
} from "./groupFindingsByFile";

function finding(partial: Partial<CodeReviewFinding> & Pick<CodeReviewFinding, "path" | "title">): CodeReviewFinding {
  return {
    severity: "MEDIUM",
    confidence: "HIGH",
    line: 1,
    detail: "",
    fix: "",
    ...partial,
  };
}

describe("groupCodeReviewFindingsByFile", () => {
  test("groups preserving file order and filters severity", () => {
    const entries = buildCodeReviewFindingEntries([
      finding({ path: "b.ts", title: "b1", severity: "LOW" }),
      finding({ path: "a.ts", title: "a1", severity: "HIGH" }),
      finding({ path: "b.ts", title: "b2", severity: "CRITICAL" }),
    ]);
    const groups = groupCodeReviewFindingsByFile(entries);
    expect(groups.map((group) => group.path)).toEqual(["b.ts", "a.ts"]);
    expect(groups[0]?.entries).toHaveLength(2);
    expect(groups[0]?.highOrCritical).toBe(1);

    const filtered = filterCodeReviewFindingEntries(entries, "HIGH_PLUS");
    expect(filtered.map((entry) => entry.finding.title)).toEqual(["a1", "b2"]);
    expect(findCodeReviewEntryIndex(filtered, filtered[1]!.key)).toBe(1);
  });
});
