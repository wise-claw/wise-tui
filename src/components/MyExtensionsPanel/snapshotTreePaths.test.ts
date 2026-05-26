import { describe, expect, test } from "bun:test";
import { joinSnapshotRelative, parentDirForSnapshotKey } from "./snapshotTreePaths";
import type { SnapshotTreeNode } from "../../types/myExtension";

const sampleTree: SnapshotTreeNode[] = [
  { key: "meta.json", title: "meta.json", isLeaf: true },
  {
    key: "skill",
    title: "skill",
    isLeaf: false,
    children: [
      { key: "skill/SKILL.md", title: "SKILL.md", isLeaf: true },
      { key: "skill/lib", title: "lib", isLeaf: false, children: [] },
    ],
  },
];

describe("parentDirForSnapshotKey", () => {
  test("uses folder path when a directory is focused", () => {
    expect(parentDirForSnapshotKey(sampleTree, "skill")).toBe("skill");
    expect(parentDirForSnapshotKey(sampleTree, "skill/lib")).toBe("skill/lib");
  });

  test("uses parent directory when a file is focused", () => {
    expect(parentDirForSnapshotKey(sampleTree, "skill/SKILL.md")).toBe("skill");
    expect(parentDirForSnapshotKey(sampleTree, "meta.json")).toBe("");
  });
});

describe("joinSnapshotRelative", () => {
  test("joins under folder parent", () => {
    expect(joinSnapshotRelative("skill", "new.md")).toBe("skill/new.md");
    expect(joinSnapshotRelative("skill/lib", "util.ts")).toBe("skill/lib/util.ts");
  });
});
