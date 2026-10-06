import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { Window } from "happy-dom";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import type { WorkspaceFileTreeRailProps } from "../WorkspaceFileTreeRail";
import type { GitPanelOpenFileOptions } from "../GitPanel/types";
import { RepositoryFileEditorOpenFileContext } from "../RepositoryFileEditorOpenFileContext";
import { getActivePaneIndex, resetActivePaneIndex } from "../../stores/activePaneIndexStore";
import { MainLayoutResizeHandle } from "../MainLayoutResizeHandle";

mock.module("../WorkspaceFileTreeRail", () => ({
  WorkspaceFileTreeRail: (props: WorkspaceFileTreeRailProps) => (
    <aside data-repository={props.repositoryPath}>
      <button title="close" onClick={props.onClose} />
      <button title="open" onClick={() => props.onOpenFile("README.md", {
        fromFileTree: true, fromGitChanges: "unstaged", line: 7,
      })} />
    </aside>
  ),
}));

const { PaneWorkspace } = await import("./PaneWorkspace");
const globals = globalThis as unknown as Record<string, unknown>;
const previousGlobals = new Map<string, unknown>();
let renderer: ReactTestRenderer | null = null;

beforeEach(() => {
  const dom = new Window({ url: "http://localhost/" });
  for (const key of ["window", "document"]) {
    previousGlobals.set(key, globals[key]);
    globals[key] = (dom as unknown as Record<string, unknown>)[key];
  }
  resetActivePaneIndex();
});

afterEach(() => {
  act(() => renderer?.unmount());
  renderer = null;
  for (const [key, value] of previousGlobals) {
    if (value === undefined) delete globals[key];
    else globals[key] = value;
  }
  previousGlobals.clear();
  resetActivePaneIndex();
});

function pane(index: number, repositoryPath: string) {
  return (
    <PaneWorkspace key={index} paneIndex={index} repositoryPath={repositoryPath} repositoryName={`repo-${index}`}>
      {({ fileTreeRailOpen, onToggleFileTree }) => (
        <button title={`toggle-${index}`} aria-pressed={fileTreeRailOpen} onClick={onToggleFileTree} />
      )}
    </PaneWorkspace>
  );
}

describe("PaneWorkspace", () => {
  test("each pane opens and closes its own repository tree", () => {
    act(() => {
      renderer = create(
        <RepositoryFileEditorOpenFileContext.Provider value={() => {}}>
          {pane(0, "/repo/first")}{pane(1, "/repo/second")}
        </RepositoryFileEditorOpenFileContext.Provider>,
      );
    });
    act(() => renderer!.root.findByProps({ title: "toggle-1" }).props.onClick());
    expect(renderer!.root.findAllByType("aside").map((node) => node.props["data-repository"])).toEqual(["/repo/second"]);
    expect(renderer!.root.findByProps({ title: "toggle-0" }).props["aria-pressed"]).toBe(false);
    act(() => renderer!.root.findByProps({ title: "close" }).props.onClick());
    expect(renderer!.root.findAllByType("aside")).toHaveLength(0);
  });

  test("same-repository panes keep file and Git opens in the originating pane", () => {
    const opens: Array<[string, GitPanelOpenFileOptions | undefined]> = [];
    act(() => {
      renderer = create(
        <RepositoryFileEditorOpenFileContext.Provider value={(path, options) => opens.push([path, options])}>
          {pane(0, "/repo/shared")}{pane(1, "/repo/shared")}
        </RepositoryFileEditorOpenFileContext.Provider>,
      );
    });
    for (const index of [1, 0]) {
      act(() => renderer!.root.findByProps({ title: `toggle-${index}` }).props.onClick());
      const workspace = renderer!.root.findByProps({ "data-pane-index": index });
      act(() => workspace.findByProps({ title: "open" }).props.onClick());
      expect(getActivePaneIndex()).toBe(index);
    }
    expect(opens).toEqual([1, 0].map((index) => ["README.md", {
      fromFileTree: true, fromGitChanges: "unstaged", line: 7,
      fileRootPath: "/repo/shared", targetPaneIndex: index,
    }]));
  });

  test("repository switching updates the tree and file root; width remains bounded", () => {
    const opens: Array<GitPanelOpenFileOptions | undefined> = [];
    const renderPane = (path: string) => (
      <RepositoryFileEditorOpenFileContext.Provider value={(_path, options) => opens.push(options)}>
        {pane(1, path)}
      </RepositoryFileEditorOpenFileContext.Provider>
    );
    act(() => { renderer = create(renderPane("/repo/old")); });
    act(() => renderer!.root.findByProps({ title: "toggle-1" }).props.onClick());
    act(() => renderer!.root.findByType(MainLayoutResizeHandle).props.onWidthChange(999));
    expect(renderer!.root.findByType(MainLayoutResizeHandle).props.startWidthPx).toBe(480);
    act(() => { renderer!.update(renderPane("/repo/new")); });
    expect(renderer!.root.findByType("aside").props["data-repository"]).toBe("/repo/new");
    act(() => renderer!.root.findByProps({ title: "open" }).props.onClick());
    expect(opens[0]?.fileRootPath).toBe("/repo/new");
    act(() => renderer!.root.findByType(MainLayoutResizeHandle).props.onWidthChange(1));
    expect(renderer!.root.findByType(MainLayoutResizeHandle).props.startWidthPx).toBe(180);
  });
});
