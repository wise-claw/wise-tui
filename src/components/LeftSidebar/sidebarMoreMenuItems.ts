import type { MenuProps } from "antd";
import type { Workspace } from "../../types";
import {
  buildOpenAppConfigureMenuChildren,
  repositoryEditorOpenMenuLabel,
} from "../../utils/openAppScope";
import {
  repositoryTerminalOpenMenuLabel,
  showRepositoryTerminalOpenMenuItem,
} from "../../utils/repositoryTerminalOpenMenu";

type MenuItem = NonNullable<MenuProps["items"]>[number];

/** 产品暂时隐藏仓库右键「配置 Owner」入口；恢复时改为 true。 */
const REPOSITORY_MAIN_OWNER_MENU_ENABLED = false;

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
  scopeOpenAppId?: string | null;
}): MenuItem[] {
  const {
    directoryKey = "finder",
    onOpenDirectory = true,
    onOpenInEditor = true,
    onOpenInTerminal = false,
    includeBrowser = false,
    onNewPaneSession = false,
    scopeOpenAppId,
  } = input;
  const showTerminalOpen = onOpenInTerminal && showRepositoryTerminalOpenMenuItem();

  return compactItems([
    onOpenDirectory ? { key: directoryKey, label: "打开目录" } : null,
    onOpenInEditor ? { key: "editor", label: repositoryEditorOpenMenuLabel(scopeOpenAppId) } : null,
    showTerminalOpen ? { key: "open-terminal", label: repositoryTerminalOpenMenuLabel() } : null,
    includeBrowser ? { key: "browser", label: "打开 Git 仓库" } : null,
    onNewPaneSession ? { key: "new-session", label: "新开会话" } : null,
  ]);
}

function openAppConfigureMenuItem(scopeOpenAppId?: string | null): MenuItem {
  return {
    key: "open-app-submenu",
    label: "配置打开方式",
    popupClassName: "app-sidebar-more-menu-submenu",
    children: buildOpenAppConfigureMenuChildren(scopeOpenAppId),
  };
}

function repositoryTaskMenuItems(input: {
  trellisEnabled?: boolean;
  requirementsLabel?: string;
  onOpenRequirements?: boolean;
  onOpenScheduledTasks?: boolean;
  onOpenExecutableTasks?: boolean;
  onAddWorkspaceTodo?: boolean;
}): MenuItem[] {
  const {
    trellisEnabled = false,
    requirementsLabel = "仓库需求",
    onOpenRequirements = false,
    onOpenScheduledTasks = false,
    onOpenExecutableTasks = false,
    onAddWorkspaceTodo = true,
  } = input;

  return compactItems([
    onAddWorkspaceTodo ? { key: "add-workspace-todo", label: "添加待办事项" } : null,
    trellisEnabled && onOpenRequirements ? { key: "requirements", label: requirementsLabel } : null,
    onOpenScheduledTasks ? { key: "scheduled-tasks", label: "定时任务" } : null,
    trellisEnabled && onOpenExecutableTasks ? { key: "executable-tasks", label: "可执行任务" } : null,
  ]);
}

function repositoryMainSessionRunMenuItem(input: {
  onMainSessionRun?: boolean;
  runCommandRunning?: boolean;
  runRowPinned?: boolean;
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
      { type: "divider" },
      {
        key: "run-row-pin",
        label: input.runRowPinned ? "✓ 仓库行显示运行按钮" : "仓库行显示运行按钮",
      },
    ],
  };
}

