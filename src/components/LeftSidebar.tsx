import { PushpinOutlined } from "@ant-design/icons";
import { App as AntdApp, Button, Divider, Drawer, Dropdown, Empty, Input, Layout, Modal, Popover, Select, Space, Tag, Tooltip, Typography } from "antd";
import type { MenuProps } from "antd";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  AddRepositoryOptions,
  ClaudeSession,
  ClaudeSessionInfo,
  EmployeeItem,
  EmployeeTaskCountItem,
  ProjectItem,
  Repository,
  RepositoryAssociatePreset,
  TaskMode,
} from "../types";
import {
  REPOSITORY_ASSOCIATE_PRESETS_MAX,
  REPOSITORY_ASSOCIATE_PRESETS_STORAGE_KEY,
} from "../constants/repositoryAssociatePresets";
import {
  customPresetOptionValue,
  formatRepositoryAssociatePresetLabel,
  isCustomPresetSelectValue,
  newRepositoryAssociatePresetId,
  normalizeRepositoryAssociatePresets,
  presetFingerprint,
} from "../utils/repositoryAssociatePresets";
import { getAppSettingJson, setAppSettingJson } from "../services/appSettingsStore";
import {
  REPOSITORY_ICON_COLOR_PRESETS,
  repositoryFolderBasename,
  repositoryIconBadgeCircleLetter,
  repositoryIconBadgeDisplayText,
  repositoryTypeSolidBadgeColor,
  resolveRepositoryIconColor,
} from "../utils/repositoryType";
import { ClaudeSessionMessagesColumn } from "./ClaudeSessions/ClaudeSessionMessagesColumn";
import {
  getSessionPreview,
  HistorySessionPopoverContent,
  historySessionStatusLabel,
  historySessionStatusTagColor,
  matchSessionByKeyword,
  normalizeSearchKeyword,
  sessionUpdatedAt,
} from "./ProgressMonitorPanel";
import { AppSettingsModal } from "./AppSettingsModal";
import { IconSettings } from "./icons/IconSettings";
import { MAIN_LAYOUT_LEFT_SIDER_WIDTH_PX } from "../constants/mainLayoutWidths";
import { cancelClaudeExecution, listRunningClaudeSessions } from "../services/claude";
import {
  DEFAULT_OPEN_APP_ID,
  DEFAULT_OPEN_APP_TARGETS,
} from "./OpenAppMenu/constants";
import { getOpenAppPreferenceSync } from "../services/openAppPreference";
import {
  OPEN_WORKSPACE_ERROR,
  openWorkspaceWithStoredPreference,
} from "../services/openWorkspaceWithPreference";
import { isClaudeSessionRunningInHostOrUi } from "../services/claudeSessionState";
import { getSystemResourceSnapshot } from "../services/systemResource";
import { ClaudeCodeUsageHeaderBtn } from "./ClaudeCodeUsagePopover";
import { RepositoryFilesExplorer, type GitPanelOpenFileOptions } from "./GitPanel";
import "./GitPanel/index.css";

const LEFT_FILES_EXPLORER_COLLAPSED_KEY = "wise.leftPanel.filesExplorerCollapsed";

function readLeftFilesExplorerCollapsedFromStorage(): boolean {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(LEFT_FILES_EXPLORER_COLLAPSED_KEY) === "1";
}

// ── Session helpers ──

/** 系统注册表中有进程、但 Wise `sessions` 中无对应 `claudeSessionId` 时的列表占位行（与底部「数量」统计一致）。 */
const REGISTRY_ORPHAN_ROW_ID_PREFIX = "__wise_registry_orphan__:" as const;

function parseRegistryOrphanClaudeSid(drawerSessionId: string): string | null {
  if (!drawerSessionId.startsWith(REGISTRY_ORPHAN_ROW_ID_PREFIX)) return null;
  const raw = drawerSessionId.slice(REGISTRY_ORPHAN_ROW_ID_PREFIX.length).trim();
  return raw.length > 0 ? raw : null;
}

function buildRegistryOrphanClaudeSession(info: ClaudeSessionInfo): ClaudeSession {
  const sid = info.session_id.trim();
  const startedMs = Date.parse(info.started_at);
  const createdAt = Number.isFinite(startedMs) ? startedMs : Date.now();
  const path = info.project_path.trim();
  const normalizedPath = path.replace(/\\/g, "/");
  const repoName =
    normalizedPath.length > 0
      ? (normalizedPath.split("/").filter(Boolean).pop() ?? path)
      : "外部进程";
  const model = info.model.trim();
  return {
    id: `${REGISTRY_ORPHAN_ROW_ID_PREFIX}${sid}`,
    claudeSessionId: sid,
    repositoryPath: path.length > 0 ? path : "—",
    repositoryName: repoName,
    model: model.length > 0 ? model : "—",
    status: "running",
    messages: [],
    createdAt,
    pendingPrompt: "",
    diskPreview: path.length > 0 ? path : `Claude · ${sid.length > 10 ? `${sid.slice(0, 8)}…` : sid}`,
  };
}

// ── SVG Icons ──

function ProjectIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M2 2.5h12v2.5H2zM2 7h12v6.5H2z" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  );
}

function MoreIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="4" cy="8" r="1.2" fill="currentColor" />
      <circle cx="8" cy="8" r="1.2" fill="currentColor" />
      <circle cx="12" cy="8" r="1.2" fill="currentColor" />
    </svg>
  );
}

function ExpandIcon({ expanded }: { expanded: boolean }) {
  return (
    <svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ transform: expanded ? "rotate(90deg)" : "none", transition: "transform 0.15s" }}>
      <path d="M6 4l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M8 3v10M3 8h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function ChatIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M3 4.5A1.5 1.5 0 0 1 4.5 3h7A1.5 1.5 0 0 1 13 4.5v5A1.5 1.5 0 0 1 11.5 11H7l-2.5 2V11h0A1.5 1.5 0 0 1 3 9.5v-5z" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  );
}

function McpNavIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
      <path
        d="M3.5 5.5h3v5h-3v-5zm6 0h3v5h-3v-5zM5 3.5h6M5 12.5h6"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
      />
      <circle cx="5" cy="8" r="0.9" fill="currentColor" />
      <circle cx="11" cy="8" r="0.9" fill="currentColor" />
    </svg>
  );
}

function SkillsNavIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
      <path
        d="M8 1.8 9.55 4.9l3.4.5-2.45 2.4.58 3.4L8 9.55 4.82 11.2l.58-3.4L2.95 5.4l3.4-.5L8 1.8z"
        stroke="currentColor"
        strokeWidth="1.15"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function IconCompactLayout() {
  return (
    <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
      <rect x="3.5" y="4" width="17" height="16" rx="2" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
      <rect x="12" y="11" width="8.5" height="8" rx="1.5" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
    </svg>
  );
}

function RepositoryTypeIcon({ repository }: { repository: Repository }) {
  const full = repositoryIconBadgeDisplayText(repository);
  const letter = repositoryIconBadgeCircleLetter(repository);
  const badgeColor = resolveRepositoryIconColor(repository.repositoryType, repository.iconColor);
  return (
    <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <title>{full}</title>
      <circle cx="12" cy="12" r="10" fill={badgeColor} />
      <text
        x="12"
        y="12"
        dy="-1.75"
        textAnchor="middle"
        dominantBaseline="central"
        fontSize="12"
        fontWeight="700"
        fill="#ffffff"
      >
        {letter}
      </text>
    </svg>
  );
}

