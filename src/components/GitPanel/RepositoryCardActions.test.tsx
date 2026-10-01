import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { RepositoryCardActions } from "./RepositoryCardActions";
import { leftSidebarRepoPanelBottomSlotPropsEqual } from "../LeftSidebar/leftSidebarRepoPanelBottomSlotPropsEqual";

const entry = { repositoryId: 2, path: "/workspace/backend", name: "backend", openAppId: "cursor" };

describe("repository card actions", () => {
  test("shows per-repository tools and the configured editor", () => {
    const html = renderToStaticMarkup(<RepositoryCardActions entry={entry} />);
    for (const label of ["终端", "新会话", "目录", "配置 backend 的 IDE", "在 Cursor 中打开"]) {
      expect(html).toContain(label);
    }
    expect(html).not.toContain('disabled=""');
    expect(html).not.toContain(">IDE<");
    expect(html).toContain('aria-label="在 Cursor 中打开"');
  });

  test("IDE preference changes invalidate the sidebar memo", () => {
    const props = {
      effectiveRepoPanelPath: "/workspace", repoPanelRepositoryName: "workspace",
      repositoryFileTreeSearch: "", workspaceListEffectivelyCollapsed: false,
      leftBottomTab: "git" as const, bottomTabPanelsReady: true,
      showGitOnLeft: true, showFilesOnLeft: false, gitPanelRepositoryEntries: [entry],
    };
    expect(leftSidebarRepoPanelBottomSlotPropsEqual(props, { ...props, gitPanelRepositoryEntries: [{ ...entry }] })).toBe(true);
    expect(leftSidebarRepoPanelBottomSlotPropsEqual(props, { ...props, gitPanelRepositoryEntries: [{ ...entry, openAppId: "intellij" }] })).toBe(false);
  });
});
