import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { LeftSidebarBottomTabSwitcherView } from "./LeftSidebarBottomTabSwitcher";

describe("LeftSidebarBottomTabSwitcherView", () => {
  test("hides change dot when git has no file changes", () => {
    const html = renderToStaticMarkup(
      <LeftSidebarBottomTabSwitcherView activeTab="files" onChange={() => undefined} hasGitFileChanges={false} />,
    );
    expect(html).not.toContain("app-left-sidebar-repo-panel-tab__change-dot");
    expect(html).toContain('aria-label="Git"');
  });

  test("shows change dot on git tab when files are dirty", () => {
    const html = renderToStaticMarkup(
      <LeftSidebarBottomTabSwitcherView activeTab="files" onChange={() => undefined} hasGitFileChanges />,
    );
    expect(html).toContain("app-left-sidebar-repo-panel-tab__change-dot");
    expect(html).toContain("Git，有文件变更");
  });

  test("hides change dot while git tab is selected", () => {
    const html = renderToStaticMarkup(
      <LeftSidebarBottomTabSwitcherView activeTab="git" onChange={() => undefined} hasGitFileChanges />,
    );
    expect(html).not.toContain("app-left-sidebar-repo-panel-tab__change-dot");
    expect(html).toContain('aria-label="Git"');
  });
});
