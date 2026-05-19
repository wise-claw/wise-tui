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
import type { GitPanelOpenFileOptions } from "../GitPanel";
import type { TaskCardsNavProps } from "../TaskCardsNav";

export interface LeftSidebarProps {
  dark: boolean;
  collapsed: boolean;
  /** Left `Sider` width in pixels. Defaults to `MAIN_LAYOUT_LEFT_SIDER_WIDTH_PX`. */
  siderWidth?: number;
  /** Compact window mode: collapses the right rail and shrinks the main window. */
  compactLayoutMode?: boolean;
  onToggleCompactLayoutMode?: () => void;
  projects: ProjectItem[];
  activeProjectId: string | null;
  repositories: Repository[];
  activeRepositoryId: number | null;
  authorDisabled?: boolean;
  authorDisabledTooltip?: string;
  onOpenAuthor: () => void;
  workspaceCreateRequest?: number;
  standaloneRepoAddRequest?: number;
  onProjectSelect: (projectId: string) => void;
  onCreateProject: (
    name: string,
    options?: { embedTrellis?: boolean; rootPath?: string | null },
  ) => void | Promise<void>;
  onUpdateProject: (projectId: string, name: string) => void;
  onDeleteProject: (projectId: string) => void;
  pinnedProjectIds: string[];
  onTogglePinProject: (projectId: string) => void;
  onReconcileProject?: (projectId: string, mode: ReconcileProjectMode) => void | Promise<void>;
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
