import { describe, expect, test } from "bun:test";
import {
  explorerDirKey,
  explorerParentDir,
  normalizeExplorerEntries,
} from "./repositoryExplorerDirKey";

describe("explorerDirKey", () => {
  test("normalizes slashes and trims", () => {
    expect(explorerDirKey(" .cursor/commands/ ")).toBe(".cursor/commands");
    expect(explorerDirKey("")).toBe("");
  });

  test("parentDir returns ancestor path", () => {
    expect(explorerParentDir(".cursor/commands")).toBe(".cursor");
    expect(explorerParentDir(".cursor")).toBe("");
  });

  test("normalizeExplorerEntries canonicalizes paths", () => {
    expect(
      normalizeExplorerEntries([{ path: " .cursor/commands/ ", isDir: true }]),
    ).toEqual([{ path: ".cursor/commands", isDir: true }]);
  });
});