function repositoryConfigureMenuItems(input: {
  onConfigureRepositoryIconBadge?: boolean;
  onOpenRepositoryMainOwner?: boolean;
  mainOwnerLabel?: string;
  onConfigureSddMode?: boolean;
  onConfigureOpenApp?: boolean;
  scopeOpenAppId?: string | null;
  onMainSessionRun?: boolean;
  runCommandRunning?: boolean;
  runRowPinned?: boolean;
  trellisRootActionEnabled?: boolean;
  trellisReady?: boolean;
}): MenuItem[] {
  const {
    onConfigureRepositoryIconBadge,
    onOpenRepositoryMainOwner,
    mainOwnerLabel = "配置 Owner",
    onConfigureSddMode,
    onConfigureOpenApp = true,
    scopeOpenAppId,
    onMainSessionRun,
    runCommandRunning = false,
    runRowPinned = false,
    trellisRootActionEnabled = false,
    trellisReady = false,
  } = input;

  return compactItems([
    onConfigureRepositoryIconBadge ? { key: "icon-badge", label: "配置角标" } : null,
    REPOSITORY_MAIN_OWNER_MENU_ENABLED && onOpenRepositoryMainOwner
      ? { key: "main-owner", label: mainOwnerLabel }
      : null,
    onConfigureOpenApp ? openAppConfigureMenuItem(scopeOpenAppId) : null,
    onConfigureSddMode ? { key: "sdd-mode", label: "配置 Claude 插件" } : null,
    repositoryMainSessionRunMenuItem({ onMainSessionRun, runCommandRunning, runRowPinned }),
    trellisRootActionEnabled && !trellisReady ? { key: "trellis-init", label: "启用 Wise Trellis" } : null,
  ]);
}

export interface BuildProjectMoreMenuItemsInput {
  isPinned: boolean;
  trellisEnabled?: boolean;
  trellisReady?: boolean;
  onAddWorkspaceTodo?: boolean;
  onAddRepositoryToProject?: boolean;
  onOpenProjectDirectory?: boolean;
  onConfigureSddMode?: boolean;
  onNewPaneSession?: boolean;
  onOpenScheduledTasksForProject?: boolean;
  onOpenExecutableTasksForProject?: boolean;
  onReconcileProject?: boolean;
  onOpenProjectInEditor?: boolean;
  onOpenProjectInTerminal?: boolean;
  projectOpenAppId?: string | null;
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
    onAddWorkspaceTodo = true,
    projectOpenAppId,
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
          scopeOpenAppId: projectOpenAppId,
        }),
      ),
      onNewPaneSession
        ? sidebarMenuSection([{ key: "new-session", label: "新开会话" }])
        : null,
      sidebarMenuSection([
        openAppConfigureMenuItem(projectOpenAppId),
        onConfigureSddMode ? { key: "sdd-mode", label: "配置 Claude 插件" } : null,
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
          onAddWorkspaceTodo,
        }),
      ),
    ],
    [{ key: "delete", label: "删除工作区", danger: true }],
  );
}

export interface BuildProjectRepositoryMoreMenuItemsInput {
  onAddWorkspaceTodo?: boolean;
  trellisEnabled?: boolean;
  trellisReady?: boolean;
  trellisRootActionEnabled?: boolean;
  onConfigureRepositoryIconBadge?: boolean;
  onOpenRepositoryMainOwner?: boolean;
  onConfigureSddMode?: boolean;
  /** 仓库运行指令（顶栏运行指令同款） */
  onMainSessionRun?: boolean;
  runCommandRunning?: boolean;
  runRowPinned?: boolean;
  onNewPaneSession?: boolean;
  onOpenScheduledTasks?: boolean;
  onOpenRequirements?: boolean;
  onOpenExecutableTasks?: boolean;
  onOpenRepositoryInTerminal?: boolean;
  repositoryOpenAppId?: string | null;
}

