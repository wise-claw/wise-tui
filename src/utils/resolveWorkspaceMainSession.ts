import type { ClaudeSession, ProjectItem, Repository } from "../types";
import { resolveProjectMainSessionAnchor } from "./projectSessionAnchor";
import {
  pickProjectMainSessionForSidebarSelect,
  pickSessionForRepositorySidebarSelect,
} from "./claudeSessionSelection";
import {
  isProjectRootSessionDisplayName,
  normalizeRepositoryPathKey,
  projectMainSessionBindingKey,
  resolveBoundMainSessionId,
  resolveMainOwnerAgentNameForRepositoryPath,
  resolveRepositoryForSession,
  resolveRepositoryMainSessionId,
} from "./repositoryMainSessionBinding";
import { loadSessionOwnerHints } from "./sessionOwnerHints";
import type { WorkspaceFocus } from "./workspaceMode";

export interface ResolveWorkspaceMainSessionInput {
  sessions: readonly ClaudeSession[];
  bindings: Record<string, string>;
  repositories: readonly Repository[];
  activeRepository?: Repository | null;
  activeProject?: ProjectItem | null;
  activeWorkspaceFocus?: WorkspaceFocus;
  /** 当前活动标签；绑定/侧栏 pick 未命中时，若归属本仓库/项目则作为主会话 */
  activeSessionId?: string | null;
}

function fallbackActiveSessionForProject(
  list: ClaudeSession[],
  activeSessionId: string | null | undefined,
): ClaudeSession | null {
  if (!activeSessionId?.trim()) {
    return null;
  }
  const active = list.find((session) => session.id === activeSessionId);
  if (!active) {
    return null;
  }
  if (isProjectRootSessionDisplayName(active.repositoryName ?? "")) {
    return active;
  }
  return null;
}

function fallbackActiveSessionForRepository(
  list: ClaudeSession[],
  input: ResolveWorkspaceMainSessionInput,
): ClaudeSession | null {
  const { activeSessionId, activeRepository, repositories, bindings, sessions } = input;
  if (!activeSessionId?.trim() || !activeRepository) {
    return null;
  }
  const active = list.find((s) => s.id === activeSessionId);
  if (!active) {
    return null;
  }
  const resolved = resolveRepositoryForSession({
    session: active,
    repositories: [...repositories],
    bindings,
    sessions: [...sessions],
    preferredRepositoryId: activeRepository.id,
  });
  if (resolved?.id === activeRepository.id) {
    return active;
  }
  const repoKey = normalizeRepositoryPathKey(activeRepository.path);
  if (normalizeRepositoryPathKey(active.repositoryPath) === repoKey) {
    return active;
  }
  return null;
}

/**
 * 解析当前工作区上下文下的「主会话」：项目焦点用项目主会话绑定；仓库焦点用仓库主会话绑定（含项目根回退）。
 */
export function resolveWorkspaceMainSession(input: ResolveWorkspaceMainSessionInput): ClaudeSession | null {
  const {
    sessions,
    bindings,
    repositories,
    activeRepository,
    activeProject,
    activeWorkspaceFocus = "repository",
  } = input;
  const list = [...sessions];
  if (list.length === 0) {
    return null;
  }

  if (activeWorkspaceFocus === "project" && activeProject) {
    const boundId = resolveBoundMainSessionId(
      projectMainSessionBindingKey(activeProject.id),
      bindings,
      list,
      null,
    );
    if (boundId) {
      return list.find((s) => s.id === boundId) ?? null;
    }
    const anchor = resolveProjectMainSessionAnchor(activeProject, repositories);
    const anchorPath = normalizeRepositoryPathKey(anchor.path);
    const picked =
      pickProjectMainSessionForSidebarSelect(list, anchorPath, loadSessionOwnerHints()) ??
      pickSessionForRepositorySidebarSelect(list, anchorPath, loadSessionOwnerHints(), undefined);
    if (picked) {
      return picked;
    }
    return (
      fallbackActiveSessionForProject(list, input.activeSessionId) ??
      fallbackActiveSessionForRepository(list, input)
    );
  }

  if (!activeRepository) {
    return null;
  }

  const repoPathKey = normalizeRepositoryPathKey(activeRepository.path);
  const mainOwnerAgentName = resolveMainOwnerAgentNameForRepositoryPath(
    [...repositories],
    activeRepository.path,
  );
  const boundId = resolveRepositoryMainSessionId(
    activeRepository.path,
    bindings,
    list,
    mainOwnerAgentName,
  );
  if (boundId) {
    return list.find((s) => s.id === boundId) ?? null;
  }

  const picked = pickSessionForRepositorySidebarSelect(
    list,
    repoPathKey,
    loadSessionOwnerHints(),
    { mainOwnerAgentName },
  );
  if (picked) {
    return picked;
  }

  return fallbackActiveSessionForRepository(list, input);
}