interface Props {
  dark: boolean;
  collapsed: boolean;
  /** 左栏 `Sider` 宽度（px）；默认 240 */
  siderWidth?: number;
  /** 小窗口模式：收起右栏并缩小主窗口；由左栏按钮切换 */
  compactLayoutMode?: boolean;
  onToggleCompactLayoutMode?: () => void;
  projects: ProjectItem[];
  activeProjectId: string | null;
  repositories: Repository[];
  activeRepositoryId: number | null;
  onProjectSelect: (projectId: string) => void;
  onCreateProject: (name: string) => void;
  onUpdateProject: (projectId: string, name: string) => void;
  onDeleteProject: (projectId: string) => void;
  pinnedProjectIds: string[];
  onTogglePinProject: (projectId: string) => void;
  onAddRepositoryToProject: (
    projectId: string,
    repositoryType: Repository["repositoryType"],
    options?: AddRepositoryOptions,
  ) => void;
  onDetachRepositoryFromProject: (projectId: string, repositoryId: number) => void;
  /** 项目内仓库拖拽排序；未传则单项目多仓时不显示排序手柄（仍可拖入其它项目） */
  onReorderRepositoriesInProject?: (projectId: string, repositoryIds: number[]) => void | Promise<void>;
  /** 从侧栏拖入仓库到目标项目；未传则仅支持同项目内排序 */
  onMoveRepositoryToProject?: (targetProjectId: string, repositoryId: number) => void | Promise<void>;
  onRepositorySelect: (id: number | null) => void;
  onOpenInFinder: (repository: Repository) => void;
  onCreateProjectTask: (project: ProjectItem, mode: TaskMode) => void;
  onCreateRepositoryTask: (repository: Repository, mode: TaskMode) => void;
  onOpenPromptsProject?: (project: ProjectItem) => void;
  onOpenPromptsRepository?: (project: ProjectItem, repository: Repository) => void;
  sessions: ClaudeSession[];
  activeSessionId: string | null;
  onSelectSession: (sessionId: string) => void;
  employees?: EmployeeItem[];
  employeeTaskCounts?: EmployeeTaskCountItem[];
  onMoveEmployee?: (employeeId: string, direction: "up" | "down") => void;
  /** 系统会话抽屉等：停止运行中的 Claude 会话 */
  onCancelSessionFromMonitor?: (sessionId: string) => void;
  /** 历史消息内「查看任务详情」打开监控任务抽屉 */
  onOpenTaskDetailFromMonitor?: (taskId: string) => void;
  /** 监控历史抽屉：非活动标签正文已丢弃时从磁盘拉回 jsonl */
  onReloadFullDiskTranscript?: (sessionKey: string) => void | Promise<void>;
  /** 左栏「项目」上方的 MCP 管理入口 */
  mcpNavActive?: boolean;
  onOpenMcpHub?: () => void;
  /** 左栏 skills.sh 技能目录入口 */
  skillsNavActive?: boolean;
  onOpenSkillsHub?: () => void;
  /** 当前选中仓库：在项目列表下方显示资源管理器 */
  activeRepositoryPath?: string;
  activeRepositoryName?: string;
  onOpenActiveRepositoryFile?: (path: string, options?: GitPanelOpenFileOptions) => void;
}

function TaskModeActions({ onSelect }: { onSelect: (mode: TaskMode) => void }) {
  return (
    <>
      <Tooltip title="对话" mouseEnterDelay={0.3}>
        <span
          className="app-repository-action app-repository-action--task"
          onClick={(e) => {
            e.stopPropagation();
            onSelect("chat");
          }}
        >
          <ChatIcon />
        </span>
      </Tooltip>
    </>
  );
}

function repositoryEditorOpenMenuLabel(): string {
  const id = getOpenAppPreferenceSync().trim() || DEFAULT_OPEN_APP_ID;
  const t = DEFAULT_OPEN_APP_TARGETS.find((item) => item.id === id) ?? DEFAULT_OPEN_APP_TARGETS[0];
  return t ? `在 ${t.label} 中打开` : "编辑器打开";
}

function reorderRepositoryIdsForDrop(
  ordered: readonly number[],
  draggedId: number,
  anchorId: number,
  placement: "before" | "after",
): number[] {
  const next = ordered.filter((id) => id !== draggedId);
  const anchorIdx = next.indexOf(anchorId);
  if (anchorIdx === -1) return [...ordered];
  const insertAt = placement === "before" ? anchorIdx : anchorIdx + 1;
  next.splice(insertAt, 0, draggedId);
  return next;
}

function RepoDragHandleIcon() {
  return (
    <svg viewBox="0 0 10 16" fill="currentColor" xmlns="http://www.w3.org/2000/svg" aria-hidden>
      <circle cx="3" cy="3" r="1.25" />
      <circle cx="7" cy="3" r="1.25" />
      <circle cx="3" cy="8" r="1.25" />
      <circle cx="7" cy="8" r="1.25" />
      <circle cx="3" cy="13" r="1.25" />
      <circle cx="7" cy="13" r="1.25" />
    </svg>
  );
}

interface RepositoryReorderUi {
  dragHandleEnabled: boolean;
  rowReorderEnabled: boolean;
  dropHint: { anchorRepositoryId: number; placement: "before" | "after" } | null;
  foreignDropRowId: number | null;
  onDragStartHandle: (e: React.DragEvent) => void;
  onDragEndHandle: () => void;
  onDragOverRow: (e: React.DragEvent) => void;
  onDragLeaveRow: (e: React.DragEvent) => void;
  onDropRow: (e: React.DragEvent) => void;
}

function RepositoryRow({
  project,
  repository,
  isActiveRepository,
  onRepositorySelect,
  onOpenTaskMode,
  onDetachFromProject,
  onOpenInFinder,
  onOpenRepositoryInEditor,
  onOpenPromptsRepository,
  repositoryReorder,
}: {
  project: ProjectItem;
  repository: Repository;
  isActiveRepository: boolean;
  onRepositorySelect: (id: number | null) => void;
  onOpenTaskMode: (repository: Repository, mode: TaskMode) => void;
  onDetachFromProject: (projectId: string, repositoryId: number) => void;
  onOpenInFinder: (repository: Repository) => void;
  onOpenRepositoryInEditor: (repository: Repository) => void;
  onOpenPromptsRepository?: (project: ProjectItem, repository: Repository) => void;
  repositoryReorder?: RepositoryReorderUi;
}) {
  const moreItems: MenuProps["items"] = [
    { key: "finder", label: "Finder打开" },
    { key: "editor", label: repositoryEditorOpenMenuLabel() },
    { key: "prompts", label: "提示词" },
    { key: "detach", label: "移出项目", danger: true },
  ];

  const dropRowClass =
    repositoryReorder?.rowReorderEnabled && repositoryReorder.dropHint?.anchorRepositoryId === repository.id
      ? repositoryReorder.dropHint.placement === "before"
        ? " app-repository-row--drop-before"
        : " app-repository-row--drop-after"
      : "";
  const foreignDropClass =
    repositoryReorder?.foreignDropRowId === repository.id ? " app-repository-row--foreign-drop" : "";

  return (
    <div
      className={`app-repository-row${dropRowClass}${foreignDropClass}`}
      onDragOver={repositoryReorder?.dragHandleEnabled ? repositoryReorder.onDragOverRow : undefined}
      onDragLeave={repositoryReorder?.dragHandleEnabled ? repositoryReorder.onDragLeaveRow : undefined}
      onDrop={repositoryReorder?.dragHandleEnabled ? repositoryReorder.onDropRow : undefined}
    >
      <div
        className={`app-repository-item app-repository-item--repo${isActiveRepository ? " app-repository-item--repo-active" : ""}`}
        onClick={() => onRepositorySelect(repository.id)}
      >
        {repositoryReorder?.dragHandleEnabled ? (
          <span
            className="app-repository-drag-handle"
            draggable
            onDragStart={repositoryReorder.onDragStartHandle}
            onDragEnd={repositoryReorder.onDragEndHandle}
            onClick={(e) => e.stopPropagation()}
            title="拖动排序 / 拖入其它项目"
            role="button"
            aria-label="拖动排序或拖入其它项目"
          >
            <RepoDragHandleIcon />
          </span>
        ) : null}
        <span className="app-repository-icon app-repository-icon--folder">
          <RepositoryTypeIcon repository={repository} />
        </span>
        <span className="app-repository-name">{repositoryFolderBasename(repository)}</span>
        <Dropdown
          rootClassName="app-sidebar-more-menu-dropdown"
          menu={{
            className: "app-sidebar-more-menu-inner",
            items: moreItems,
            onClick: ({ key }) => {
              if (key === "finder") onOpenInFinder(repository);
              if (key === "editor") onOpenRepositoryInEditor(repository);
              if (key === "detach") onDetachFromProject(project.id, repository.id);
              if (key === "prompts") onOpenPromptsRepository?.(project, repository);
            },
          }}
          trigger={["click"]}
          placement="bottomRight"
        >
          <span className="app-repository-action" onClick={(e) => e.stopPropagation()}>
            <MoreIcon />
          </span>
        </Dropdown>
        <TaskModeActions onSelect={(mode) => onOpenTaskMode(repository, mode)} />
      </div>

    </div>
  );
}

