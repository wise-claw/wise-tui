import { memo, type RefObject, useCallback, useEffect, useState } from "react";
import type { ClaudeHostProcess, ClaudeSession, Repository, StandaloneRepo, TaskMode, Workspace } from "../../types";
import type { ProjectItem } from "../../types";
import type { ReconcileProjectMode } from "../../constants/reconcileProjectMode";
import type { WorkspaceFocus } from "../../utils/workspaceMode";
import { resolveScheduledTasksRepository } from "../../utils/workspaceSelectionState";
import { ProjectRepositoryList } from "./ProjectRepositoryList";
import { SidebarWorkspaceTodoAddModal } from "./SidebarWorkspaceTodoAddModal";
import { useProjectRepositorySidebarState } from "./useProjectRepositorySidebarState";
import { useSidebarScheduledTasksMap } from "./useSidebarScheduledTasksMap";
import { useSidebarRunningMainSessionIndicators } from "./useSidebarRunningMainSessionIndicators";
import { useRepositoryActionShortcuts } from "../../hooks/useRepositoryActionShortcuts";
import {
  loadOpenInTerminalShortcutFromStore,
  loadOpenInEditorShortcutFromStore,
  WISE_OPEN_IN_TERMINAL_SHORTCUT_CHANGED,
  WISE_OPEN_IN_EDITOR_SHORTCUT_CHANGED,
} from "../../services/wiseDefaultConfigStore";

export type LeftSidebarWorkspaceListSlotProps = {
  showLeftSidebarWorkspaceList: boolean;
  workspaceTodosEnabled: boolean;
  projects: Workspace[];
  repositories: Repository[];
  floatingRepositories: StandaloneRepo[];
  activeProjectId: string | null;
  activeWorkspaceFocus: WorkspaceFocus;
  activeRepositoryId: number | null;
  showRepositoryIconBadgesInWorkspaceList: boolean;
  pinnedProjectIds: string[];
  sectionCollapsed: boolean;
  onSectionCollapsedChange?: (collapsed: boolean) => void;
  sessionsStructureKey: string;
  sessionsRef: RefObject<readonly ClaudeSession[]>;
  repositoryMainSessionBindings: Record<string, string>;
  claudeProcesses: ReadonlyArray<ClaudeHostProcess>;
  claudeProcessFingerprint: string;
  claudeRegistryRunningFingerprint: string;
  registryRunningClaudeSessionIds?: ReadonlySet<string>;
  onMoveRepositoryToProject?: (targetProjectId: string, repositoryId: number) => void | Promise<void>;
  onProjectSelect: (projectId: Workspace["id"]) => void;
  onRepositorySelect: (id: number | null) => void;
  onCreateProjectClick: () => void;
  onAddFloatingRepositoryClick?: () => void;
  onAddRepositoryToProjectClick?: (projectId: Workspace["id"]) => void;
  onReconcileProject?: (projectId: string, mode: ReconcileProjectMode) => void | Promise<void>;
  onTogglePinProject: (projectId: string) => void;
  onRenameProject: (project: Workspace) => void;
  onDeleteProject: (project: Workspace) => void;
  onOpenPromptsProject?: (project: Workspace) => void;
  onCreateProjectTask: (project: Workspace, mode: TaskMode) => void;
  onOpenWorkspaceRequirements?: (project: Workspace) => void;
  onOpenRepositoryRequirements?: (repository: Repository) => void;
  onOpenInFinder: (repository: Repository) => void;
  onOpenProjectInFinder?: (project: Workspace) => void;
  onOpenInTerminal?: (repository: Repository) => void;
  onOpenProjectInTerminal?: (project: Workspace) => void;
  onOpenRepositoryInBrowser: (repository: Repository) => void;
  openRepositoryInPreferredEditor: (repository: Repository) => void;
  openProjectInPreferredEditor?: (project: Workspace) => void;
  onOpenPromptsRepository?: (project: Workspace, repository: Repository) => void;
  onOpenRepositoryMainOwner?: (repository: Repository) => void;
  onConfigureRepositoryMainSessionRun?: (repository: Repository) => void;
  onStartRepositoryRunCommand?: (repository: Repository) => void;
  onStopRepositoryRunCommand?: (repository: Repository) => void;
  onConfigureRepositorySddMode?: (repository: Repository) => void;
  onConfigureRepositoryIconBadge?: (repository: Repository) => void;
  onConfigureProjectSddMode?: (project: Workspace) => void;
  onConfigureRepositoryOpenApp?: (repository: Repository, openAppId: string | null) => void;
  onConfigureProjectOpenApp?: (project: Workspace, openAppId: string | null) => void;
  onNewPaneSessionForRepository?: (repository: Repository) => void;
  onNewPaneSessionForProject?: (project: Workspace) => void;
  onPromoteFloatingRepository?: (repository: StandaloneRepo) => void;
  onRemoveFloatingRepository: (repository: StandaloneRepo) => void;
  onDetachRepositoryFromProject: (projectId: string, repositoryId: number) => void;
  onReorderRepositoriesInProject?: (projectId: string, repositoryIds: number[]) => void | Promise<void>;
  onMoveRepositoryError: (message: string, err: unknown) => void;
  onOpenGlobalWorkspaceTodoAdd?: () => void;
  onOpenScheduledTasksForRepository?: (repository: Repository) => void;
  onOpenScheduledTasksForProject?: (project: Workspace) => void;
  onOpenExecutableTasksForProject?: (project: Workspace) => void;
  onOpenExecutableTasksForRepository?: (repository: Repository) => void;
  onStopProjectMainSession?: (projectId: string) => void;
  onStopRepositoryMainSession?: (repository: Repository) => void;
};

