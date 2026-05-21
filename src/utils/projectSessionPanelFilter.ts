import type { ClaudeSession, ProjectItem, Repository } from "../types";
import { resolveProjectMainSessionAnchor } from "./projectSessionAnchor";
import {
  isProjectRootSessionDisplayName,
  normalizeRepositoryPathKey,
} from "./repositoryMainSessionBinding";
import type { WorkspaceFocus, WorkspaceMode } from "./workspaceMode";

export interface FilterSessionsForWorkspaceInput {
  sessions: ReadonlyArray<ClaudeSession>;
  workspaceMode: WorkspaceMode;
  /** 当前 active 的项目；缺失时视为 floating repo，透传列表。 */
  project: ProjectItem | null;
  repositories: ReadonlyArray<Repository>;
  /** 点项目行 → 只列项目主会话；点仓库行 → 只列该仓会话。 */
  activeWorkspaceFocus?: WorkspaceFocus;
  activeRepositoryId?: number | null;
}

/**
 * ClaudeSessions 面板可见会话过滤器。
 *
 * - 有 active project + `activeWorkspaceFocus === "project"` → 项目 anchor.path 上的主会话
 * - 有 active project + `activeWorkspaceFocus === "repository"` → 当前 active 仓库 path 上的会话
 * - 无 active project → floating repo，透传原列表
 */
export function filterSessionsForWorkspace(
  input: FilterSessionsForWorkspaceInput,
): ClaudeSession[] {
  const {
    sessions,
    project,
    repositories,
    activeWorkspaceFocus = "repository",
    activeRepositoryId = null,
  } = input;

  if (!project) {
    return [...sessions];
  }

  if (activeWorkspaceFocus === "repository") {
    const repo =
      activeRepositoryId != null
        ? repositories.find((item) => item.id === activeRepositoryId)
        : null;
    const repoKey = repo ? normalizeRepositoryPathKey(repo.path) : "";
    if (!repoKey) {
      return [...sessions];
    }
    return sessions.filter((session) => {
      if (normalizeRepositoryPathKey(session.repositoryPath) !== repoKey) {
        return false;
      }
      return !isProjectRootSessionDisplayName(session.repositoryName ?? "");
    });
  }

  const anchor = resolveProjectMainSessionAnchor(project, repositories);
  const anchorKey = normalizeRepositoryPathKey(anchor.path);
  if (!anchorKey) {
    return [...sessions];
  }
  return sessions.filter(
    (session) =>
      normalizeRepositoryPathKey(session.repositoryPath) === anchorKey &&
      isProjectRootSessionDisplayName(session.repositoryName ?? ""),
  );
}
