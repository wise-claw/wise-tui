import type { MenuProps } from "antd";
import type { Workspace } from "../../types";
import { DEFAULT_OPEN_APP_ID, DEFAULT_OPEN_APP_TARGETS } from "../OpenAppMenu/constants";
import { getOpenAppPreferenceSync } from "../../services/openAppPreference";
import {
  repositoryTerminalOpenMenuLabel,
  showRepositoryTerminalOpenMenuItem,
} from "../../utils/repositoryTerminalOpenMenu";

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
function sidebarMenuWithDividers(
  ...sections: Array<MenuItem[] | null | undefined>
): MenuProps["items"] {
  const result: MenuItem[] = [];
  for (const section of sections) {
    if (!section || section.length === 0) continue;
    if (result.length > 0) result.push({ type: "divider" });
    result.push(...section);
  }
  return result;
}

/** 分段菜单 + 末尾危险项（分隔线隔开）。 */
function sidebarMenuWithSectionsAndDanger(
  sections: Array<MenuItem[] | null | undefined>,
  dangerItems?: Array<MenuItem | false | null | undefined>,
): MenuProps["items"] {
  const result = sidebarMenuWithDividers(...sections) ?? [];
  const danger = compactItems(dangerItems ?? []);
  if (danger.length > 0) {
    if (result.length > 0) result.push({ type: "divider" });
    result.push(...danger);
  }
  return result;
}

function repositoryOpenMenuItems(input: {
  directoryKey?: string;
  onOpenDirectory?: boolean;
  onOpenInEditor?: boolean;
  onOpenInTerminal?: boolean;
  includeBrowser?: boolean;
  onNewPaneSession?: boolean;
}): MenuItem[] {
  const {
    directoryKey = "finder",
    onOpenDirectory = true,
    onOpenInEditor = true,
    onOpenInTerminal = false,
    includeBrowser = false,
    onNewPaneSession = false,
  } = input;
  const showTerminalOpen = onOpenInTerminal && showRepositoryTerminalOpenMenuItem();

  return compactItems([
    onOpenDirectory ? { key: directoryKey, label: "打开目录" } : null,
    onOpenInEditor ? { key: "editor", label: repositoryEditorOpenMenuLabel() } : null,
    showTerminalOpen ? { key: "open-terminal", label: repositoryTerminalOpenMenuLabel() } : null,
    includeBrowser ? { key: "browser", label: "打开 Git 仓库" } : null,
    onNewPaneSession ? { key: "new-session", label: "新开会话" } : null,
  ]);
}

function repositoryTaskMenuItems(input: {
  trellisEnabled?: boolean;
  requirementsLabel?: string;
  onOpenRequirements?: boolean;
  onOpenScheduledTasks?: boolean;
  onOpenExecutableTasks?: boolean;
}): MenuItem[] {
  const {
    trellisEnabled = false,
    requirementsLabel = "仓库需求",
    onOpenRequirements = false,
    onOpenScheduledTasks = false,
    onOpenExecutableTasks = false,
  } = input;

  return compactItems([
    trellisEnabled && onOpenRequirements ? { key: "requirements", label: requirementsLabel } : null,
    onOpenScheduledTasks ? { key: "scheduled-tasks", label: "定时任务" } : null,
    trellisEnabled && onOpenExecutableTasks ? { key: "executable-tasks", label: "可执行任务" } : null,
  ]);
}

function repositoryMainSessionRunMenuItem(input: {
  onMainSessionRun?: boolean;
  runCommandRunning?: boolean;
}): MenuItem | null {
  if (!input.onMainSessionRun) return null;
  return {
    key: "run-submenu",
    label: "运行",
    popupClassName: "app-sidebar-more-menu-submenu",
    children: [
      { key: "run-configure", label: "配置" },
      {
        key: "run-start",
        label: "启动",
        disabled: input.runCommandRunning,
      },
      {
        key: "run-stop",
        label: "停止",
        disabled: !input.runCommandRunning,
      },
    ],
  };
}

