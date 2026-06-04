import { describe, expect, test } from "bun:test";
import {
  buildFloatingRepositoryMoreMenuItems,
  buildProjectMoreMenuItems,
  buildProjectRepositoryMoreMenuItems,
} from "./sidebarMoreMenuItems";

type MenuItems = ReturnType<typeof buildProjectRepositoryMoreMenuItems>;

function menuLabels(items: MenuItems): string[] {
  const labels: string[] = [];
  for (const item of items ?? []) {
    if (!item || typeof item !== "object") continue;
    if ("type" in item && item.type === "divider") continue;
    if ("label" in item && typeof item.label === "string") labels.push(item.label);
    if ("children" in item && Array.isArray(item.children)) {
      for (const child of item.children) {
        if (child && typeof child === "object" && "label" in child && typeof child.label === "string") {
          labels.push(child.label);
        }
      }
    }
  }
  return labels;
}

function dividerCount(items: MenuItems): number {
  return (items ?? []).filter(
    (item) => item && typeof item === "object" && "type" in item && item.type === "divider",
  ).length;
}

describe("buildProjectMoreMenuItems", () => {
  test("includes preferred editor open action when handler is available", () => {
    const labels = menuLabels(
      buildProjectMoreMenuItems({
        isPinned: false,
        onOpenProjectInEditor: true,
      }),
    );
    expect(labels.some((label) => label.startsWith("在 ") && label.endsWith(" 中打开"))).toBe(true);
  });

  test("separates workspace sections with dividers instead of group titles", () => {
    const items = buildProjectMoreMenuItems({
      isPinned: false,
      trellisEnabled: true,
      onAddRepositoryToProject: true,
      onOpenProjectDirectory: true,
      onOpenProjectInEditor: true,
      onOpenProjectInTerminal: true,
      onConfigureSddMode: true,
      onNewPaneSession: true,
      onOpenScheduledTasksForProject: true,
      onOpenExecutableTasksForProject: true,
      onReconcileProject: true,
    });
    const labels = menuLabels(items);
    expect(labels.some((label) => label.startsWith("["))).toBe(false);
    expect(dividerCount(items)).toBeGreaterThan(0);
    expect(labels).toContain("删除工作区");
    expect(labels).toContain("添加待办事项");
  });

  test("omits add-workspace-todo when disabled", () => {
    const labels = menuLabels(
      buildProjectMoreMenuItems({
        isPinned: false,
        onAddWorkspaceTodo: false,
        onOpenScheduledTasksForProject: true,
      }),
    );
    expect(labels).not.toContain("添加待办事项");
  });
});

describe("buildProjectRepositoryMoreMenuItems", () => {
  test("separates repository sections with dividers instead of group titles", () => {
    const items = buildProjectRepositoryMoreMenuItems({
      trellisEnabled: true,
      onConfigureSddMode: true,
      onMainSessionRun: true,
      onNewPaneSession: true,
      onOpenScheduledTasks: true,
      onOpenRequirements: true,
      onOpenExecutableTasks: true,
      onOpenRepositoryInTerminal: true,
    });
    const labels = menuLabels(items);
    expect(labels.some((label) => label.startsWith("["))).toBe(false);
    expect(dividerCount(items)).toBeGreaterThan(0);
    expect(labels).toContain("移出工作区");
    expect(labels).toContain("添加待办事项");
  });

  test("includes run control even when chat quick action is hidden in multi-repo workspace", () => {
    const labels = menuLabels(
      buildProjectRepositoryMoreMenuItems({
        onConfigureSddMode: true,
        onMainSessionRun: true,
        runCommandRunning: false,
      }),
    );
    expect(labels).toContain("运行");
  });

  test("run submenu includes configure, start, and stop", () => {
    const labels = menuLabels(
      buildProjectRepositoryMoreMenuItems({
        onMainSessionRun: true,
        runCommandRunning: false,
      }),
    );
    expect(labels).toContain("运行");
    expect(labels).toContain("配置");
    expect(labels).toContain("启动");
    expect(labels).toContain("停止");
  });

  test("run submenu still present when main session is running", () => {
    const labels = menuLabels(
      buildProjectRepositoryMoreMenuItems({
        onMainSessionRun: true,
        runCommandRunning: true,
      }),
    );
    expect(labels).toContain("运行");
    expect(labels).toContain("停止");
    expect(labels).not.toContain("停止运行");
  });

  test("omits add-workspace-todo when disabled", () => {
    const labels = menuLabels(
      buildProjectRepositoryMoreMenuItems({
        onAddWorkspaceTodo: false,
        onOpenScheduledTasks: true,
      }),
    );
    expect(labels).not.toContain("添加待办事项");
  });
});

describe("buildFloatingRepositoryMoreMenuItems", () => {
  test("includes membership actions for standalone repositories", () => {
    const labels = menuLabels(
      buildFloatingRepositoryMoreMenuItems({
        joinableProjects: [{ id: "p1", name: "eco", repositoryIds: [] } as never],
        onPromoteToNewProject: true,
        onJoinExistingProject: true,
      }),
    );
    expect(labels).toContain("升格为工作区…");
    expect(labels).toContain("加入工作区");
    expect(labels).toContain("移除仓库");
    expect(labels).toContain("添加待办事项");
  });

  test("omits add-workspace-todo when disabled", () => {
    const labels = menuLabels(
      buildFloatingRepositoryMoreMenuItems({
        joinableProjects: [],
        onAddWorkspaceTodo: false,
        onOpenScheduledTasks: true,
      }),
    );
    expect(labels).not.toContain("添加待办事项");
  });
});
