import type { MenuProps } from "antd";
import type { Workspace } from "../../types";
import { DEFAULT_OPEN_APP_ID, DEFAULT_OPEN_APP_TARGETS } from "../OpenAppMenu/constants";
import { getOpenAppPreferenceSync } from "../../services/openAppPreference";

type MenuItem = NonNullable<MenuProps["items"]>[number];

/** 产品暂时隐藏仓库右键「配置 Owner」入口；恢复时改为 true。 */
const REPOSITORY_MAIN_OWNER_MENU_ENABLED = false;

export function repositoryEditorOpenMenuLabel(): string {
  const id = getOpenAppPreferenceSync().trim() || DEFAULT_OPEN_APP_ID;
  const target = DEFAULT_OPEN_APP_TARGETS.find((item) => item.id === id) ?? DEFAULT_OPEN_APP_TARGETS[0];
  return target ? `在 ${target.label} 中打开` : "编辑器打开";
}

function compactItems(items: Array<MenuItem | false | null | undefined>): MenuItem[] {
  return items.filter((item): item is MenuItem => Boolean(item));
}

function sidebarMenuSection(children: Array<MenuItem | false | null | undefined>): MenuItem[] {
  return compactItems(children);
}

/** 多段菜单项之间用分隔线连接，跳过空段与连续分隔线。 */
function sidebarMenuWithDividers(...sections: Array<MenuItem[] | null | undefined>): MenuProps["items"] {
  const result: MenuItem[] = [];
  for (const section of sections) {
    if (!section || section.length === 0) continue;
    if (result.length > 0) result.push({ type: "divider" });
    result.push(...section);
  }
  return result;
}

export interface BuildProjectMoreMenuItemsInput {
  isPinned: boolean;
  trellisEnabled?: boolean;
  trellisReady?: boolean;
  onAddRepositoryToProject?: boolean;
  onOpenProjectDirectory?: boolean;
  onOpenScheduledTasksForProject?: boolean;
  onOpenExecutableTasksForProject?: boolean;
  onReconcileProject?: boolean;
  onCodeGraphGenerateProject?: boolean;
  onCodeGraphViewProject?: boolean;
}

/** Workspace 行「更多」菜单，按功能分组。 */
export function buildProjectMoreMenuItems(input: BuildProjectMoreMenuItemsInput): MenuProps["items"] {
  const {
    isPinned,
    trellisEnabled = false,
    trellisReady = false,
    onAddRepositoryToProject,
    onOpenProjectDirectory,
    onOpenScheduledTasksForProject,
    onOpenExecutableTasksForProject,
    onReconcileProject,
    onCodeGraphGenerateProject,
    onCodeGraphViewProject,
  } = input;

  return sidebarMenuWithDividers(
    sidebarMenuSection([
      { key: "pin", label: isPinned ? "取消置顶" : "置顶" },
      { key: "rename", label: "重命名工作区" },
      onOpenProjectDirectory ? { key: "open-directory", label: "打开目录" } : null,
      onAddRepositoryToProject ? { key: "add-repository", label: "关联仓库" } : null,
    ]),
    sidebarMenuSection([
      trellisEnabled ? { key: "requirements", label: "工作区需求" } : null,
      onOpenScheduledTasksForProject ? { key: "scheduled-tasks", label: "定时任务" } : null,
      trellisEnabled && onOpenExecutableTasksForProject ? { key: "executable-tasks", label: "可执行任务" } : null,
    ]),
    trellisEnabled && !trellisReady
      ? sidebarMenuSection([{ key: "trellis-init", label: "启用 Wise Trellis" }])
      : null,
    sidebarMenuSection([
      onReconcileProject
        ? {
            key: "reconcile-submenu",
            label: "重新初始化",
            popupClassName: "app-sidebar-more-menu-submenu",
            children: [
              { key: "reconcile-repos", label: "仅同步仓库" },
              { key: "reconcile-repos-graphs", label: "同步并重绘流程图（草稿）" },
            ],
          }
        : null,
      onCodeGraphGenerateProject && onCodeGraphViewProject
        ? {
            key: "code-graph-submenu",
            label: "图谱操作",
            popupClassName: "app-sidebar-more-menu-submenu",
            children: [
              { key: "code-graph-generate-project", label: "生成工作区索引" },
              { key: "code-graph-view-project", label: "查看检索" },
            ],
          }
        : null,
      { key: "prompts", label: "提示词" },
    ]),
    sidebarMenuSection([{ key: "delete", label: "删除工作区", danger: true }]),
  );
}

export interface BuildProjectRepositoryMoreMenuItemsInput {
  trellisEnabled?: boolean;
  trellisReady?: boolean;
  trellisRootActionEnabled?: boolean;
  onOpenRepositoryMainOwner?: boolean;
  onOpenPromptsRepository?: boolean;
  onConfigureSddMode?: boolean;
  onOpenScheduledTasks?: boolean;
  onOpenRequirements?: boolean;
  onOpenExecutableTasks?: boolean;
  onCodeGraphGenerateRepository?: boolean;
  onCodeGraphViewRepositoryInProject?: boolean;
}

