import { afterEach, describe, expect, test } from "bun:test";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import {
  RepositoryFileEditorOpenFileContext,
  useRepositoryFileEditorOpenFileInPane,
  type OpenRepositoryFileHandler,
} from "./RepositoryFileEditorOpenFileContext";
import { getActivePaneIndex, markPaneActive, resetActivePaneIndex } from "../stores/activePaneIndexStore";
import { repositoryCardFileTreeContext } from "./WorkspaceFileTreeRail/repositoryCardContext";
import type { GitPanelOpenFileOptions } from "./GitPanel/types";

let renderer: ReactTestRenderer | undefined;
afterEach(() => {
  act(() => renderer?.unmount());
  renderer = undefined;
  resetActivePaneIndex();
});

function mountSidebarOpen() {
  const opened: Array<[string, GitPanelOpenFileOptions | undefined]> = [];
  let open!: OpenRepositoryFileHandler;
  function Sidebar() {
    open = useRepositoryFileEditorOpenFileInPane(0);
    return null;
  }
  act(() => {
    renderer = create(
      <RepositoryFileEditorOpenFileContext.Provider value={(path, options) => { opened.push([path, options]); }}>
        <Sidebar />
      </RepositoryFileEditorOpenFileContext.Provider>,
    );
  });
  return { open, opened };
}

describe("sidebar file opening", () => {
  test.each([undefined, "staged", "unstaged"] as const)(
    "file tree and Git %s opens target the first pane after focusing another pane",
    (fromGitChanges) => {
      const { open, opened } = mountSidebarOpen();
      markPaneActive(2);
      const options: GitPanelOpenFileOptions = {
        fileRootPath: "/repo/second", fromFileTree: true, line: 7,
        ...(fromGitChanges ? { fromGitChanges } : {}),
        targetPaneIndex: 2,
      };
      act(() => open("src/app.ts", options));
      expect(opened).toEqual([["src/app.ts", { ...options, targetPaneIndex: 0 }]]);
      expect(getActivePaneIndex()).toBe(0);
      expect(options.targetPaneIndex).toBe(2);
    },
  );

  test("the global rail keeps a selected repository card's file root while targeting the first pane", () => {
    const { open, opened } = mountSidebarOpen();
    const scoped = repositoryCardFileTreeContext({ repositoryPath: "/repo/first", onOpenFile: open }, {
      repositoryId: 2, path: "/repo/second", name: "第二个仓库",
    });
    markPaneActive(1);
    act(() => scoped.onOpenFile("README.md", { fromFileTree: true, fromGitChanges: "unstaged" }));
    expect(opened).toEqual([["README.md", {
      fromFileTree: true, fromGitChanges: "unstaged", fileRootPath: "/repo/second", targetPaneIndex: 0,
    }]]);
    expect(getActivePaneIndex()).toBe(0);
  });
});
