import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { act, create } from "react-test-renderer";
import { renderToStaticMarkup } from "react-dom/server";
import { useGitChangesSelection } from "./useGitChangesSelection";
import { markPaneActive, resetActivePaneIndex } from "../stores/activePaneIndexStore";
import {
  clearPaneEditorPanelContext,
  resetPaneEditorPanelContextStoreForTests,
  setPaneEditorPanelContext,
} from "../stores/paneEditorPanelContextStore";
import { FileRow } from "../components/GitPanel/FileRow";
import { FileTreeView } from "../components/GitPanel/FileTreeView";

let renderer: ReturnType<typeof create> | undefined;
let selection: ReturnType<typeof useGitChangesSelection>;
let renders = 0;

function Probe() {
  selection = useGitChangesSelection("/repo");
  renders++;
  return null;
}

function context(path: string, section?: "staged" | "unstaged", rootPath = "/repo") {
  return {
    editorVisible: true,
    activePath: path,
    tabs: [{ relativePath: path, rootPath, gitDiffSection: section }],
  };
}

beforeEach(() => {
  resetActivePaneIndex();
  resetPaneEditorPanelContextStoreForTests();
  renders = 0;
});
afterEach(() => {
  act(() => renderer?.unmount());
  renderer = undefined;
  resetActivePaneIndex();
  resetPaneEditorPanelContextStoreForTests();
});

describe("Git change file selection", () => {
  test("follows editor tab changes and clears when the editor closes", () => {
    setPaneEditorPanelContext(0, context("src/a.ts", "staged"));
    act(() => { renderer = create(<Probe />); });
    expect(selection).toEqual({ stagedPath: "src/a.ts", unstagedPath: null });
    act(() => setPaneEditorPanelContext(0, context("src/b.ts", "unstaged")));
    expect(selection).toEqual({ stagedPath: null, unstagedPath: "src/b.ts" });
    act(() => clearPaneEditorPanelContext(0));
    expect(selection).toEqual({ stagedPath: null, unstagedPath: null });
  });

  test("uses the focused pane and does not highlight the same filename in another repository", () => {
    setPaneEditorPanelContext(0, context("src/a.ts", "staged"));
    setPaneEditorPanelContext(1, context("src/a.ts", "unstaged", "/other"));
    act(() => { renderer = create(<Probe />); });
    act(() => markPaneActive(1));
    expect(selection).toEqual({ stagedPath: null, unstagedPath: null });
    act(() => setPaneEditorPanelContext(1, context("src/b.ts", "unstaged", "/repo/")));
    expect(selection.unstagedPath).toBe("src/b.ts");
    act(() => resetActivePaneIndex());
    expect(selection.stagedPath).toBe("src/a.ts");
  });

  test("content updates do not rerender selection, and ordinary file tabs still identify the file", () => {
    const value = context("src/a.ts");
    setPaneEditorPanelContext(0, value);
    act(() => { renderer = create(<Probe />); });
    const before = renders;
    act(() => setPaneEditorPanelContext(0, { ...value, dirty: true,
      tabs: [{ ...value.tabs[0]!, content: "updated content" }] }));
    expect(renders).toBe(before);
    expect(selection).toEqual({ stagedPath: "src/a.ts", unstagedPath: "src/a.ts" });
  });

  test("marks only the selected row in a flat list", () => {
    const file = { path: "src/a.ts", status: "M", additions: 1, deletions: 1 };
    const selected = renderToStaticMarkup(<FileRow file={file} section="staged" selected onOpenFile={() => {}} />);
    const other = renderToStaticMarkup(<FileRow file={{ ...file, path: "src/b.ts" }} section="staged" onOpenFile={() => {}} />);
    expect(selected).toContain("git-file-row--selected");
    expect(selected).toContain('aria-current="true"');
    expect(other).not.toContain("git-file-row--selected");
    expect(other).not.toContain("aria-current");
  });

  test("propagates selection through expanded folders to the file row", () => {
    const html = renderToStaticMarkup(<FileTreeView
      files={[{ path: "src/nested/a.ts", status: "M", additions: 1, deletions: 1 },
        { path: "src/nested/b.ts", status: "M", additions: 0, deletions: 1 }]}
      section="unstaged" selectedPath="src/nested/a.ts"
      expandedDirs={new Set(["src", "src/nested"])} onToggleDir={() => {}} onOpenFile={() => {}}
    />);
    expect(html.match(/git-tree-node--selected/g)).toHaveLength(1);
    expect(html.match(/aria-current="true"/g)).toHaveLength(1);
  });
});
