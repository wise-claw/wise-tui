import { describe, expect, test } from "bun:test";
import { readExplorerDropTargetFromEvent } from "./useExplorerTreeDrop";

describe("readExplorerDropTargetFromEvent", () => {
  test("empty area resolves to repository root", () => {
    expect(
      readExplorerDropTargetFromEvent({
        target: { closest: () => null } as unknown as EventTarget,
      }),
    ).toEqual({ relativePath: "", isDir: true });
  });

  test("reads path and directory flag from the nearest tree row", () => {
    const row = {
      getAttribute: (name: string) => {
        if (name === "data-repo-path") return "src/hooks";
        if (name === "data-repo-is-dir") return "1";
        return null;
      },
    };
    expect(
      readExplorerDropTargetFromEvent({
        target: { closest: () => row } as unknown as EventTarget,
      }),
    ).toEqual({ relativePath: "src/hooks", isDir: true });
  });
});
