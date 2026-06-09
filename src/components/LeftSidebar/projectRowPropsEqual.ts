import type { RepositoryRunCommandRowPinnedMap } from "../../services/repositoryRunCommandRowActionPreference";
import type { Repository, Workspace } from "../../types";
import type { WorkspaceFocus } from "../../utils/workspaceMode";
import {
  sumProjectScheduledTasksEnabled,
  sumProjectScheduledTasksTotal,
  type SidebarScheduledTasksSummary,
} from "./useSidebarScheduledTasksMap";

export type ProjectRowEqualProps = {
  project: Workspace;
  projectRepos: Repository[];
  isActiveProject: boolean;
  activeRepositoryId: number | null;
  activeWorkspaceFocus: WorkspaceFocus;
  isPinned: boolean;
  expanded: boolean;
  projectDropTargetId: string | null;
  projectTrellisReadyById?: Record<string, boolean>;
  repositoryTrellisReadyById?: Record<number, boolean>;
  scheduledTasksByRepoId?: Record<number, SidebarScheduledTasksSummary>;
  requirementUnsplitByProjectId?: Record<string, number>;
  requirementUnsplitByRepoId?: Record<number, number>;
  executableTasksByProjectId?: Record<string, number>;
  executableTasksByRepoId?: Record<number, number>;
  workspaceTodosEnabled?: boolean;
  mainSessionRunning?: boolean;
  runningMainSessionByRepositoryId?: Record<number, boolean>;
  runCommandRowPinnedMap?: RepositoryRunCommandRowPinnedMap;
};

function repositoryRowFingerprint(repos: readonly Repository[]): string {
  return repos
    .map(
      (repo) =>
        [
          repo.id,
          repo.path,
          repo.name,
          repo.mainOwnerAgentName ?? "",
          repo.openAppId ?? "",
          repo.sddMode ?? "",
        ].join(":"),
    )
    .join("|");
}

function projectRepositoryDerivedFingerprint(
  project: Workspace,
  props: Pick<
    ProjectRowEqualProps,
    | "repositoryTrellisReadyById"
    | "requirementUnsplitByRepoId"
    | "executableTasksByRepoId"
    | "runningMainSessionByRepositoryId"
    | "runCommandRowPinnedMap"
    | "scheduledTasksByRepoId"
  >,
): string {
  const parts: string[] = [];
  for (const repositoryId of project.repositoryIds) {
    parts.push(
      [
        repositoryId,
        props.repositoryTrellisReadyById?.[repositoryId] ? "1" : "0",
        props.requirementUnsplitByRepoId?.[repositoryId] ?? 0,
        props.executableTasksByRepoId?.[repositoryId] ?? 0,
        props.runningMainSessionByRepositoryId?.[repositoryId] ? "1" : "0",
        props.runCommandRowPinnedMap?.[repositoryId] ? "1" : "0",
        props.scheduledTasksByRepoId?.[repositoryId]?.total ?? 0,
        props.scheduledTasksByRepoId?.[repositoryId]?.enabled ?? 0,
      ].join(":"),
    );
  }
  return parts.join("\n");
}

/** 工作区行 memo：仅比较影响该行 UI 的派生字段，忽略回调引用。 */
export function projectRowPropsEqual(
  prev: ProjectRowEqualProps,
  next: ProjectRowEqualProps,
): boolean {
  if (prev.project.id !== next.project.id) return false;
  if (prev.project !== next.project) {
    const a = prev.project;
    const b = next.project;
    if (
      a.name !== b.name ||
      a.sddMode !== b.sddMode ||
      a.openAppId !== b.openAppId ||
      a.repositoryIds.join(",") !== b.repositoryIds.join(",")
    ) {
      return false;
    }
  }
  if (repositoryRowFingerprint(prev.projectRepos) !== repositoryRowFingerprint(next.projectRepos)) {
    return false;
  }
  if (prev.isActiveProject !== next.isActiveProject) return false;
  if (prev.activeRepositoryId !== next.activeRepositoryId) return false;
  if (prev.activeWorkspaceFocus !== next.activeWorkspaceFocus) return false;
  if (prev.isPinned !== next.isPinned) return false;
  if (prev.expanded !== next.expanded) return false;
  if (prev.projectDropTargetId !== next.projectDropTargetId) return false;
  if (prev.workspaceTodosEnabled !== next.workspaceTodosEnabled) return false;
  if (prev.mainSessionRunning !== next.mainSessionRunning) return false;
  if (
    (prev.projectTrellisReadyById?.[prev.project.id] ?? false) !==
    (next.projectTrellisReadyById?.[next.project.id] ?? false)
  ) {
    return false;
  }
  if (
    (prev.requirementUnsplitByProjectId?.[prev.project.id] ?? 0) !==
    (next.requirementUnsplitByProjectId?.[next.project.id] ?? 0)
  ) {
    return false;
  }
  if (
    (prev.executableTasksByProjectId?.[prev.project.id] ?? 0) !==
    (next.executableTasksByProjectId?.[next.project.id] ?? 0)
  ) {
    return false;
  }
  const prevScheduledEnabled = sumProjectScheduledTasksEnabled(
    prev.project.repositoryIds,
    prev.scheduledTasksByRepoId ?? {},
  );
  const nextScheduledEnabled = sumProjectScheduledTasksEnabled(
    next.project.repositoryIds,
    next.scheduledTasksByRepoId ?? {},
  );
  if (prevScheduledEnabled !== nextScheduledEnabled) return false;
  const prevScheduledTotal = sumProjectScheduledTasksTotal(
    prev.project.repositoryIds,
    prev.scheduledTasksByRepoId ?? {},
  );
  const nextScheduledTotal = sumProjectScheduledTasksTotal(
    next.project.repositoryIds,
    next.scheduledTasksByRepoId ?? {},
  );
  if (prevScheduledTotal !== nextScheduledTotal) return false;
  if (
    projectRepositoryDerivedFingerprint(prev.project, prev) !==
    projectRepositoryDerivedFingerprint(next.project, next)
  ) {
    return false;
  }
  return true;
}
