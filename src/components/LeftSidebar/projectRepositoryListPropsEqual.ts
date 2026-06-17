import type { Repository } from "../../types";
import type { ProjectRepositoryListProps } from "./ProjectRepositoryList";

export type ProjectRepositoryListEqualProps = Pick<
  ProjectRepositoryListProps,
  | "projects"
  | "floatingRepositories"
  | "activeProjectId"
  | "activeWorkspaceFocus"
  | "activeRepositoryId"
  | "showRepositoryIconBadgesInWorkspaceList"
  | "pinnedProjectIds"
  | "expandedProjects"
  | "projectDropTargetId"
  | "projectTrellisReadyById"
  | "repositoryTrellisReadyById"
  | "scheduledTasksByRepoId"
  | "requirementUnsplitByProjectId"
  | "requirementUnsplitByRepoId"
  | "executableTasksByProjectId"
  | "executableTasksByRepoId"
  | "workspaceTodosEnabled"
  | "runningMainSessionByProjectId"
  | "runningMainSessionByRepositoryId"
  | "sectionCollapsed"
> & {
  repositoriesById: Map<number, Repository>;
};

function expandedProjectsFingerprint(expandedProjects: Set<string>): string {
  if (expandedProjects.size === 0) return "";
  return [...expandedProjects].sort().join("\n");
}

function repositoriesByIdFingerprint(repositoriesById: Map<number, Repository>): string {
  const parts: string[] = [];
  for (const [id, repo] of repositoriesById) {
    parts.push(
      [
        id,
        repo.path,
        repo.name,
        repo.sddMode ?? "",
        repo.openAppId ?? "",
        repo.mainOwnerAgentName ?? "",
      ].join(":"),
    );
  }
  parts.sort();
  return parts.join("|");
}

function recordNumberFingerprint(record: Record<string, number> | undefined): string {
  if (!record) return "";
  return Object.keys(record)
    .sort()
    .map((key) => `${key}:${record[key] ?? 0}`)
    .join("\n");
}

function recordNumberRepoFingerprint(record: Record<number, number> | undefined): string {
  if (!record) return "";
  return Object.keys(record)
    .sort((a, b) => Number(a) - Number(b))
    .map((key) => `${key}:${record[Number(key)] ?? 0}`)
    .join("\n");
}

function recordBooleanFingerprint(record: Record<string, boolean> | undefined): string {
  if (!record) return "";
  return Object.keys(record)
    .sort()
    .map((key) => `${key}:${record[key] ? 1 : 0}`)
    .join("\n");
}

function recordBooleanRepoFingerprint(record: Record<number, boolean> | undefined): string {
  if (!record) return "";
  return Object.keys(record)
    .sort((a, b) => Number(a) - Number(b))
    .map((key) => `${key}:${record[Number(key)] ? 1 : 0}`)
    .join("\n");
}

function scheduledTasksFingerprint(
  record: ProjectRepositoryListEqualProps["scheduledTasksByRepoId"],
): string {
  if (!record) return "";
  return Object.keys(record)
    .sort((a, b) => Number(a) - Number(b))
    .map((key) => {
      const id = Number(key);
      const item = record[id];
      return `${id}:${item?.total ?? 0}:${item?.enabled ?? 0}`;
    })
    .join("\n");
}

/** 工作区列表 memo：忽略回调引用；会话切换等不相关父级更新时跳过重渲染。 */
export function projectRepositoryListPropsEqual(
  prev: ProjectRepositoryListEqualProps,
  next: ProjectRepositoryListEqualProps,
): boolean {
  if (prev === next) return true;
  if (prev.projects !== next.projects) return false;
  if (prev.floatingRepositories !== next.floatingRepositories) return false;
  if (prev.activeProjectId !== next.activeProjectId) return false;
  if (prev.activeWorkspaceFocus !== next.activeWorkspaceFocus) return false;
  if (prev.activeRepositoryId !== next.activeRepositoryId) return false;
  if (prev.showRepositoryIconBadgesInWorkspaceList !== next.showRepositoryIconBadgesInWorkspaceList) {
    return false;
  }
  if (prev.pinnedProjectIds !== next.pinnedProjectIds) return false;
  if (prev.projectDropTargetId !== next.projectDropTargetId) return false;
  if (prev.workspaceTodosEnabled !== next.workspaceTodosEnabled) return false;
  if (prev.sectionCollapsed !== next.sectionCollapsed) return false;
  if (
    expandedProjectsFingerprint(prev.expandedProjects) !==
    expandedProjectsFingerprint(next.expandedProjects)
  ) {
    return false;
  }
  if (
    repositoriesByIdFingerprint(prev.repositoriesById) !==
    repositoriesByIdFingerprint(next.repositoriesById)
  ) {
    return false;
  }
  if (
    recordBooleanFingerprint(prev.projectTrellisReadyById) !==
    recordBooleanFingerprint(next.projectTrellisReadyById)
  ) {
    return false;
  }
  if (
    recordBooleanRepoFingerprint(prev.repositoryTrellisReadyById) !==
    recordBooleanRepoFingerprint(next.repositoryTrellisReadyById)
  ) {
    return false;
  }
  if (scheduledTasksFingerprint(prev.scheduledTasksByRepoId) !== scheduledTasksFingerprint(next.scheduledTasksByRepoId)) {
    return false;
  }
  if (
    recordNumberFingerprint(prev.requirementUnsplitByProjectId) !==
    recordNumberFingerprint(next.requirementUnsplitByProjectId)
  ) {
    return false;
  }
  if (
    recordNumberRepoFingerprint(prev.requirementUnsplitByRepoId) !==
    recordNumberRepoFingerprint(next.requirementUnsplitByRepoId)
  ) {
    return false;
  }
  if (
    recordNumberFingerprint(prev.executableTasksByProjectId) !==
    recordNumberFingerprint(next.executableTasksByProjectId)
  ) {
    return false;
  }
  if (
    recordNumberRepoFingerprint(prev.executableTasksByRepoId) !==
    recordNumberRepoFingerprint(next.executableTasksByRepoId)
  ) {
    return false;
  }
  if (
    recordBooleanFingerprint(prev.runningMainSessionByProjectId) !==
    recordBooleanFingerprint(next.runningMainSessionByProjectId)
  ) {
    return false;
  }
  if (
    recordBooleanRepoFingerprint(prev.runningMainSessionByRepositoryId) !==
    recordBooleanRepoFingerprint(next.runningMainSessionByRepositoryId)
  ) {
    return false;
  }
  return true;
}