function LeftSidebarWorkspaceListSlotInner(props: LeftSidebarWorkspaceListSlotProps) {
  const projectRepositoryState = useProjectRepositorySidebarState({
    projects: props.projects,
    repositories: props.repositories,
    activeProjectId: props.activeProjectId,
    activeRepositoryId: props.activeRepositoryId,
    activeWorkspaceFocus: props.activeWorkspaceFocus,
    onMoveRepositoryToProject: props.onMoveRepositoryToProject,
  });
  const { byId: scheduledTasksByRepoId } = useSidebarScheduledTasksMap(props.repositories);

  // ── 仓库操作快捷键（打开终端 / 编辑器） ──
  const [terminalShortcut, setTerminalShortcut] = useState("");
  const [editorShortcut, setEditorShortcut] = useState("");

  useEffect(() => {
    void loadOpenInTerminalShortcutFromStore().then(setTerminalShortcut);
    void loadOpenInEditorShortcutFromStore().then(setEditorShortcut);
  }, []);

  useEffect(() => {
    const onTerminalChanged = (event: Event) => {
      const { chord } = (event as CustomEvent<{ chord: string }>).detail;
      setTerminalShortcut(chord);
    };
    const onEditorChanged = (event: Event) => {
      const { chord } = (event as CustomEvent<{ chord: string }>).detail;
      setEditorShortcut(chord);
    };
    window.addEventListener(WISE_OPEN_IN_TERMINAL_SHORTCUT_CHANGED, onTerminalChanged as EventListener);
    window.addEventListener(WISE_OPEN_IN_EDITOR_SHORTCUT_CHANGED, onEditorChanged as EventListener);
    return () => {
      window.removeEventListener(WISE_OPEN_IN_TERMINAL_SHORTCUT_CHANGED, onTerminalChanged as EventListener);
      window.removeEventListener(WISE_OPEN_IN_EDITOR_SHORTCUT_CHANGED, onEditorChanged as EventListener);
    };
  }, []);

  useRepositoryActionShortcuts({
    terminalShortcut,
    editorShortcut,
    activeRepositoryId: props.activeRepositoryId,
    repositoriesById: projectRepositoryState.repositoriesById,
    onOpenInTerminal: props.onOpenInTerminal,
    openRepositoryInPreferredEditor: props.openRepositoryInPreferredEditor,
  });
  const requirementUnsplitByProjectId: Record<string, number> = {};
  const requirementUnsplitByRepoId: Record<number, number> = {};
  const executableTasksByProjectId: Record<string, number> = {};
  const executableTasksByRepoId: Record<number, number> = {};
  const projectTrellisReadyById: Record<string, boolean> = {};
  const repositoryTrellisReadyById: Record<number, boolean> = {};
  const { runningByProjectId, runningByRepositoryId } = useSidebarRunningMainSessionIndicators({
    projects: props.projects,
    repositories: props.repositories,
    sessionsRef: props.sessionsRef,
    sessionsStructureKey: props.sessionsStructureKey,
    repositoryMainSessionBindings: props.repositoryMainSessionBindings,
    claudeProcesses: props.claudeProcesses,
    registryRunningClaudeSessionIds: props.registryRunningClaudeSessionIds,
  });

  const openScheduledTasksForProject = useCallback(
    (project: ProjectItem) => {
      if (props.onOpenScheduledTasksForProject) {
        props.onOpenScheduledTasksForProject(project);
        return;
      }
      const target = resolveScheduledTasksRepository({
        activeRepository: null,
        activeProject: project,
        activeWorkspaceFocus: "project",
        repositories: props.repositories,
        scheduledTasksByRepoId,
      });
      if (target) {
        props.onOpenScheduledTasksForRepository?.(target);
      }
    },
    [
      props.onOpenScheduledTasksForProject,
      props.onOpenScheduledTasksForRepository,
      props.repositories,
      scheduledTasksByRepoId,
    ],
  );

  return (
    <>
      <SidebarWorkspaceTodoAddModal enabled={props.workspaceTodosEnabled} />
      {props.showLeftSidebarWorkspaceList ? (
        <ProjectRepositoryList
          projects={props.projects}
          repositoriesById={projectRepositoryState.repositoriesById}
          floatingRepositories={props.floatingRepositories}
          activeProjectId={props.activeProjectId}
          activeWorkspaceFocus={props.activeWorkspaceFocus}
          activeRepositoryId={props.activeRepositoryId}
          showRepositoryIconBadgesInWorkspaceList={props.showRepositoryIconBadgesInWorkspaceList}
          pinnedProjectIds={props.pinnedProjectIds}
          expandedProjects={projectRepositoryState.expandedProjects}
          projectDropTargetId={projectRepositoryState.projectDropTargetId}
          repoSidebarDragRef={projectRepositoryState.repoSidebarDragRef}
          onProjectSelect={props.onProjectSelect}
          onRepositorySelect={props.onRepositorySelect}
          onCreateProjectClick={props.onCreateProjectClick}
          onAddFloatingRepositoryClick={props.onAddFloatingRepositoryClick}
          onAddRepositoryToProjectClick={props.onAddRepositoryToProjectClick}
          onReconcileProject={props.onReconcileProject}
          projectTrellisReadyById={projectTrellisReadyById}
          repositoryTrellisReadyById={repositoryTrellisReadyById}
          onToggleProjectExpand={projectRepositoryState.toggleProjectExpand}
          onTogglePinProject={props.onTogglePinProject}
          onRenameProject={props.onRenameProject}
          onDeleteProject={props.onDeleteProject}
          onOpenPromptsProject={props.onOpenPromptsProject}
          onCreateProjectTask={props.onCreateProjectTask}
          onOpenWorkspaceRequirements={props.onOpenWorkspaceRequirements}
          onOpenRepositoryRequirements={props.onOpenRepositoryRequirements}
          onOpenInFinder={props.onOpenInFinder}
          onOpenProjectInFinder={props.onOpenProjectInFinder}
          onOpenInTerminal={props.onOpenInTerminal}
          onOpenProjectInTerminal={props.onOpenProjectInTerminal}
          onOpenRepositoryInBrowser={props.onOpenRepositoryInBrowser}
          openRepositoryInPreferredEditor={props.openRepositoryInPreferredEditor}
          openProjectInPreferredEditor={props.openProjectInPreferredEditor}
          onOpenPromptsRepository={props.onOpenPromptsRepository}
          onOpenRepositoryMainOwner={props.onOpenRepositoryMainOwner}
          onConfigureRepositoryMainSessionRun={props.onConfigureRepositoryMainSessionRun}
          onStartRepositoryRunCommand={props.onStartRepositoryRunCommand}
          onStopRepositoryRunCommand={props.onStopRepositoryRunCommand}
          onConfigureRepositorySddMode={props.onConfigureRepositorySddMode}
          onConfigureRepositoryIconBadge={props.onConfigureRepositoryIconBadge}
          onConfigureProjectSddMode={props.onConfigureProjectSddMode}
          onConfigureRepositoryOpenApp={props.onConfigureRepositoryOpenApp}
          onConfigureProjectOpenApp={props.onConfigureProjectOpenApp}
          onNewPaneSessionForRepository={props.onNewPaneSessionForRepository}
          onNewPaneSessionForProject={props.onNewPaneSessionForProject}
          onPromoteFloatingRepository={props.onPromoteFloatingRepository}
          onJoinFloatingRepository={undefined}
          onRemoveFloatingRepository={props.onRemoveFloatingRepository}
          onDetachRepositoryFromProject={props.onDetachRepositoryFromProject}
          onReorderRepositoriesInProject={props.onReorderRepositoriesInProject}
          onMoveRepositoryToProject={undefined}
          onMoveRepositoryToProjectWithExpand={projectRepositoryState.moveRepositoryWithExpand}
          onProjectDropTargetChange={projectRepositoryState.setProjectDropTargetId}
          onClearRepoSidebarDrag={projectRepositoryState.clearRepoSidebarDrag}
          onMoveRepositoryError={props.onMoveRepositoryError}
          scheduledTasksByRepoId={scheduledTasksByRepoId}
          requirementUnsplitByProjectId={requirementUnsplitByProjectId}
          requirementUnsplitByRepoId={requirementUnsplitByRepoId}
          executableTasksByProjectId={executableTasksByProjectId}
          executableTasksByRepoId={executableTasksByRepoId}
          workspaceTodosEnabled={props.workspaceTodosEnabled}
          onOpenGlobalWorkspaceTodoAdd={props.onOpenGlobalWorkspaceTodoAdd}
          onOpenScheduledTasksForRepository={props.onOpenScheduledTasksForRepository}
          onOpenScheduledTasksForProject={openScheduledTasksForProject}
          onOpenExecutableTasksForProject={props.onOpenExecutableTasksForProject}
          onOpenExecutableTasksForRepository={props.onOpenExecutableTasksForRepository}
          runningMainSessionByProjectId={runningByProjectId}
          runningMainSessionByRepositoryId={runningByRepositoryId}
          onStopProjectMainSession={props.onStopProjectMainSession}
          onStopRepositoryMainSession={props.onStopRepositoryMainSession}
          sectionCollapsed={props.sectionCollapsed}
          onSectionCollapsedChange={props.onSectionCollapsedChange}
        />
      ) : null}
    </>
  );
}

