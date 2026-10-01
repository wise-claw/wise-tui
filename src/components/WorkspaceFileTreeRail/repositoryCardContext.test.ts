import { describe, expect, test } from "bun:test";
import { repositoryCardFileTreeContext } from "./repositoryCardContext";
import type { GitPanelOpenFileOptions } from "../GitPanel/types";

describe("repository card file tree", () => {
  test("opening identical relative filenames uses each card's root, preserving preview options", () => {
    const opened: Array<[string, GitPanelOpenFileOptions | undefined]> = [];
    const context = {
      repositoryPath: "/workspace", repositoryName: "工作区",
      onOpenFile: (path: string, options?: GitPanelOpenFileOptions) => { opened.push([path, options]); },
    };
    const frontend = { repositoryId: 1, path: "/workspace/frontend", name: "前端" };
    const backend = { repositoryId: 2, path: "/workspace/backend", name: "后端" };
    for (const entry of [frontend, backend]) {
      const scoped = repositoryCardFileTreeContext(context, entry);
      expect(scoped.repositoryPath).toBe(entry.path);
      expect(scoped.repositoryEntries).toEqual([entry]);
      scoped.onOpenFile("README.md", { fileRootPath: "/workspace", fromFileTree: true, line: 4 });
    }
    expect(opened).toEqual([
      ["README.md", { fileRootPath: frontend.path, fromFileTree: true, line: 4 }],
      ["README.md", { fileRootPath: backend.path, fromFileTree: true, line: 4 }],
    ]);
    expect(context.repositoryPath).toBe("/workspace");
    expect(repositoryCardFileTreeContext(context, null)).toBe(context);
  });
});
