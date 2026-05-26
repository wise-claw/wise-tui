import { describe, expect, mock, test } from "bun:test";
import { App as AntApp } from "antd";
import { renderToStaticMarkup } from "react-dom/server";
import { MyExtensionsPanel } from "./index";

mock.module("@tauri-apps/plugin-opener", () => ({
  openPath: mock(async () => undefined),
}));

mock.module("../../services/myExtensions", () => ({
  listExtensionLibrary: mock(async () => [
    {
      id: "lib-1",
      kind: "skill",
      name: "wise-before-dev",
      description: "项目技能",
      capturedFromRepository: "/tmp/repo",
      capturedAt: "2026-05-26T00:00:00Z",
      originScope: "project",
      snapshotDir: "items/lib-1",
    },
  ]),
  getExtensionLibraryHome: mock(async () => "/Users/test/.wise/extension-library"),
  listExtensionLibrarySnapshotTree: mock(async () => [
    { key: "hooks-settings.json", title: "hooks-settings.json", isLeaf: true },
  ]),
  getExtensionLibraryItemContent: mock(async () => ({
    libraryItemId: "lib-1",
    relativePath: "hooks-settings.json",
    path: "/Users/test/.wise/extension-library/items/lib-1/hooks-settings.json",
    language: "json",
    content: "{}",
  })),
  saveExtensionLibraryItemContent: mock(async () => undefined),
  createExtensionLibrarySnapshotFile: mock(async () => undefined),
  createExtensionLibrarySnapshotDirectory: mock(async () => undefined),
  deleteExtensionLibrarySnapshotEntry: mock(async () => undefined),
  updateExtensionLibraryItemName: mock(async () => ({
    id: "lib-1",
    kind: "skill",
    name: "wise-before-dev",
    description: "项目技能",
    capturedFromRepository: "/tmp/repo",
    capturedAt: "2026-05-26T00:00:00Z",
    originScope: "project",
    snapshotDir: "items/lib-1",
  })),
  removeExtensionLibraryItem: mock(async () => undefined),
  installExtensionFromLibrary: mock(async () => ({
    installedPath: "/Users/test/.claude/skills/foo",
    installScope: "global",
  })),
}));

describe("MyExtensionsPanel", () => {
  test("renders library section without discover capture", () => {
    const html = renderToStaticMarkup(
      <AntApp>
        <MyExtensionsPanel repositoryPath="/tmp/repo" />
      </AntApp>,
    );
    expect(html).toContain("我的扩展");
    expect(html).toContain("扩展库");
    expect(html).toContain("本机扩展库");
    expect(html).not.toContain("来自仓库");
  });

  test("ExtensionSnapshotTree renders directory toolbar", () => {
    const { ExtensionSnapshotTree } = require("./ExtensionSnapshotTree");
    const html = renderToStaticMarkup(
      <AntApp>
        <ExtensionSnapshotTree
          libraryItemId="lib-1"
          tree={[
            { key: "meta.json", title: "meta.json", isLeaf: true },
            { key: "skill", title: "skill", isLeaf: false, children: [] },
          ]}
          loading={false}
          selectedKey="meta.json"
          onSelect={() => undefined}
          onRefresh={async () => undefined}
        />
      </AntApp>,
    );
    expect(html).toContain("snapshot-tree");
    expect(html).toContain("根目录");
    expect(html).toContain("title=\"新建文件\"");
    expect(html).toContain("新建文件");
  });
});