function ProjectRepositoryRows({
  project,
  projectRepos,
  activeRepositoryId,
  onRepositorySelect,
  onCreateRepositoryTask,
  onDetachRepositoryFromProject,
  onOpenInFinder,
  openRepositoryInPreferredEditor,
  onOpenPromptsRepository,
  onReorderRepositoriesInProject,
  onMoveRepositoryToProject,
  repoSidebarDragRef,
  onRepoSidebarDragEnd,
}: {
  project: ProjectItem;
  projectRepos: Repository[];
  activeRepositoryId: number | null;
  onRepositorySelect: (id: number | null) => void;
  onCreateRepositoryTask: (repository: Repository, mode: TaskMode) => void;
  onDetachRepositoryFromProject: (projectId: string, repositoryId: number) => void;
  onOpenInFinder: (repository: Repository) => void;
  openRepositoryInPreferredEditor: (repository: Repository) => void;
  onOpenPromptsRepository?: (project: ProjectItem, repository: Repository) => void;
  onReorderRepositoriesInProject?: (projectId: string, repositoryIds: number[]) => void | Promise<void>;
  onMoveRepositoryToProject?: (targetProjectId: string, repositoryId: number) => void | Promise<void>;
  repoSidebarDragRef: React.MutableRefObject<{ sourceProjectId: string; repositoryId: number } | null>;
  onRepoSidebarDragEnd: () => void;
}) {
  const { message } = AntdApp.useApp();
  const [dropHint, setDropHint] = useState<{ anchorRepositoryId: number; placement: "before" | "after" } | null>(
    null,
  );
  const [foreignDropRowId, setForeignDropRowId] = useState<number | null>(null);

  const rowReorderEnabled = Boolean(onReorderRepositoriesInProject) && projectRepos.length > 1;
  const dragHandleEnabled = Boolean(onMoveRepositoryToProject) || rowReorderEnabled;

  return (
    <>
      {projectRepos.map((repository) => {
        const reorderUi: RepositoryReorderUi | undefined = dragHandleEnabled
          ? {
              dragHandleEnabled: true,
              rowReorderEnabled,
              dropHint,
              foreignDropRowId,
              onDragStartHandle: (e: React.DragEvent) => {
                repoSidebarDragRef.current = { sourceProjectId: project.id, repositoryId: repository.id };
                e.dataTransfer.setData("text/plain", String(repository.id));
                e.dataTransfer.effectAllowed = "move";
                setDropHint(null);
                setForeignDropRowId(null);
              },
              onDragEndHandle: () => {
                repoSidebarDragRef.current = null;
                setDropHint(null);
                setForeignDropRowId(null);
                onRepoSidebarDragEnd();
              },
              onDragOverRow: (e: React.DragEvent) => {
                const d = repoSidebarDragRef.current;
                if (!d) return;
                if (d.sourceProjectId === project.id && rowReorderEnabled) {
                  e.preventDefault();
                  e.dataTransfer.dropEffect = "move";
                  setForeignDropRowId(null);
                  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                  const placement = e.clientY < rect.top + rect.height / 2 ? "before" : "after";
                  setDropHint({ anchorRepositoryId: repository.id, placement });
                  return;
                }
                if (d.sourceProjectId !== project.id && onMoveRepositoryToProject) {
                  e.preventDefault();
                  e.dataTransfer.dropEffect = "move";
                  setDropHint(null);
                  setForeignDropRowId(repository.id);
                }
              },
              onDragLeaveRow: (e: React.DragEvent) => {
                const related = e.relatedTarget as Node | null;
                if (related && (e.currentTarget as HTMLElement).contains(related)) return;
                setDropHint((prev) => (prev?.anchorRepositoryId === repository.id ? null : prev));
                setForeignDropRowId((cur) => (cur === repository.id ? null : cur));
              },
              onDropRow: (e: React.DragEvent) => {
                e.preventDefault();
                e.stopPropagation();
                const d = repoSidebarDragRef.current;
                repoSidebarDragRef.current = null;
                setDropHint(null);
                setForeignDropRowId(null);
                onRepoSidebarDragEnd();
                if (!d) return;

                if (d.sourceProjectId === project.id && rowReorderEnabled && onReorderRepositoriesInProject) {
                  const draggedId = d.repositoryId;
                  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                  const placement = e.clientY < rect.top + rect.height / 2 ? "before" : "after";
                  const baseOrder = projectRepos.map((r) => r.id);
                  const next = reorderRepositoryIdsForDrop(baseOrder, draggedId, repository.id, placement);
                  const unchanged = next.every((id, i) => id === baseOrder[i]);
                  if (unchanged) return;
                  void Promise.resolve(onReorderRepositoriesInProject(project.id, next)).catch((err: unknown) => {
                    message.error("调整仓库顺序失败");
                    console.error(err);
                  });
                  return;
                }
                if (d.sourceProjectId !== project.id && onMoveRepositoryToProject) {
                  void Promise.resolve(onMoveRepositoryToProject(project.id, d.repositoryId)).catch((err: unknown) => {
                    message.error("移动仓库到项目失败");
                    console.error(err);
                  });
                }
              },
            }
          : undefined;

        return (
          <RepositoryRow
            key={repository.id}
            project={project}
            repository={repository}
            isActiveRepository={repository.id === activeRepositoryId}
            onRepositorySelect={onRepositorySelect}
            onOpenTaskMode={onCreateRepositoryTask}
            onDetachFromProject={onDetachRepositoryFromProject}
            onOpenInFinder={onOpenInFinder}
            onOpenRepositoryInEditor={openRepositoryInPreferredEditor}
            onOpenPromptsRepository={onOpenPromptsRepository}
            repositoryReorder={reorderUi}
          />
        );
      })}
    </>
  );
}