/** 项目内仓库行「更多」菜单，按功能分组。 */
export function buildProjectRepositoryMoreMenuItems(
  input: BuildProjectRepositoryMoreMenuItemsInput,
): MenuProps["items"] {
  const {
    onConfigureRepositoryIconBadge,
    onOpenRepositoryMainOwner,
    trellisEnabled = false,
    trellisReady = false,
    trellisRootActionEnabled = trellisEnabled,
    onConfigureSddMode,
    onMainSessionRun,
    runCommandRunning = false,
    runRowPinned = false,
    onNewPaneSession,
    onOpenScheduledTasks,
    onOpenRequirements,
    onOpenExecutableTasks,
    onOpenRepositoryInTerminal,
    onAddWorkspaceTodo = true,
    repositoryOpenAppId,
  } = input;

  const openItems = repositoryOpenMenuItems({
    onOpenInTerminal: Boolean(onOpenRepositoryInTerminal),
    includeBrowser: true,
    onNewPaneSession: Boolean(onNewPaneSession),
    scopeOpenAppId: repositoryOpenAppId,
  });
  const sessionItems = openItems.filter((item) => item != null && item.key === "new-session");
  const accessItems = openItems.filter((item) => item != null && item.key !== "new-session");

  return sidebarMenuWithSectionsAndDanger(
    [
      sidebarMenuSection(accessItems),
      sessionItems.length > 0 ? sidebarMenuSection(sessionItems) : null,
      sidebarMenuSection(
        repositoryConfigureMenuItems({
          onConfigureRepositoryIconBadge,
          onOpenRepositoryMainOwner,
          onConfigureSddMode,
          scopeOpenAppId: repositoryOpenAppId,
          onMainSessionRun,
          runCommandRunning,
          runRowPinned,
          trellisRootActionEnabled,
          trellisReady,
        }),
      ),
      sidebarMenuSection(
        repositoryTaskMenuItems({
          trellisEnabled,
          onOpenRequirements,
          onOpenScheduledTasks: Boolean(onOpenScheduledTasks),
          onOpenExecutableTasks: Boolean(onOpenExecutableTasks),
          onAddWorkspaceTodo,
        }),
      ),
    ],
    [{ key: "detach", label: "移出工作区", danger: true }],
  );
}

export interface BuildFloatingRepositoryMoreMenuItemsInput {
  onAddWorkspaceTodo?: boolean;
  joinableProjects: Workspace[];
  trellisEnabled?: boolean;
  trellisReady?: boolean;
  onConfigureRepositoryIconBadge?: boolean;
  onOpenRepositoryMainOwner?: boolean;
  onConfigureSddMode?: boolean;
  onMainSessionRun?: boolean;
  runCommandRunning?: boolean;
  runRowPinned?: boolean;
  onNewPaneSession?: boolean;
  onOpenScheduledTasks?: boolean;
  onOpenRequirements?: boolean;
  onOpenExecutableTasks?: boolean;
  onPromoteToNewProject?: boolean;
  onJoinExistingProject?: boolean;
  onOpenRepositoryInTerminal?: boolean;
  repositoryOpenAppId?: string | null;
}

/** 游离仓库行「更多」菜单，按功能分组。 */
export function buildFloatingRepositoryMoreMenuItems(
  input: BuildFloatingRepositoryMoreMenuItemsInput,
): MenuProps["items"] {
  const {
    joinableProjects,
    trellisEnabled = false,
    trellisReady = false,
    onConfigureRepositoryIconBadge,
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
    runRowPinned = false,
    onAddWorkspaceTodo = true,
    repositoryOpenAppId,
  } = input;

  const openItems = repositoryOpenMenuItems({
    onOpenInTerminal: Boolean(onOpenRepositoryInTerminal),
    includeBrowser: true,
    onNewPaneSession: Boolean(onNewPaneSession),
    scopeOpenAppId: repositoryOpenAppId,
  });
  const sessionItems = openItems.filter((item) => item != null && item.key === "new-session");
  const accessItems = openItems.filter((item) => item != null && item.key !== "new-session");

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
          onConfigureRepositoryIconBadge,
          onOpenRepositoryMainOwner,
          mainOwnerLabel: "主 Owner 智能体…",
          onConfigureSddMode,
          scopeOpenAppId: repositoryOpenAppId,
          onMainSessionRun,
          runCommandRunning,
          runRowPinned,
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
          onAddWorkspaceTodo,
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
