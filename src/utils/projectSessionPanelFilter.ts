import type { ClaudeSession, ProjectItem, Repository } from "../types";
import { resolveProjectMainSessionAnchor } from "./projectSessionAnchor";
import {
  isProjectRootSessionDisplayName,
  normalizeRepositoryPathKey,
} from "./repositoryMainSessionBinding";
import { extractBoundEmployeeNameFromDisplay } from "./sessionOwnerHints";
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

  const memberRepoKeys = new Set(
    project.repositoryIds
      .map((id) => repositories.find((item) => item.id === id))
      .filter((repo): repo is Repository => Boolean(repo))
      .map((repo) => normalizeRepositoryPathKey(repo.path))
      .filter((key) => key.length > 0),
  );

  return sessions.filter((session) => {
    if (extractBoundEmployeeNameFromDisplay(session.repositoryName ?? "")) {
      return false;
    }
    const sessionKey = normalizeRepositoryPathKey(session.repositoryPath);
    if (sessionKey !== anchorKey) {
      return false;
    }
    const displayName = (session.repositoryName ?? "").trim();
    const anchorPathIsMemberRepo = memberRepoKeys.has(sessionKey);
    if (anchor.isProjectRooted && !anchorPathIsMemberRepo) {
      return true;
    }
    return (
      isProjectRootSessionDisplayName(displayName) ||
      displayName === anchor.displayName.trim()
    );
  });
}

/** 单条会话是否属于工作区焦点下的项目主会话视图（与 `filterSessionsForWorkspace` project 分支一致）。 */
export function sessionMatchesProjectWorkspaceFocus(
  session: ClaudeSession,
  input: Omit<FilterSessionsForWorkspaceInput, "sessions">,
): boolean {
  if (!input.project) {
    return false;
  }
  return filterSessionsForWorkspace({
    ...input,
    sessions: [session],
    activeWorkspaceFocus: "project",
  }).length > 0;
}