/** 项目内仓库行「更多」菜单，按功能分组。 */
export function buildProjectRepositoryMoreMenuItems(
  input: BuildProjectRepositoryMoreMenuItemsInput,
): MenuProps["items"] {
  const {
    onOpenRepositoryMainOwner,
    trellisEnabled = false,
    trellisReady = false,
    trellisRootActionEnabled = trellisEnabled,
    onOpenPromptsRepository,
    onConfigureSddMode,
    onOpenScheduledTasks,
    onOpenRequirements,
    onOpenExecutableTasks,
    onCodeGraphGenerateRepository,
    onCodeGraphViewRepositoryInProject,
  } = input;

  return sidebarMenuWithDividers(
    sidebarMenuSection([
      { key: "finder", label: "打开目录" },
      { key: "editor", label: repositoryEditorOpenMenuLabel() },
      { key: "browser", label: "打开 Git 仓库" },
    ]),
    sidebarMenuSection([
      REPOSITORY_MAIN_OWNER_MENU_ENABLED && onOpenRepositoryMainOwner
        ? { key: "main-owner", label: "配置 Owner" }
        : null,
      onConfigureSddMode ? { key: "sdd-mode", label: "配置 Claude 插件" } : null,
      trellisRootActionEnabled && !trellisReady ? { key: "trellis-init", label: "启用 Wise Trellis" } : null,
      onOpenPromptsRepository ? { key: "prompts", label: "提示词" } : null,
    ]),
    sidebarMenuSection([
      trellisEnabled && onOpenRequirements ? { key: "requirements", label: "仓库需求" } : null,
      onOpenScheduledTasks ? { key: "scheduled-tasks", label: "定时任务" } : null,
      trellisEnabled && onOpenExecutableTasks ? { key: "executable-tasks", label: "可执行任务" } : null,
    ]),
    sidebarMenuSection([
      onCodeGraphGenerateRepository && onCodeGraphViewRepositoryInProject
        ? {
            key: "code-graph-submenu",
            label: "图谱操作",
            popupClassName: "app-sidebar-more-menu-submenu",
            children: [
              { key: "code-graph-generate-repo", label: "生成检索" },
              { key: "code-graph-view-repo", label: "查看检索" },
            ],
          }
        : null,
    ]),
    sidebarMenuSection([{ key: "detach", label: "移出工作区", danger: true }]),
  );
}

export interface BuildFloatingRepositoryMoreMenuItemsInput {
  joinableProjects: Workspace[];
  trellisEnabled?: boolean;
  trellisReady?: boolean;
  onOpenRepositoryMainOwner?: boolean;
  onConfigureSddMode?: boolean;
  onOpenScheduledTasks?: boolean;
  onOpenRequirements?: boolean;
  onOpenExecutableTasks?: boolean;
  onCodeGraphGenerateRepository?: boolean;
  onCodeGraphViewFloatingRepository?: boolean;
  onPromoteToNewProject?: boolean;
  onJoinExistingProject?: boolean;
}

/** 游离仓库行「更多」菜单，按功能分组。 */
export function buildFloatingRepositoryMoreMenuItems(
  input: BuildFloatingRepositoryMoreMenuItemsInput,
): MenuProps["items"] {
  const {
    joinableProjects,
    trellisEnabled = false,
    trellisReady = false,
    onOpenRepositoryMainOwner,
    onConfigureSddMode,
    onOpenScheduledTasks,
    onOpenRequirements,
    onOpenExecutableTasks,
    onCodeGraphGenerateRepository,
    onCodeGraphViewFloatingRepository,
    onPromoteToNewProject,
    onJoinExistingProject,
  } = input;

  const joinChildren: MenuItem[] = joinableProjects.map((project) => ({
    key: `join-${project.id}`,
    label: project.name,
  }));

  return sidebarMenuWithDividers(
    sidebarMenuSection([
      { key: "finder", label: "打开目录" },
      { key: "editor", label: repositoryEditorOpenMenuLabel() },
      { key: "browser", label: "打开 Git 仓库" },
    ]),
    sidebarMenuSection([
      REPOSITORY_MAIN_OWNER_MENU_ENABLED && onOpenRepositoryMainOwner
        ? { key: "main-owner", label: "主 Owner 智能体…" }
        : null,
      onConfigureSddMode ? { key: "sdd-mode", label: "配置 Claude 插件" } : null,
      trellisEnabled && !trellisReady ? { key: "trellis-init", label: "启用 Wise Trellis" } : null,
    ]),
    sidebarMenuSection([
      trellisEnabled && onOpenRequirements ? { key: "requirements", label: "仓库需求" } : null,
      onOpenScheduledTasks ? { key: "scheduled-tasks", label: "定时任务" } : null,
      trellisEnabled && onOpenExecutableTasks ? { key: "executable-tasks", label: "可执行任务" } : null,
    ]),
    sidebarMenuSection([
      onCodeGraphGenerateRepository && onCodeGraphViewFloatingRepository
        ? {
            key: "code-graph-submenu",
            label: "图谱操作",
            popupClassName: "app-sidebar-more-menu-submenu",
            children: [
              { key: "code-graph-generate-repo", label: "生成检索" },
              { key: "code-graph-view-repo", label: "查看检索" },
            ],
          }
        : null,
    ]),
    sidebarMenuSection([
      onPromoteToNewProject ? { key: "promote", label: "升格为工作区…" } : null,
      onJoinExistingProject && joinChildren.length > 0
        ? {
            key: "join",
            label: "加入工作区",
            popupClassName: "app-sidebar-more-menu-submenu",
            children: joinChildren,
          }
        : null,
    ]),
    sidebarMenuSection([{ key: "remove", label: "移除仓库", danger: true }]),
  );
}
