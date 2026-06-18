import type {
  AddRepositoryOptions,
  ClaudeSession,
  EmployeeMonitorItem,
  EmployeeItem,
  EmployeeTaskCountItem,
  MonitorDrawerTarget,
  ProjectItem,
  ProjectSddMode,
  RepositoryMemberMonitorItem,
  SessionConversationTaskItem,
  Repository,
  SddMode,
  TeamMonitorItem,
  TaskMode,
  WorkflowGraph,
  WorkflowTemplateItem,
} from "../../types";
import type { ReconcileProjectMode } from "../../constants/reconcileProjectMode";
import type { LeftSidebarHubQuickEntryId } from "../../constants/leftSidebarHubQuickEntries";
import type { WorkspaceFocus } from "../../utils/workspaceMode";
import type { ReactNode, RefObject } from "react";
import type { GitPanelOpenFileOptions } from "../GitPanel";
import type { TaskCardsNavProps } from "../TaskCardsNav";
import type { AuthorPane } from "../../types/viewMode";
import type { MonitorPanelPlacement } from "../../services/wiseDefaultConfigStore";
import type { WorkspaceFileTreeRailContext } from "../WorkspaceFileTreeRail/types";

export interface LeftSidebarProps {
  dark: boolean;
  collapsed: boolean;
  /** Left `Sider` width in pixels. Defaults to `MAIN_LAYOUT_LEFT_SIDER_WIDTH_PX`. */
  siderWidth?: number;
  /** 为 true 时收起侧栏（需求拆分全屏叠层仍会用 fixed 盖住整窗）。 */
  parked?: boolean;
  projects: ProjectItem[];
  activeProjectId: string | null;
  /** 当前侧栏选中粒度：Workspace 项目 vs 具体仓库。 */
  activeWorkspaceFocus?: WorkspaceFocus;
  repositories: Repository[];
  activeRepositoryId: number | null;
  authorDisabled?: boolean;
  authorDisabledTooltip?: string;
  onOpenAuthor: (pane?: AuthorPane) => void;
  leftSidebarHubQuickEntryIds?: readonly LeftSidebarHubQuickEntryId[];
  /** 是否显示左栏运行面板；默认 true，由 `wise.defaultConfig.v1` 控制。 */
  showLeftSidebarMonitorPanel?: boolean;
  /** 是否显示左栏工作区与仓库树；默认 true，由 `wise.defaultConfig.v1` 控制。 */
  showLeftSidebarWorkspaceList?: boolean;
  /** 是否显示左栏工作区列表中的仓库圆形角标；默认 false，由 `wise.defaultConfig.v1` 控制。 */
  showRepositoryIconBadgesInWorkspaceList?: boolean;
  mcpHubActive?: boolean;
  onOpenMcpHub?: () => void;
  skillsHubActive?: boolean;
  onOpenSkillsHub?: () => void;
  automationHubActive?: boolean;
  onOpenAutomationHub?: () => void;
  assistantsHubActive?: boolean;
  onOpenAssistantsHub?: () => void;
  claudePluginsHubActive?: boolean;
  onOpenClaudePluginsHub?: () => void;
  workspaceCreateRequest?: number;
  standaloneRepoAddRequest?: number;
  onProjectSelect: (projectId: string) => void;
  onCreateProject: (
    name: string,
    options?: {
      rootPath?: string | null;
      bootstrap?: import("../../constants/workspaceBootstrapAddons").WorkspaceBootstrapSelection;
      /** @deprecated 使用 `bootstrap.trellis` */
      embedTrellis?: boolean;
    },
  ) => void | Promise<void>;
  onUpdateProject: (projectId: string, name: string) => void;
  onDeleteProject: (projectId: string) => void;
  pinnedProjectIds: string[];
  onTogglePinProject: (projectId: string) => void;
  onReconcileProject?: (projectId: string, mode: ReconcileProjectMode) => void | Promise<void>;
  onAddFloatingRepository?: (
    repositoryType: Repository["repositoryType"],
    options?: AddRepositoryOptions,
    acquire?: import("../../types").RepositoryAcquireParams,
    explicitFolderPath?: string,
  ) => void;
  onAddRepositoryToProject?: (
    projectId: string,
    repositoryType: Repository["repositoryType"],
    options?: AddRepositoryOptions,
    acquire?: import("../../types").RepositoryAcquireParams,
    explicitFolderPath?: string,
  ) => void;
  onPromoteFloatingRepositoryToProject?: (
    repositoryId: number,
    projectName: string,
  ) => void | Promise<void>;
  floatingRepositories?: Repository[];
  onRemoveRepository?: (repository: Repository) => void | Promise<void>;
  onDetachRepositoryFromProject: (projectId: string, repositoryId: number) => void;
  onUpdateRepositorySddMode?: (repositoryId: number, sddMode: SddMode) => void | Promise<void>;
  onUpdateRepositoryIconBadge?: (
    repositoryId: number,
    patch: import("../../services/repository").RepositoryIconBadgePatch,
  ) => void | Promise<void>;
  onUpdateProjectSddMode?: (projectId: string, sddMode: ProjectSddMode) => void | Promise<void>;
  onUpdateRepositoryOpenAppId?: (repositoryId: number, openAppId: string | null) => void | Promise<void>;
  onUpdateProjectOpenAppId?: (projectId: string, openAppId: string | null) => void | Promise<void>;
  onNewPaneSessionForRepository?: (repository: Repository) => void;
  onNewPaneSessionForProject?: (project: ProjectItem) => void;
  onReorderRepositoriesInProject?: (projectId: string, repositoryIds: number[]) => void | Promise<void>;
  onMoveRepositoryToProject?: (targetProjectId: string, repositoryId: number) => void | Promise<void>;
  onRepositorySelect: (id: number | null) => void;
  onOpenInFinder: (repository: Repository) => void;
  /** 在 Finder 中打开工作区根目录（或单仓工作区的成员仓库目录） */
  onOpenProjectInFinder?: (project: ProjectItem) => void;
  /** 在默认终端中打开仓库目录（macOS） */
  onOpenInTerminal?: (repository: Repository) => void;
  /** 在默认终端中打开工作区目录（macOS） */
  onOpenProjectInTerminal?: (project: ProjectItem) => void;
  onOpenRepositoryInBrowser: (repository: Repository) => void;
  /** 打开主区+右栏定时任务叠层（由宿主渲染，与技能市场同构） */
  onOpenScheduledTasksForRepository?: (repository: Repository) => void;
  onOpenScheduledTasksForProject?: (project: ProjectItem) => void;
  onCreateProjectTask: (project: ProjectItem, mode: TaskMode) => void;
  onCreateRepositoryTask: (repository: Repository, mode: TaskMode) => void;
  /** 打开工作区需求拆分助手（勿走「选工作区 → 主会话」路径）。 */
  onOpenWorkspaceRequirements?: (project: ProjectItem) => void;
  /** 打开仓库需求拆分助手。 */
  onOpenRepositoryRequirements?: (repository: Repository) => void;
  onOpenPromptsProject?: (project: ProjectItem) => void;
  onOpenPromptsRepository?: (project: ProjectItem, repository: Repository) => void;
  onOpenRepositoryMainOwner?: (repository: Repository) => void;
  /** 打开仓库运行指令配置弹窗 */
  onConfigureRepositoryMainSessionRun?: (repository: Repository) => void;
  /** 启动仓库运行指令（与顶栏「运行」一致） */
  onStartRepositoryRunCommand?: (repository: Repository) => void;
  /** 停止仓库运行指令（与顶栏「停止运行」一致） */
  onStopRepositoryRunCommand?: (repository: Repository) => void;
  sessions: ClaudeSession[];
  /** App 壳层流式节流：`sessions` 引用每 token 变，结构指纹不变时侧栏 memo 可跳过重渲染。 */
  sessionsStructureKey: string;
  /** 始终指向最新 `sessions`；侧栏跳过重渲染时回调仍读此 ref。 */
  sessionsLiveRef: RefObject<readonly ClaudeSession[]>;
  /** 运行面板列表用：指纹节流后的会话，避免流式时每 token 重算终端状态 */
  monitorPanelSessions?: ClaudeSession[];
  repositoryMainSessionBindings: Record<string, string>;
  activeSessionId: string | null;
  onSelectSession: (sessionId: string) => void;
  /** 当前对话内的子代理 / 后台任务执行态（左栏 Git 模块下方展示） */
  sessionConversationTaskItems?: readonly SessionConversationTaskItem[];
  onStopSessionConversationTask?: (item: SessionConversationTaskItem) => void;
  /** 任务派发历史查询天数（1/3/5/7） */
  executionEnvironmentDispatchHistoryDays?: import("../../constants/executionEnvironmentDispatch").ExecutionEnvironmentDispatchHistoryDays;
  onExecutionEnvironmentDispatchHistoryDaysChange?: (
    days: import("../../constants/executionEnvironmentDispatch").ExecutionEnvironmentDispatchHistoryDays,
  ) => void | Promise<void>;
  executionEnvironmentDispatchHistoryDaysSaving?: boolean;
  employees?: EmployeeItem[];
  employeeTaskCounts?: EmployeeTaskCountItem[];
  workflowTemplates?: WorkflowTemplateItem[];
  workflowGraphsByWorkflowId?: Record<string, WorkflowGraph>;
  onMoveEmployee?: (employeeId: string, direction: "up" | "down") => void;
  onCancelSessionFromMonitor?: (sessionId: string) => void;
  onOpenTaskDetailFromMonitor?: (taskId: string) => void;
  onReloadFullDiskTranscript?: (sessionKey: string) => void | Promise<void>;
  onRefreshHistorySessions?: (scope: {
    repositoryPath: string;
    repositoryName: string;
  }) => void | Promise<void>;
  /** 磁盘 transcript 分页：按需加载更早的 jsonl 片段 */
  onLoadMoreTranscriptFromDisk?: (sessionId: string) => void | Promise<void>;
  projectId?: string | null;
  employeeMonitorItems?: EmployeeMonitorItem[];
  repositoryMemberMonitorItems?: RepositoryMemberMonitorItem[];
  teamMonitorItems?: TeamMonitorItem[];
  monitorActiveTarget?: MonitorDrawerTarget | null;
  onOpenTeamMonitorDetail?: (workflowId: string) => void;
  onOpenEmployeeConfig?: () => void;
  onOpenWorkflowConfig?: () => void;
  onStopEmployeeMonitor?: (employeeId: string) => void;
  onStopTeamMonitor?: (workflowId: string) => void;
  hideEmployeeUi?: boolean;
  onOpenOmcBatchInvocationDetail?: (input: {
    sessionId: string;
    repositoryPath: string;
    invocationKey: string;
  }) => void;
  onCancelOmcDirectBatchInvocation?: (invocationKey: string) => void;
  onCompactSessionHistory?: (sessionId: string) => void | Promise<void>;
  historyDrawerSessionId?: string | null;
  onHistoryDrawerSessionIdChange?: (sessionId: string | null) => void;
  onRestoreHistorySessionAsMain?: (sessionId: string) => void | Promise<void>;
  onCreateTerminalEmployeeSession?: (employeeId: string) => string | null | Promise<string | null>;
  onResumeSession?: import("../ProgressMonitorPanel/MonitorDrawerSessionComposer").MonitorDrawerResumeSessionFn;
  onPrepareSessionForMonitorDrawer?: import("../ProgressMonitorPanel/MonitorDrawerSessionComposer").MonitorDrawerPrepareSessionFn;
  activeRepositoryPath?: string;
  activeRepositoryName?: string;
  onOpenActiveRepositoryFile?: (path: string, options?: GitPanelOpenFileOptions) => void;
  /** Git 变更面板默认栏位。 */
  gitPanelPlacement?: MonitorPanelPlacement;
  /** 仓库文件树默认栏位。 */
  filesPanelPlacement?: MonitorPanelPlacement;
  /** Chat 模式是否存在右栏（Author / Cockpit 全屏时为 false）。 */
  repoPanelRightRailAvailable?: boolean;
  /** 右栏仓库面板（Git / 文件树）节点。 */
  onRepositoryRepoPanelChange?: (node: ReactNode | null) => void;
  fileTreeRailOpen?: boolean;
  onToggleFileTreeRail?: () => void;
  onWorkspaceFileTreeRailContextChange?: (context: WorkspaceFileTreeRailContext | null) => void;
  taskCardsNavProps?: TaskCardsNavProps;
}
