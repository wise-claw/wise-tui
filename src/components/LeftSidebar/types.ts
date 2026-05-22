import type {
  AddRepositoryOptions,
  ClaudeSession,
  EmployeeItem,
  EmployeeTaskCountItem,
  ProjectItem,
  Repository,
  SddMode,
  TaskMode,
  WorkflowGraph,
  WorkflowTemplateItem,
} from "../../types";
import type { ReconcileProjectMode } from "../../constants/reconcileProjectMode";
import type { WorkspaceFocus } from "../../utils/workspaceMode";
import type { GitPanelOpenFileOptions } from "../GitPanel";
import type { TaskCardsNavProps } from "../TaskCardsNav";

export interface LeftSidebarProps {
  dark: boolean;
  collapsed: boolean;
  /** Left `Sider` width in pixels. Defaults to `MAIN_LAYOUT_LEFT_SIDER_WIDTH_PX`. */
  siderWidth?: number;
  /** 为 true 时收起侧栏（需求拆分全屏叠层仍会用 fixed 盖住整窗）。 */
  parked?: boolean;
  /** Compact window mode: collapses the right rail and shrinks the main window. */
  compactLayoutMode?: boolean;
  onToggleCompactLayoutMode?: () => void;
  projects: ProjectItem[];
  activeProjectId: string | null;
  /** 当前侧栏选中粒度：Workspace 项目 vs 具体仓库。 */
  activeWorkspaceFocus?: WorkspaceFocus;
  repositories: Repository[];
  activeRepositoryId: number | null;
  authorDisabled?: boolean;
  authorDisabledTooltip?: string;
  onOpenAuthor: () => void;
  assistantHubActive?: boolean;
  onOpenAssistantHub?: () => void;
  mcpHubActive?: boolean;
  onOpenMcpHub?: () => void;
  skillsHubActive?: boolean;
  onOpenSkillsHub?: () => void;
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
  /** 在工作区根目录执行 `trellis init -y`（已存在则跳过）。 */
  onBootstrapTrellisForProject?: (project: ProjectItem) => void | Promise<void>;
  /** 在仓库目录执行 `trellis init -y`（已存在则跳过）。 */
  onBootstrapTrellisForRepository?: (repository: Repository) => void | Promise<void>;
  /** Workspace 菜单「图谱操作 → 生成 Workspace 索引」：多仓时并行启动各仓代码图谱检索 + GitNexus 仓库组同步；单仓仅本机检索 */
  onCodeGraphGenerateProject?: (project: ProjectItem) => void | Promise<void>;
  /** Workspace 菜单「图谱操作 → 查看检索」：打开代码图谱覆盖层（多仓时以当前 Workspace 为搜索范围） */
  onCodeGraphViewProject?: (project: ProjectItem) => void;
  /** 仓库菜单「图谱操作 → 生成检索」 */
  onCodeGraphGenerateRepository?: (repository: Repository) => void | Promise<void>;
  /** Workspace 内仓库「图谱操作 → 查看检索」 */
  onCodeGraphViewRepositoryInProject?: (project: ProjectItem, repository: Repository) => void;
  /** Standalone Repo「图谱操作 → 查看检索」 */
  onCodeGraphViewFloatingRepository?: (repository: Repository) => void;
  onAddFloatingRepository?: (
    repositoryType: Repository["repositoryType"],
    options?: AddRepositoryOptions,
  ) => void;
  onAddRepositoryToProject?: (
    projectId: string,
    repositoryType: Repository["repositoryType"],
    options?: AddRepositoryOptions,
  ) => void;
  onPromoteFloatingRepositoryToProject?: (
    repositoryId: number,
    projectName: string,
  ) => void | Promise<void>;
  floatingRepositories?: Repository[];
  onRemoveRepository?: (repository: Repository) => void | Promise<void>;
  onDetachRepositoryFromProject: (projectId: string, repositoryId: number) => void;
  onUpdateRepositorySddMode?: (repositoryId: number, sddMode: SddMode) => void | Promise<void>;
  onReorderRepositoriesInProject?: (projectId: string, repositoryIds: number[]) => void | Promise<void>;
  onMoveRepositoryToProject?: (targetProjectId: string, repositoryId: number) => void | Promise<void>;
  onRepositorySelect: (id: number | null) => void;
  onOpenInFinder: (repository: Repository) => void;
  onCreateProjectTask: (project: ProjectItem, mode: TaskMode) => void;
  onCreateRepositoryTask: (repository: Repository, mode: TaskMode) => void;
  onOpenPromptsProject?: (project: ProjectItem) => void;
  onOpenProjectTrellis?: (project: ProjectItem) => void;
  onOpenPromptsRepository?: (project: ProjectItem, repository: Repository) => void;
  onOpenRepositoryMainOwner?: (repository: Repository) => void;
  sessions: ClaudeSession[];
  repositoryMainSessionBindings: Record<string, string>;
  activeSessionId: string | null;
  onSelectSession: (sessionId: string) => void;
  employees?: EmployeeItem[];
  employeeTaskCounts?: EmployeeTaskCountItem[];
  workflowTemplates?: WorkflowTemplateItem[];
  workflowGraphsByWorkflowId?: Record<string, WorkflowGraph>;
  onMoveEmployee?: (employeeId: string, direction: "up" | "down") => void;
  onCancelSessionFromMonitor?: (sessionId: string) => void;
  onOpenTaskDetailFromMonitor?: (taskId: string) => void;
  onReloadFullDiskTranscript?: (sessionKey: string) => void | Promise<void>;
  activeRepositoryPath?: string;
  activeRepositoryName?: string;
  onOpenActiveRepositoryFile?: (path: string, options?: GitPanelOpenFileOptions) => void;
  taskCardsNavProps?: TaskCardsNavProps;
}
