import { describe, expect, test } from "bun:test";
import {
  explorerEntryBaseName,
  explorerEntryParentDir,
  resolveExplorerDropDestDir,
  resolveExplorerMove,
} from "./explorerTreeMove";

describe("explorerTreeMove", () => {
  test("parent and basename of nested paths", () => {
    expect(explorerEntryParentDir("src/hooks/useFoo.ts")).toBe("src/hooks");
    expect(explorerEntryBaseName("src/hooks/useFoo.ts")).toBe("useFoo.ts");
    expect(explorerEntryParentDir("README.md")).toBe("");
    expect(explorerEntryBaseName("README.md")).toBe("README.md");
  });

  test("file drop uses parent directory; directory drop uses itself", () => {
    expect(resolveExplorerDropDestDir({ relativePath: "src/a.ts", isDir: false })).toBe("src");
    expect(resolveExplorerDropDestDir({ relativePath: "src", isDir: true })).toBe("src");
    expect(resolveExplorerDropDestDir({ relativePath: "", isDir: true })).toBe("");
  });

  test("moves a file into another directory", () => {
    expect(
      resolveExplorerMove(
        { relativePath: "a/foo.ts", isDir: false },
        { relativePath: "b", isDir: true },
      ),
    ).toEqual({
      kind: "move",
      fromPath: "a/foo.ts",
      toPath: "b/foo.ts",
      destDir: "b",
      isDir: false,
    });
  });

  test("moves a directory into another directory", () => {
    expect(
      resolveExplorerMove(
        { relativePath: "src/old", isDir: true },
        { relativePath: "lib", isDir: true },
      ),
    ).toEqual({
      kind: "move",
      fromPath: "src/old",
      toPath: "lib/old",
      destDir: "lib",
      isDir: true,
    });
  });

  test("moves into repository root", () => {
    expect(
      resolveExplorerMove(
        { relativePath: "src/foo.ts", isDir: false },
        { relativePath: "", isDir: true },
      ),
    ).toEqual({
      kind: "move",
      fromPath: "src/foo.ts",
      toPath: "foo.ts",
      destDir: "",
      isDir: false,
    });
  });

  test("dropping onto a file uses that file's parent", () => {
    expect(
      resolveExplorerMove(
        { relativePath: "a/foo.ts", isDir: false },
        { relativePath: "b/bar.ts", isDir: false },
      ),
    ).toEqual({
      kind: "move",
      fromPath: "a/foo.ts",
      toPath: "b/foo.ts",
      destDir: "b",
      isDir: false,
    });
  });

  test("already in the destination is a no-op", () => {
    expect(
      resolveExplorerMove(
        { relativePath: "src/foo.ts", isDir: false },
        { relativePath: "src", isDir: true },
      ),
    ).toEqual({ kind: "noop", destDir: "src" });
  });

  test("dropping a directory onto itself is invalid", () => {
    expect(
      resolveExplorerMove(
        { relativePath: "src", isDir: true },
        { relativePath: "src", isDir: true },
      ),
    ).toEqual({ kind: "invalid", reason: "self" });
  });

  test("dropping a directory into a descendant is invalid", () => {
    expect(
      resolveExplorerMove(
        { relativePath: "src", isDir: true },
        { relativePath: "src/hooks", isDir: true },
      ),
    ).toEqual({ kind: "invalid", reason: "into-descendant" });
  });

  test("dropping a directory onto a file inside itself is invalid", () => {
    expect(
      resolveExplorerMove(
        { relativePath: "src", isDir: true },
        { relativePath: "src/index.ts", isDir: false },
      ),
    ).toEqual({ kind: "invalid", reason: "self" });
  });

  test("dropping a directory onto itself is invalid even if isDir is missing", () => {
    expect(
      resolveExplorerMove(
        { relativePath: "src", isDir: false },
        { relativePath: "src", isDir: true },
      ),
    ).toEqual({ kind: "invalid", reason: "self" });
  });

  test("does not treat a similarly prefixed sibling as a descendant", () => {
    expect(
      resolveExplorerMove(
        { relativePath: "src", isDir: true },
        { relativePath: "src2", isDir: true },
      ),
    ).toEqual({
      kind: "move",
      fromPath: "src",
      toPath: "src2/src",
      destDir: "src2",
      isDir: true,
    });
  });

  test("empty source is invalid", () => {
    expect(
      resolveExplorerMove({ relativePath: "  ", isDir: false }, { relativePath: "src", isDir: true }),
    ).toEqual({ kind: "invalid", reason: "empty" });
  });
});