function repositoryConfigureMenuItems(input: {
  onOpenRepositoryMainOwner?: boolean;
  mainOwnerLabel?: string;
  onConfigureSddMode?: boolean;
  onMainSessionRun?: boolean;
  runCommandRunning?: boolean;
  trellisRootActionEnabled?: boolean;
  trellisReady?: boolean;
  onOpenPromptsRepository?: boolean;
}): MenuItem[] {
  const {
    onOpenRepositoryMainOwner,
    mainOwnerLabel = "配置 Owner",
    onConfigureSddMode,
    onMainSessionRun,
    runCommandRunning = false,
    trellisRootActionEnabled = false,
    trellisReady = false,
    onOpenPromptsRepository,
  } = input;

  return compactItems([
    REPOSITORY_MAIN_OWNER_MENU_ENABLED && onOpenRepositoryMainOwner
      ? { key: "main-owner", label: mainOwnerLabel }
      : null,
    onConfigureSddMode ? { key: "sdd-mode", label: "配置 Claude 插件" } : null,
    repositoryMainSessionRunMenuItem({ onMainSessionRun, runCommandRunning }),
    trellisRootActionEnabled && !trellisReady ? { key: "trellis-init", label: "启用 Wise Trellis" } : null,
    onOpenPromptsRepository ? { key: "prompts", label: "提示词" } : null,
  ]);
}

export interface BuildProjectMoreMenuItemsInput {
  isPinned: boolean;
  trellisEnabled?: boolean;
  trellisReady?: boolean;
  onAddRepositoryToProject?: boolean;
  onOpenProjectDirectory?: boolean;
  onConfigureSddMode?: boolean;
  onNewPaneSession?: boolean;
  onOpenScheduledTasksForProject?: boolean;
  onOpenExecutableTasksForProject?: boolean;
  onReconcileProject?: boolean;
  onOpenProjectInEditor?: boolean;
  onOpenProjectInTerminal?: boolean;
}

/** Workspace 行「更多」菜单，按功能分组。 */
export function buildProjectMoreMenuItems(input: BuildProjectMoreMenuItemsInput): MenuProps["items"] {
  const {
    isPinned,
    trellisEnabled = false,
    trellisReady = false,
    onAddRepositoryToProject,
    onOpenProjectDirectory,
    onConfigureSddMode,
    onNewPaneSession,
    onOpenScheduledTasksForProject,
    onOpenExecutableTasksForProject,
    onReconcileProject,
    onOpenProjectInEditor,
    onOpenProjectInTerminal,
  } = input;

  return sidebarMenuWithSectionsAndDanger(
    [
      sidebarMenuSection([
        { key: "pin", label: isPinned ? "取消置顶" : "置顶" },
        { key: "rename", label: "重命名工作区" },
        onAddRepositoryToProject ? { key: "add-repository", label: "关联仓库" } : null,
      ]),
      sidebarMenuSection(
        repositoryOpenMenuItems({
          directoryKey: "open-directory",
          onOpenDirectory: Boolean(onOpenProjectDirectory),
          onOpenInEditor: Boolean(onOpenProjectInEditor),
          onOpenInTerminal: Boolean(onOpenProjectInTerminal),
        }),
      ),
      onNewPaneSession
        ? sidebarMenuSection([{ key: "new-session", label: "新开会话" }])
        : null,
      sidebarMenuSection([
        onConfigureSddMode ? { key: "sdd-mode", label: "配置 Claude 插件" } : null,
        { key: "prompts", label: "提示词" },
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
        trellisEnabled && !trellisReady ? { key: "trellis-init", label: "启用 Wise Trellis" } : null,
      ]),
      sidebarMenuSection(
        repositoryTaskMenuItems({
          trellisEnabled,
          requirementsLabel: "工作区需求",
          onOpenRequirements: trellisEnabled,
          onOpenScheduledTasks: Boolean(onOpenScheduledTasksForProject),
          onOpenExecutableTasks: Boolean(onOpenExecutableTasksForProject),
        }),
      ),
    ],
    [{ key: "delete", label: "删除工作区", danger: true }],
  );
}

