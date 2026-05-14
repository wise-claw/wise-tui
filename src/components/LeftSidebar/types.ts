import type {
  AddRepositoryOptions,
  ClaudeSession,
  EmployeeItem,
  EmployeeTaskCountItem,
  ProjectItem,
  Repository,
  SddMode,
  TaskMode,
} from "../../types";
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
  onProjectSelect: (projectId: string) => void;
  onCreateProject: (name: string, options?: { embedTrellis?: boolean }) => void | Promise<void>;
  onUpdateProject: (projectId: string, name: string) => void;
  onDeleteProject: (projectId: string) => void;
  pinnedProjectIds: string[];
  onTogglePinProject: (projectId: string) => void;
  onAddRepositoryToProject: (
    projectId: string,
    repositoryType: Repository["repositoryType"],
    options?: AddRepositoryOptions,
  ) => void;
  onAddFloatingRepository?: (
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
  onOpenPromptsRepository?: (project: ProjectItem, repository: Repository) => void;
  onOpenRepositoryMainOwner?: (repository: Repository) => void;
  sessions: ClaudeSession[];
  activeSessionId: string | null;
  onSelectSession: (sessionId: string) => void;
  employees?: EmployeeItem[];
  employeeTaskCounts?: EmployeeTaskCountItem[];
  onMoveEmployee?: (employeeId: string, direction: "up" | "down") => void;
  onCancelSessionFromMonitor?: (sessionId: string) => void;
  onOpenTaskDetailFromMonitor?: (taskId: string) => void;
  onReloadFullDiskTranscript?: (sessionKey: string) => void | Promise<void>;
  mcpNavActive?: boolean;
  onOpenMcpHub?: () => void;
  skillsNavActive?: boolean;
  onOpenSkillsHub?: () => void;
  activeRepositoryPath?: string;
  activeRepositoryName?: string;
  onOpenActiveRepositoryFile?: (path: string, options?: GitPanelOpenFileOptions) => void;
  taskCardsNavProps?: TaskCardsNavProps;
}
