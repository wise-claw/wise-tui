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
  /** 当前 active 的项目；workspaceMode === "multi_repo" 时必须给出，否则视为退化。 */
  project: ProjectItem | null;
  repositories: ReadonlyArray<Repository>;
  /** 多仓时：点项目行 → 只列项目主会话；点仓库行 → 只列该仓会话。 */
  activeWorkspaceFocus?: WorkspaceFocus;
  activeRepositoryId?: number | null;
}

/**
 * ClaudeSessions 面板可见会话过滤器。
 *
 * - `multi_repo` + `activeWorkspaceFocus === "project"` → 项目 anchor.path 上的会话
 * - `multi_repo` + `activeWorkspaceFocus === "repository"` → 当前 active 仓库 path 上的会话
 * - 其余形态 → 透传原列表
 */
export function filterSessionsForWorkspace(
  input: FilterSessionsForWorkspaceInput,
): ClaudeSession[] {
  const {
    sessions,
    workspaceMode,
    project,
    repositories,
    activeWorkspaceFocus = "repository",
    activeRepositoryId = null,
  } = input;

  if (workspaceMode === "single_repo" || !project) {
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

  return sessions.filter((session) => isProjectRootSessionDisplayName(session.repositoryName ?? ""));
}