export interface BuildProjectRepositoryMoreMenuItemsInput {
  trellisEnabled?: boolean;
  trellisReady?: boolean;
  trellisRootActionEnabled?: boolean;
  onOpenRepositoryMainOwner?: boolean;
  onOpenPromptsRepository?: boolean;
  onConfigureSddMode?: boolean;
  /** 仓库运行指令（顶栏运行指令同款） */
  onMainSessionRun?: boolean;
  runCommandRunning?: boolean;
  onNewPaneSession?: boolean;
  onOpenScheduledTasks?: boolean;
  onOpenRequirements?: boolean;
  onOpenExecutableTasks?: boolean;
  onOpenRepositoryInTerminal?: boolean;
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
    onMainSessionRun,
    runCommandRunning = false,
    onNewPaneSession,
    onOpenScheduledTasks,
    onOpenRequirements,
    onOpenExecutableTasks,
    onOpenRepositoryInTerminal,
  } = input;

  const openItems = repositoryOpenMenuItems({
    onOpenInTerminal: Boolean(onOpenRepositoryInTerminal),
    includeBrowser: true,
    onNewPaneSession: Boolean(onNewPaneSession),
  });
  const sessionItems = openItems.filter((item) => item.key === "new-session");
  const accessItems = openItems.filter((item) => item.key !== "new-session");

  return sidebarMenuWithSectionsAndDanger(
    [
      sidebarMenuSection(accessItems),
      sessionItems.length > 0 ? sidebarMenuSection(sessionItems) : null,
      sidebarMenuSection(
        repositoryConfigureMenuItems({
          onOpenRepositoryMainOwner,
          onConfigureSddMode,
          onMainSessionRun,
          runCommandRunning,
          trellisRootActionEnabled,
          trellisReady,
          onOpenPromptsRepository,
        }),
      ),
      sidebarMenuSection(
        repositoryTaskMenuItems({
          trellisEnabled,
          onOpenRequirements,
          onOpenScheduledTasks: Boolean(onOpenScheduledTasks),
          onOpenExecutableTasks: Boolean(onOpenExecutableTasks),
        }),
      ),
    ],
    [{ key: "detach", label: "移出工作区", danger: true }],
  );
}

export interface BuildFloatingRepositoryMoreMenuItemsInput {
  joinableProjects: Workspace[];
  trellisEnabled?: boolean;
  trellisReady?: boolean;
  onOpenRepositoryMainOwner?: boolean;
  onConfigureSddMode?: boolean;
  onMainSessionRun?: boolean;
  runCommandRunning?: boolean;
  onNewPaneSession?: boolean;
  onOpenScheduledTasks?: boolean;
  onOpenRequirements?: boolean;
  onOpenExecutableTasks?: boolean;
  onPromoteToNewProject?: boolean;
  onJoinExistingProject?: boolean;
  onOpenRepositoryInTerminal?: boolean;
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
    onNewPaneSession,
    onOpenScheduledTasks,
    onOpenRequirements,
    onOpenExecutableTasks,
    onPromoteToNewProject,
    onJoinExistingProject,
    onOpenRepositoryInTerminal,
    onMainSessionRun,
    runCommandRunning = false,
  } = input;

  const openItems = repositoryOpenMenuItems({
    onOpenInTerminal: Boolean(onOpenRepositoryInTerminal),
    includeBrowser: true,
    onNewPaneSession: Boolean(onNewPaneSession),
  });
  const sessionItems = openItems.filter((item) => item.key === "new-session");
  const accessItems = openItems.filter((item) => item.key !== "new-session");

  const joinChildren: MenuItem[] = joinableProjects.map((project) => ({
    key: `join-${project.id}`,
    label: project.name,
  }));

  return sidebarMenuWithSectionsAndDanger(
    [
      sidebarMenuSection(accessItems),
      sessionItems.length > 0 ? sidebarMenuSection(sessionItems) : null,
      sidebarMenuSection(
        repositoryConfigureMenuItems({
          onOpenRepositoryMainOwner,
          mainOwnerLabel: "主 Owner 智能体…",
          onConfigureSddMode,
          onMainSessionRun,
          runCommandRunning,
          trellisRootActionEnabled: trellisEnabled,
          trellisReady,
        }),
      ),
      sidebarMenuSection(
        repositoryTaskMenuItems({
          trellisEnabled,
          onOpenRequirements,
          onOpenScheduledTasks: Boolean(onOpenScheduledTasks),
          onOpenExecutableTasks: Boolean(onOpenExecutableTasks),
        }),
      ),
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
    ],
    [{ key: "remove", label: "移除仓库", danger: true }],
  );
}