export function LeftSidebar({
  dark,
  collapsed,
  siderWidth = MAIN_LAYOUT_LEFT_SIDER_WIDTH_PX,
  compactLayoutMode = false,
  onToggleCompactLayoutMode,
  projects,
  activeProjectId,
  repositories,
  activeRepositoryId,
  onProjectSelect,
  onCreateProject,
  onUpdateProject,
  onDeleteProject,
  pinnedProjectIds,
  onTogglePinProject,
  onAddRepositoryToProject,
  onDetachRepositoryFromProject,
  onReorderRepositoriesInProject,
  onMoveRepositoryToProject,
  onRepositorySelect,
  onOpenInFinder,
  onCreateProjectTask,
  onCreateRepositoryTask,
  onOpenPromptsProject,
  onOpenPromptsRepository,
  sessions,
  activeSessionId: _activeSessionId,
  onSelectSession: _onSelectSession,
  employees: _employees = [],
  employeeTaskCounts: _employeeTaskCounts = [],
  onMoveEmployee: _onMoveEmployee,
  onCancelSessionFromMonitor,
  onOpenTaskDetailFromMonitor,
  onReloadFullDiskTranscript,
  mcpNavActive = false,
  onOpenMcpHub,
  skillsNavActive = false,
  onOpenSkillsHub,
  activeRepositoryPath,
  activeRepositoryName,
  onOpenActiveRepositoryFile,
}: Props) {
  const { message, modal } = AntdApp.useApp();

  const openRepositoryInPreferredEditor = useCallback(
    (repository: Repository) => {
      void openWorkspaceWithStoredPreference(repository.path).catch((err: unknown) => {
        const code = err instanceof Error ? err.message : "";
        if (code === OPEN_WORKSPACE_ERROR.NOT_CONFIGURED) {
          message.warning("未配置可用的编辑器或命令，请在中栏顶部「打开方式」中选择");
        } else if (code === OPEN_WORKSPACE_ERROR.EMPTY_PATH) {
          message.warning("仓库路径为空");
        } else if (code === OPEN_WORKSPACE_ERROR.NO_TARGET) {
          message.warning("未找到可用的打开方式");
        } else {
          message.error("编辑器打开失败");
          console.error(err);
        }
      });
    },
    [message],
  );
  const [createProjectOpen, setCreateProjectOpen] = useState(false);
  const [projectNameInput, setProjectNameInput] = useState("");
  const [editProject, setEditProject] = useState<ProjectItem | null>(null);
  const [pendingAddRepositoryProjectId, setPendingAddRepositoryProjectId] = useState<string | null>(null);
  const [newRepositoryType, setNewRepositoryType] = useState<Repository["repositoryType"]>("frontend");
  const [newRepositoryDisplayName, setNewRepositoryDisplayName] = useState("");
  const [newRepositoryIconColor, setNewRepositoryIconColor] = useState<string | null>(null);
  const [repositoryAssociatePresets, setRepositoryAssociatePresets] = useState<RepositoryAssociatePreset[]>([]);
  const [associateSelectValue, setAssociateSelectValue] = useState<string>("frontend");
  const [expandedProjects, setExpandedProjects] = useState<Set<string>>(new Set());
  const repoSidebarDragRef = useRef<{ sourceProjectId: string; repositoryId: number } | null>(null);
  const [projectDropTargetId, setProjectDropTargetId] = useState<string | null>(null);
  const clearRepoSidebarDrag = useCallback(() => {
    repoSidebarDragRef.current = null;
    setProjectDropTargetId(null);
  }, []);

  const handleMoveRepositoryWithExpand = useCallback(
    async (targetProjectId: string, repositoryId: number) => {
      if (!onMoveRepositoryToProject) return;
      await onMoveRepositoryToProject(targetProjectId, repositoryId);
      setExpandedProjects((prev) => {
        const next = new Set(prev);
        next.add(targetProjectId);
        return next;
      });
    },
    [onMoveRepositoryToProject],
  );

  const projectIdsKey = useMemo(() => projects.map((p) => p.id).join(","), [projects]);
  const firstProjectId = useMemo(() => projects[0]?.id ?? null, [projects]);

  /** 项目删除等：从展开集合中剔除已不存在的 id */
  useEffect(() => {
    const valid = new Set(projectIdsKey.length > 0 ? projectIdsKey.split(",") : []);
    setExpandedProjects((prev) => {
      const next = new Set(Array.from(prev).filter((id) => valid.has(id)));
      if (next.size === prev.size && [...next].every((id) => prev.has(id))) return prev;
      return next;
    });
  }, [projectIdsKey]);

  /** 列表首项默认展开；仅当「当前第一项 id」变化或首次出现时加入，用户收起后不会在每次 projects 引用变化时被强行打开 */
  useEffect(() => {
    if (!firstProjectId) return;
    setExpandedProjects((prev) => {
      if (prev.has(firstProjectId)) return prev;
      const next = new Set(prev);
      next.add(firstProjectId);
      return next;
    });
  }, [firstProjectId]);

  const [systemSummary, setSystemSummary] = useState({
    systemTotalBytes: 0,
    systemUsedBytes: 0,
    appMemoryBytes: 0,
    claudeProcessCount: 0,
    claudeMemoryBytes: 0,
  });
  const [systemSummaryError, setSystemSummaryError] = useState(false);
  const [registryRunningClaude, setRegistryRunningClaude] = useState<ClaudeSessionInfo[]>([]);
  const [claudeCountPopoverOpen, setClaudeCountPopoverOpen] = useState(false);
  const [appSettingsOpen, setAppSettingsOpen] = useState(false);
  const [claudeSystemSessionSearch, setClaudeSystemSessionSearch] = useState("");
  const [systemSessionDrawerId, setSystemSessionDrawerId] = useState<string | null>(null);
  const [repositoryFileTreeSearch, setRepositoryFileTreeSearch] = useState("");
  const [filesExplorerSectionCollapsed, setFilesExplorerSectionCollapsed] = useState(
    readLeftFilesExplorerCollapsedFromStorage,
  );

  const handleFilesExplorerSectionCollapsedChange = useCallback((next: boolean) => {
    setFilesExplorerSectionCollapsed(next);
    try {
      window.localStorage.setItem(LEFT_FILES_EXPLORER_COLLAPSED_KEY, next ? "1" : "0");
    } catch {
      /* ignore quota / private mode */
    }
  }, []);

  const refreshRepositoryAssociatePresets = useCallback(async () => {
    const raw = await getAppSettingJson<unknown>(REPOSITORY_ASSOCIATE_PRESETS_STORAGE_KEY);
    setRepositoryAssociatePresets(normalizeRepositoryAssociatePresets(raw));
  }, []);

  useEffect(() => {
    void refreshRepositoryAssociatePresets();
  }, [refreshRepositoryAssociatePresets]);

  useEffect(() => {
    setRepositoryFileTreeSearch("");
  }, [activeRepositoryPath]);

  const associateRepositoryDropdownOptions = useMemo(() => {
    const builtinOptions = (["frontend", "backend", "document"] as const).map((t) => {
      const title = t === "frontend" ? "前端" : t === "backend" ? "后端" : "文档（PRD…）";
      return {
        value: t,
        title,
        label: (
          <span className="app-add-repo-option-row">
            <span
              className="app-add-repo-option-swatch"
              style={{ background: repositoryTypeSolidBadgeColor(t) }}
              aria-hidden
            />
            <span>{title}</span>
          </span>
        ),
      };
    });
    const groups: { label: string; options: { value: string; label: React.ReactNode }[] }[] = [
      { label: "预设角色", options: builtinOptions },
    ];
    if (repositoryAssociatePresets.length > 0) {
      groups.push({
        label: "常用配置",
        options: repositoryAssociatePresets.map((p) => {
          const title = formatRepositoryAssociatePresetLabel(p);
          return {
            value: customPresetOptionValue(p.id),
            title,
            label: (
              <span className="app-add-repo-option-row">
                <span
                  className="app-add-repo-option-swatch"
                  style={{ background: resolveRepositoryIconColor(p.repositoryType, p.iconColor) }}
                  aria-hidden
                />
                <span>{title}</span>
              </span>
            ),
          };
        }),
      });
    }
    return groups;
  }, [repositoryAssociatePresets]);

  const handleAddAssociatePreset = useCallback(async () => {
    const name = newRepositoryDisplayName.trim();
    const color = newRepositoryIconColor;
    const type = newRepositoryType;
    if (!name && color === null) {
      message.warning("请先填写角标文案或选择角标颜色");
      return;
    }
    const candidate: RepositoryAssociatePreset = {
      id: newRepositoryAssociatePresetId(),
      repositoryType: type,
      iconDisplayName: newRepositoryDisplayName.trim(),
      iconColor: color,
      createdAt: Date.now(),
    };
    const fp = presetFingerprint(candidate);
    if (repositoryAssociatePresets.some((p) => presetFingerprint(p) === fp)) {
      message.warning("已有相同的常用配置");
      return;
    }
    let next = [...repositoryAssociatePresets, candidate];
    next.sort((a, b) => b.createdAt - a.createdAt);
    if (next.length > REPOSITORY_ASSOCIATE_PRESETS_MAX) {
      next = next.slice(0, REPOSITORY_ASSOCIATE_PRESETS_MAX);
    }
    try {
      await setAppSettingJson(REPOSITORY_ASSOCIATE_PRESETS_STORAGE_KEY, next);
      setRepositoryAssociatePresets(next);
      setAssociateSelectValue(customPresetOptionValue(candidate.id));
      message.success("已加入常用选项");
    } catch (err) {
      console.error(err);
      message.error("保存常用配置失败");
    }
  }, [
    message,
    newRepositoryDisplayName,
    newRepositoryIconColor,
    newRepositoryType,
    repositoryAssociatePresets,
  ]);

  useEffect(() => {
    let cancelled = false;
    const VISIBLE_POLL_INTERVAL_MS = 8000;
    const HIDDEN_POLL_INTERVAL_MS = 20000;
    async function refreshSystemSummary() {
      const [snapshotResult, registryResult] = await Promise.allSettled([
        getSystemResourceSnapshot(),
        listRunningClaudeSessions(),
      ]);
      if (cancelled) return;
      if (snapshotResult.status === "fulfilled") {
        setSystemSummary(snapshotResult.value);
        setSystemSummaryError(false);
      }
      else {
        setSystemSummaryError(true);
      }
      if (registryResult.status === "fulfilled") {
        setRegistryRunningClaude(
          registryResult.value.filter((item) => item.status === "running"),
        );
      }
      else {
        setRegistryRunningClaude([]);
      }
    }
    void refreshSystemSummary();
    const timer = window.setInterval(() => {
      if (document.visibilityState !== "visible") {
        return;
      }
      void refreshSystemSummary();
    }, document.visibilityState === "visible" ? VISIBLE_POLL_INTERVAL_MS : HIDDEN_POLL_INTERVAL_MS);
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        void refreshSystemSummary();
      }
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, []);

  const repositoriesById = useMemo(
    () => new Map(repositories.map((repository) => [repository.id, repository])),
    [repositories],
  );

  const systemInlineSessionKeyword = normalizeSearchKeyword(claudeSystemSessionSearch);
  const claudeRegistryRunningIds = useMemo(
    () => new Set(registryRunningClaude.map((item) => item.session_id)),
    [registryRunningClaude],
  );
  const runningClaudeCodeSessions = useMemo(() => {
    const picked = sessions.filter((s) => isClaudeSessionRunningInHostOrUi(s, claudeRegistryRunningIds));
    const byId = new Map<string, ClaudeSession>();
    for (const s of picked) {
      byId.set(s.id, s);
    }
    return [...byId.values()].sort((a, b) => sessionUpdatedAt(b) - sessionUpdatedAt(a));
  }, [sessions, claudeRegistryRunningIds]);
  const registryOrphanClaudeSessions = useMemo(() => {
    const sessionClaudeIdSet = new Set(
      sessions
        .map((s) => s.claudeSessionId?.trim())
        .filter((id): id is string => Boolean(id && id.length > 0)),
    );
    const seenSid = new Set<string>();
    const out: ClaudeSession[] = [];
    for (const info of registryRunningClaude) {
      const sid = info.session_id.trim();
      if (!sid || sessionClaudeIdSet.has(sid) || seenSid.has(sid)) continue;
      seenSid.add(sid);
      out.push(buildRegistryOrphanClaudeSession(info));
    }
    return out;
  }, [sessions, registryRunningClaude]);
  /** 与底部「数量」一致：Wise 运行中/连接中会话 + 注册表有但侧栏未绑定的进程占位。 */
  const systemInlineRunningSessionsCombined = useMemo(
    () =>
      [...runningClaudeCodeSessions, ...registryOrphanClaudeSessions].sort(
        (a, b) => sessionUpdatedAt(b) - sessionUpdatedAt(a),
      ),
    [runningClaudeCodeSessions, registryOrphanClaudeSessions],
  );
  const matchedSystemInlineSessions = useMemo(() => {
    return systemInlineRunningSessionsCombined
      .filter((item) => matchSessionByKeyword(item, systemInlineSessionKeyword))
      .slice(0, 80);
  }, [systemInlineRunningSessionsCombined, systemInlineSessionKeyword]);

  const systemSessionDrawerWidth = useMemo(
    () => Math.min(560, typeof window !== "undefined" ? window.innerWidth - 24 : 560),
    [],
  );

  const liveSystemDrawerSession = useMemo(() => {
    if (!systemSessionDrawerId) return undefined;
    return sessions.find(
      (item) => item.id === systemSessionDrawerId || item.claudeSessionId === systemSessionDrawerId,
    );
  }, [systemSessionDrawerId, sessions]);

  const drawerRegistryOrphanSid = useMemo(
    () => (systemSessionDrawerId ? parseRegistryOrphanClaudeSid(systemSessionDrawerId) : null),
    [systemSessionDrawerId],
  );

  const systemDrawerTranscriptTargetId = liveSystemDrawerSession?.id ?? null;
  const systemDrawerTranscriptMessagesLen = liveSystemDrawerSession?.messages.length ?? 0;
  const systemDrawerTranscriptStatus = liveSystemDrawerSession?.status;
  const systemDrawerTranscriptClaudeId = liveSystemDrawerSession?.claudeSessionId?.trim() ?? "";

  useEffect(() => {
    if (!systemSessionDrawerId || drawerRegistryOrphanSid || !onReloadFullDiskTranscript || !systemDrawerTranscriptTargetId) {
      return;
    }
    if (systemDrawerTranscriptMessagesLen > 0) return;
    if (systemDrawerTranscriptStatus === "running" || systemDrawerTranscriptStatus === "connecting") return;
    if (!systemDrawerTranscriptClaudeId) return;
    void onReloadFullDiskTranscript(systemDrawerTranscriptTargetId);
  }, [
    systemSessionDrawerId,
    drawerRegistryOrphanSid,
    onReloadFullDiskTranscript,
    systemDrawerTranscriptTargetId,
    systemDrawerTranscriptMessagesLen,
    systemDrawerTranscriptStatus,
    systemDrawerTranscriptClaudeId,
  ]);
  const drawerRegistryOrphanInfo = useMemo(() => {
    if (!drawerRegistryOrphanSid) return undefined;
    return registryRunningClaude.find((item) => item.session_id.trim() === drawerRegistryOrphanSid);
  }, [drawerRegistryOrphanSid, registryRunningClaude]);

  const systemSessionDrawerTitle = useMemo(() => {
    if (drawerRegistryOrphanInfo) {
      const path = drawerRegistryOrphanInfo.project_path.trim();
      return path.length > 0 ? path : "Claude 进程（未绑定 Wise 会话）";
    }
    if (!liveSystemDrawerSession) return "会话消息";
    const name = liveSystemDrawerSession.repositoryName?.trim();
    return name && name.length > 0 ? name : getSessionPreview(liveSystemDrawerSession);
  }, [drawerRegistryOrphanInfo, liveSystemDrawerSession]);

  const canStopSystemDrawerSession =
    Boolean(onCancelSessionFromMonitor) &&
    liveSystemDrawerSession != null &&
    isClaudeSessionRunningInHostOrUi(liveSystemDrawerSession, claudeRegistryRunningIds);
  function toggleProjectExpand(id: string) {
    setExpandedProjects((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  function submitCreateProject() {
    const name = projectNameInput.trim();
    if (!name) {
      message.warning("项目名称不能为空");
      return;
    }
    onCreateProject(name);
    setProjectNameInput("");
    setCreateProjectOpen(false);
  }

  function submitUpdateProject() {
    if (!editProject) return;
    const name = projectNameInput.trim();
    if (!name) {
      message.warning("项目名称不能为空");
      return;
    }
    onUpdateProject(editProject.id, name);
    setEditProject(null);
    setProjectNameInput("");
  }

  function openAddRepositoryModal(projectId: string) {
    setPendingAddRepositoryProjectId(projectId);
    setAssociateSelectValue("frontend");
    setNewRepositoryType("frontend");
    setNewRepositoryDisplayName("");
    setNewRepositoryIconColor(null);
    void refreshRepositoryAssociatePresets();
  }

  function submitAddRepository() {
    if (!pendingAddRepositoryProjectId) return;
    if (isCustomPresetSelectValue(associateSelectValue)) {
      const presetId = associateSelectValue.slice("custom:".length);
      if (!repositoryAssociatePresets.some((p) => p.id === presetId)) {
        message.warning("所选常用配置已不存在，请重新选择");
        return;
      }
    }
    const projectId = pendingAddRepositoryProjectId;
    const iconText = newRepositoryDisplayName.trim();
    const opts: AddRepositoryOptions = {
      iconDisplayName: iconText.length > 0 ? iconText : undefined,
      iconColor: newRepositoryIconColor,
    };
    setPendingAddRepositoryProjectId(null);
    void onAddRepositoryToProject(projectId, newRepositoryType, opts);
  }

  return (
    <Layout.Sider
      width={siderWidth}
      collapsedWidth={0}
      collapsed={collapsed}
      className="app-left-sidebar"
      theme={dark ? "dark" : "light"}
    >
      {/* 左栏顶：与中栏 .app-chat-topbar 同高、同上下 padding(4px)，可拖区域 + 用量入口 */}
      <div className="app-left-sidebar-topbar">
        <div className="app-left-sidebar-topbar-drag app-logo-draggable" data-tauri-drag-region aria-hidden />
        <div className="app-left-sidebar-topbar-actions">
          <Tooltip title="设置：钉钉机器人、快捷键、Claude 沙箱与权限" mouseEnterDelay={0.35}>
            <button
              type="button"
              className="app-left-sidebar-compact-btn"
              aria-label="打开设置"
              onClick={() => setAppSettingsOpen(true)}
            >
              <IconSettings />
            </button>
          </Tooltip>
          {onToggleCompactLayoutMode ? (
            <Tooltip
              title={
                compactLayoutMode
                  ? "退出小窗口模式（⌥S）"
                  : "小窗口模式（收起右栏，窗口 700×600，快捷键 ⌥S）"
              }
              mouseEnterDelay={0.35}
            >
              <button
                type="button"
                className={`app-left-sidebar-compact-btn${compactLayoutMode ? " app-left-sidebar-compact-btn--active" : ""}`}
                aria-label={compactLayoutMode ? "退出小窗口模式" : "小窗口模式"}
                onClick={onToggleCompactLayoutMode}
              >
                <IconCompactLayout />
              </button>
            </Tooltip>
          ) : null}
          <ClaudeCodeUsageHeaderBtn />
        </div>
      </div>

      {onOpenMcpHub || onOpenSkillsHub ? (
        <div className="app-left-sidebar-top-nav-stack">
          {onOpenMcpHub ? (
            <button
              type="button"
              className={`app-left-sidebar-mcp-nav${mcpNavActive ? " app-left-sidebar-mcp-nav--active" : ""}`}
              onClick={onOpenMcpHub}
            >
              <span className="app-left-sidebar-mcp-nav-icon" aria-hidden>
                <McpNavIcon />
              </span>
              <span className="app-left-sidebar-mcp-nav-label">MCP</span>
            </button>
          ) : null}
          {onOpenSkillsHub ? (
            <button
              type="button"
              className={`app-left-sidebar-skills-nav${skillsNavActive ? " app-left-sidebar-skills-nav--active" : ""}`}
              onClick={onOpenSkillsHub}
            >
              <span className="app-left-sidebar-skills-nav-icon" aria-hidden>
                <SkillsNavIcon />
              </span>
              <span className="app-left-sidebar-skills-nav-label">技能</span>
            </button>
          ) : null}
        </div>
      ) : null}

      <div className="app-left-sidebar-project-and-files">
        {/* Project header */}
        <div className="app-repository-header">
          <Typography.Text className="app-repository-header-title">
            项目
          </Typography.Text>
          <div className="app-repository-header-actions">
            <Tooltip title="新建项目" mouseEnterDelay={0.3}>
              <button
                className="app-repository-header-btn"
                aria-label="新建项目"
                onClick={() => {
                  setProjectNameInput("");
                  setCreateProjectOpen(true);
                }}
              >
                <ProjectIcon />
              </button>
            </Tooltip>
          </div>
        </div>

        <div className="app-repository-list">
        {projects.map((project) => {
          const projectRepos = project.repositoryIds
            .map((id) => repositoriesById.get(id))
            .filter((item): item is Repository => Boolean(item));
          const isActiveProject = project.id === activeProjectId;
          const isPinned = pinnedProjectIds.includes(project.id);
          const projectMoreItems: MenuProps["items"] = [
            {
              key: "pin",
              label: isPinned ? "取消置顶" : "置顶",
            },
            { key: "rename", label: "重命名项目" },
            { key: "add-repo", label: "关联仓库" },
            { key: "prompts", label: "提示词" },
            { type: "divider" },
            { key: "delete", label: <span style={{ color: "var(--ant-color-error)" }}>删除项目</span> },
          ];
          return (
            <div
              key={project.id}
              className={`app-repository-row${projectDropTargetId === project.id ? " app-repository-row--project-drop" : ""}`}
              onDragOver={
                onMoveRepositoryToProject
                  ? (e) => {
                      const d = repoSidebarDragRef.current;
                      if (!d || d.sourceProjectId === project.id) return;
                      e.preventDefault();
                      e.dataTransfer.dropEffect = "move";
                      setProjectDropTargetId(project.id);
                    }
                  : undefined
              }
              onDragLeave={
                onMoveRepositoryToProject
                  ? (e) => {
                      const related = e.relatedTarget as Node | null;
                      if (related && (e.currentTarget as HTMLElement).contains(related)) return;
                      setProjectDropTargetId((cur) => (cur === project.id ? null : cur));
                    }
                  : undefined
              }
              onDrop={
                onMoveRepositoryToProject
                  ? (e) => {
                      e.preventDefault();
                      const d = repoSidebarDragRef.current;
                      clearRepoSidebarDrag();
                      if (!d || d.sourceProjectId === project.id) return;
                      void handleMoveRepositoryWithExpand(project.id, d.repositoryId).catch((err: unknown) => {
                        message.error("移动仓库到项目失败");
                        console.error(err);
                      });
                    }
                  : undefined
              }
            >
              <div
                className={`app-repository-item app-repository-item--project${isActiveProject ? " app-repository-item--project-active" : ""}`}
                onClick={() => onProjectSelect(project.id)}
              >
                <span
                  className="app-repository-expand"
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleProjectExpand(project.id);
                  }}
                >
                  <ExpandIcon expanded={expandedProjects.has(project.id)} />
                </span>
                <span className="app-repository-icon">
                  <ProjectIcon />
                </span>
                <span className="app-repository-name">{project.name}</span>
                <Tooltip title={isPinned ? "取消置顶" : "置顶"} mouseEnterDelay={0.35}>
                  <span
                    className={`app-repository-action app-repository-action--pin${isPinned ? " app-repository-action--pin-active" : ""}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      onTogglePinProject(project.id);
                    }}
                    role="button"
                    aria-label={isPinned ? "取消置顶" : "置顶"}
                  >
                    <PushpinOutlined />
                  </span>
                </Tooltip>
                <Dropdown
                  rootClassName="app-sidebar-more-menu-dropdown"
                  menu={{
                    className: "app-sidebar-more-menu-inner",
                    items: projectMoreItems,
                    onClick: ({ key }) => {
                      if (key === "pin") {
                        onTogglePinProject(project.id);
                      }
                      if (key === "rename") {
                        setEditProject(project);
                        setProjectNameInput(project.name);
                      }
                      if (key === "add-repo") openAddRepositoryModal(project.id);
                      if (key === "prompts") onOpenPromptsProject?.(project);
                      if (key === "delete") {
                        modal.confirm({
                          title: "确认删除项目？",
                          content: `项目「${project.name}」将被删除，但仓库本身不会被移除。`,
                          okText: "删除",
                          okType: "danger",
                          cancelText: "取消",
                          onOk: () => onDeleteProject(project.id),
                        });
                      }
                    },
                  }}
                  trigger={["click"]}
                  placement="bottomRight"
                >
                  <span className="app-repository-action" onClick={(e) => e.stopPropagation()}>
                    <MoreIcon />
                  </span>
                </Dropdown>
                <TaskModeActions onSelect={(mode) => onCreateProjectTask(project, mode)} />
                <span
                  className="app-repository-action app-repository-action--plus"
                  onClick={(e) => {
                    e.stopPropagation();
                    openAddRepositoryModal(project.id);
                  }}
                  title="关联仓库"
                >
                  <PlusIcon />
                </span>
              </div>

              {expandedProjects.has(project.id) && (
                <div className="app-repository-sessions">
                  {projectRepos.length === 0 ? (
                    <div className="app-session-item" onClick={() => openAddRepositoryModal(project.id)}>
                      <span className="app-session-item-name">点击关联仓库</span>
                    </div>
                  ) : (
                    <ProjectRepositoryRows
                      project={project}
                      projectRepos={projectRepos}
                      activeRepositoryId={activeRepositoryId}
                      onRepositorySelect={onRepositorySelect}
                      onCreateRepositoryTask={onCreateRepositoryTask}
                      onDetachRepositoryFromProject={onDetachRepositoryFromProject}
                      onOpenInFinder={onOpenInFinder}
                      openRepositoryInPreferredEditor={openRepositoryInPreferredEditor}
                      onOpenPromptsRepository={onOpenPromptsRepository}
                      onReorderRepositoriesInProject={onReorderRepositoriesInProject}
                      onMoveRepositoryToProject={handleMoveRepositoryWithExpand}
                      repoSidebarDragRef={repoSidebarDragRef}
                      onRepoSidebarDragEnd={clearRepoSidebarDrag}
                    />
                  )}
                </div>
              )}
            </div>
          );
        })}
        {projects.length === 0 && (
          <div className="app-repository-item app-repository-item--add" onClick={() => setCreateProjectOpen(true)}>
            <span className="app-repository-add-icon"><PlusIcon /></span>
            <span className="app-repository-add-text">新建项目</span>
          </div>
        )}
        </div>

        {activeRepositoryPath ? (
          <div
            className={
              "app-left-sidebar-files-explorer" +
              (filesExplorerSectionCollapsed ? " app-left-sidebar-files-explorer--section-collapsed" : "")
            }
          >
            {!filesExplorerSectionCollapsed ? (
              <div className="app-left-sidebar-files-explorer-search">
                <Input
                  size="small"
                  allowClear
                  placeholder="搜索文件..."
                  value={repositoryFileTreeSearch}
                  onChange={(e) => setRepositoryFileTreeSearch(e.target.value)}
                />
              </div>
            ) : null}
            <div className="app-left-sidebar-files-explorer-body">
              <RepositoryFilesExplorer
                repositoryPath={activeRepositoryPath}
                repositoryLabel={
                  activeRepositoryName?.trim() ||
                  activeRepositoryPath.split(/[/\\]/).filter(Boolean).pop() ||
                  "资源管理器"
                }
                search={repositoryFileTreeSearch}
                onOpenFile={onOpenActiveRepositoryFile}
                onClearExplorerSearch={() => setRepositoryFileTreeSearch("")}
                sectionCollapsed={filesExplorerSectionCollapsed}
                onSectionCollapsedChange={handleFilesExplorerSectionCollapsedChange}
              />
            </div>
          </div>
        ) : null}
      </div>

      <div className="app-left-sidebar-system-inline" title="系统资源状态">
        {systemSummaryError
          ? "内存:--  claude:--  数量:--"
          : (
            <>
              <span>内存:{formatBytes(systemSummary.appMemoryBytes)}</span>
              <span>  claude:{formatBytes(systemSummary.claudeMemoryBytes)}</span>
              <Popover
                trigger="click"
                placement="topLeft"
                open={claudeCountPopoverOpen}
                onOpenChange={(nextOpen) => {
                  setClaudeCountPopoverOpen(nextOpen);
                  if (!nextOpen) setClaudeSystemSessionSearch("");
                }}
                overlayClassName="app-monitor-panel__history-popover"
                content={
                  <HistorySessionPopoverContent
                    searchValue={claudeSystemSessionSearch}
                    onSearchChange={setClaudeSystemSessionSearch}
                    rows={matchedSystemInlineSessions.map((session) => ({ session }))}
                    emptyDescription={
                      claudeSystemSessionSearch.trim() ? "未找到匹配会话" : "暂无运行中的会话"
                    }
                    onSelectSession={(sessionId) => {
                      setClaudeCountPopoverOpen(false);
                      setClaudeSystemSessionSearch("");
                      setSystemSessionDrawerId(sessionId);
                    }}
                    searchPlaceholder="搜索会话..."
                  />
                }
              >
                <span
                  className="app-left-sidebar-system-inline__count-trigger"
                  role="button"
                  tabIndex={0}
                  aria-label="查看正在运行中的 Claude Code 会话列表"
                  onClick={(event) => event.stopPropagation()}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      setClaudeCountPopoverOpen(true);
                    }
                  }}
                >
                  {"  数量:"}
                  {systemInlineRunningSessionsCombined.length}
                </span>
              </Popover>
            </>
          )}
      </div>

      <Drawer
        title={systemSessionDrawerTitle}
        open={systemSessionDrawerId !== null}
        onClose={() => setSystemSessionDrawerId(null)}
        placement="right"
        destroyOnClose
        width={systemSessionDrawerWidth}
        classNames={{ body: "app-monitor-panel__history-session-drawer-body" }}
        extra={
          liveSystemDrawerSession ? (
            <Space size="small" wrap align="center">
              <Tag color={historySessionStatusTagColor(liveSystemDrawerSession.status)}>
                {historySessionStatusLabel(liveSystemDrawerSession.status)}
              </Tag>
              {canStopSystemDrawerSession && onCancelSessionFromMonitor ? (
                <Button
                  size="small"
                  danger
                  onClick={() => {
                    onCancelSessionFromMonitor(liveSystemDrawerSession.id);
                  }}
                >
                  停止
                </Button>
              ) : null}
            </Space>
          ) : drawerRegistryOrphanSid ? (
            <Space size="small" wrap align="center">
              <Tag color="processing">运行中</Tag>
              <Button
                size="small"
                danger
                onClick={() => {
                  void cancelClaudeExecution(drawerRegistryOrphanSid).then(
                    () => {
                      message.success("已请求终止该进程");
                      setSystemSessionDrawerId(null);
                    },
                    (err: unknown) => {
                      message.error(err instanceof Error ? err.message : "终止失败");
                    },
                  );
                }}
              >
                停止
              </Button>
            </Space>
          ) : null
        }
      >
        {liveSystemDrawerSession ? (
          <div className="app-monitor-panel__history-session-drawer-scroll">
            <ClaudeSessionMessagesColumn
              session={liveSystemDrawerSession}
              onOpenTaskDetail={onOpenTaskDetailFromMonitor}
              showAllMessages
            />
          </div>
        ) : drawerRegistryOrphanSid ? (
          <div className="app-monitor-panel__history-session-drawer-scroll">
            <Typography.Paragraph type="secondary" style={{ marginBottom: 12 }}>
              该进程在系统注册表中为运行状态，但未与 Wise 侧栏中的会话标签绑定；可直接终止进程，或在终端侧确认是否为预期中的 Claude Code。
            </Typography.Paragraph>
            {drawerRegistryOrphanInfo ? (
              <>
                <Typography.Paragraph>
                  <Typography.Text strong>模型</Typography.Text> {drawerRegistryOrphanInfo.model.trim() || "—"}
                </Typography.Paragraph>
                <Typography.Paragraph copyable={{ text: drawerRegistryOrphanInfo.project_path }}>
                  <Typography.Text strong>项目路径</Typography.Text>{" "}
                  {drawerRegistryOrphanInfo.project_path.trim() || "—"}
                </Typography.Paragraph>
              </>
            ) : null}
            <Typography.Paragraph copyable={{ text: drawerRegistryOrphanSid }}>
              <Typography.Text strong>Claude 会话 ID</Typography.Text> {drawerRegistryOrphanSid}
            </Typography.Paragraph>
            {!drawerRegistryOrphanInfo ? (
              <Typography.Paragraph type="secondary">
                注册表中暂无该条目的最新信息（可能已结束或已刷新）。
              </Typography.Paragraph>
            ) : null}
          </div>
        ) : (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="未找到该会话" />
        )}
      </Drawer>

      <Modal
        title="新建项目"
        open={createProjectOpen}
        onCancel={() => {
          setCreateProjectOpen(false);
          setProjectNameInput("");
        }}
        onOk={submitCreateProject}
        okText="创建"
        cancelText="取消"
      >
        <Input
          value={projectNameInput}
          onChange={(e) => setProjectNameInput(e.target.value)}
          placeholder="请输入项目名称"
          onPressEnter={submitCreateProject}
        />
      </Modal>

      <Modal
        title="重命名项目"
        open={Boolean(editProject)}
        onCancel={() => {
          setEditProject(null);
          setProjectNameInput("");
        }}
        onOk={submitUpdateProject}
        okText="保存"
        cancelText="取消"
      >
        <Input
          value={projectNameInput}
          onChange={(e) => setProjectNameInput(e.target.value)}
          placeholder="请输入新的项目名称"
          onPressEnter={submitUpdateProject}
        />
      </Modal>
      <Modal
        title="关联仓库"
        open={Boolean(pendingAddRepositoryProjectId)}
        onCancel={() => setPendingAddRepositoryProjectId(null)}
        onOk={submitAddRepository}
        okText="继续选择仓库目录"
        cancelText="取消"
        width={400}
      >
        <Space direction="vertical" size={8} style={{ width: "100%" }}>
          <div>
            <div className="app-add-repo-field-label">角标与自定义角色标签</div>
            <Select
              className="app-add-repository-badge-select"
              size="small"
              classNames={{ popup: { root: "app-add-repo-select-dropdown" } }}
              popupMatchSelectWidth
              optionLabelProp="title"
              value={associateSelectValue}
              onChange={(value) => {
                const v = String(value);
                if (v === "frontend" || v === "backend" || v === "document") {
                  setAssociateSelectValue(v);
                  setNewRepositoryType(v);
                  setNewRepositoryDisplayName("");
                  setNewRepositoryIconColor(null);
                  return;
                }
                if (isCustomPresetSelectValue(v)) {
                  const id = v.slice("custom:".length);
                  const preset = repositoryAssociatePresets.find((p) => p.id === id);
                  if (!preset) return;
                  setAssociateSelectValue(v);
                  setNewRepositoryType(preset.repositoryType);
                  setNewRepositoryDisplayName(preset.iconDisplayName);
                  setNewRepositoryIconColor(preset.iconColor ?? null);
                }
              }}
              options={associateRepositoryDropdownOptions}
              popupRender={(menu) => (
                <div className="app-add-repo-select-popup">
                  {menu}
                  <div className="app-add-repo-select-popup-extra" onMouseDown={(e) => e.preventDefault()}>
                    <Divider className="app-add-repo-select-popup-divider" />
                    <div className="app-add-repo-field-label">角标颜色</div>
                    <div className="app-add-repo-icon-swatches">
                      <Tooltip title="与该角色标签的默认角标色一致" mouseEnterDelay={0.25}>
                        <button
                          type="button"
                          className={`app-add-repo-icon-swatch app-add-repo-icon-swatch--follow${newRepositoryIconColor === null ? " app-add-repo-icon-swatch--selected" : ""}`}
                          aria-label="角标颜色与角色标签默认色一致"
                          onClick={() => setNewRepositoryIconColor(null)}
                        />
                      </Tooltip>
                      {REPOSITORY_ICON_COLOR_PRESETS.map((hex) => (
                        <Tooltip key={hex} title={hex} mouseEnterDelay={0.2}>
                          <button
                            type="button"
                            className={`app-add-repo-icon-swatch${newRepositoryIconColor === hex ? " app-add-repo-icon-swatch--selected" : ""}`}
                            aria-label={`角标颜色 ${hex}`}
                            style={{ backgroundColor: hex }}
                            onClick={() => setNewRepositoryIconColor(hex)}
                          />
                        </Tooltip>
                      ))}
                    </div>
                    <div className="app-add-repo-field-label app-add-repo-field-label--spaced">角标标题</div>
                    <Input
                      size="small"
                      value={newRepositoryDisplayName}
                      onChange={(e) => setNewRepositoryDisplayName(e.target.value)}
                      placeholder="留空则角标内仅显示角色默认文案（前/后/文）"
                      allowClear
                    />
                    <Button
                      type="default"
                      size="small"
                      block
                      className="app-add-repo-preset-add-btn"
                      onClick={() => void handleAddAssociatePreset()}
                    >
                      将当前配置加入常用选项
                    </Button>
                  </div>
                </div>
              )}
              style={{ width: "100%" }}
            />
          </div>
        </Space>
      </Modal>
      <AppSettingsModal open={appSettingsOpen} onClose={() => setAppSettingsOpen(false)} />
    </Layout.Sider>
  );
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0MB";
  const gb = bytes / (1024 * 1024 * 1024);
  if (gb >= 1) return `${gb.toFixed(2)}GB`;
  const mb = bytes / (1024 * 1024);
  return `${mb.toFixed(0)}MB`;
}

