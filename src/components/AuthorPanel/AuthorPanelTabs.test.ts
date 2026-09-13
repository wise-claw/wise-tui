import { describe, expect, test } from "bun:test";
import { AUTHOR_TAB_GROUPS, AUTHOR_TABS, isAuthorPane } from "./AuthorPanelTabs";

describe("AuthorPanelTabs", () => {
  test("groups configuration center by Hub / Automation / Channel / Artifact / runtime", () => {
    expect(AUTHOR_TAB_GROUPS.map((group) => group.title)).toEqual([
      "能力",
      "自动化",
      "通道",
      "产物",
      "运行",
    ]);
    expect(AUTHOR_TAB_GROUPS.some((group) => group.title === "Claude Code")).toBe(false);
  });

  test("exposes 席位 and 产物检查台 as first-class nav items", () => {
    const labels = AUTHOR_TAB_GROUPS.flatMap((group) => group.items.map((item) => `${item.key}:${item.label}`));
    expect(labels).toContain("agents:席位");
    expect(labels).toContain("artifacts:产物检查台");
    expect(labels).toContain("sandbox:沙箱");
    expect(labels).toContain("claude-plugins:插件");
    expect(labels).toContain("hooks:钩子");
    expect(labels).toContain("agents-explorer:仓库智能体");
    expect(isAuthorPane("artifacts")).toBe(true);
    expect(AUTHOR_TABS.some((tab) => tab.key === "workspaces")).toBe(true);
  });
});