export const LeftSidebarWorkspaceListSlot = memo(
  LeftSidebarWorkspaceListSlotInner,
  (prev, next) => {
    if (
      prev.projects !== next.projects ||
      prev.repositories !== next.repositories ||
      prev.floatingRepositories !== next.floatingRepositories ||
      prev.pinnedProjectIds !== next.pinnedProjectIds ||
      prev.workspaceTodosEnabled !== next.workspaceTodosEnabled
    ) {
      return false;
    }
    return (
      prev.showLeftSidebarWorkspaceList === next.showLeftSidebarWorkspaceList &&
      prev.activeProjectId === next.activeProjectId &&
      prev.activeWorkspaceFocus === next.activeWorkspaceFocus &&
      prev.activeRepositoryId === next.activeRepositoryId &&
      prev.showRepositoryIconBadgesInWorkspaceList === next.showRepositoryIconBadgesInWorkspaceList &&
      prev.sectionCollapsed === next.sectionCollapsed &&
      prev.sessionsStructureKey === next.sessionsStructureKey &&
      prev.repositoryMainSessionBindings === next.repositoryMainSessionBindings &&
      prev.claudeProcessFingerprint === next.claudeProcessFingerprint &&
      prev.claudeRegistryRunningFingerprint === next.claudeRegistryRunningFingerprint
    );
  },
);
