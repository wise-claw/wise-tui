import type { ClaudeSession, ProjectItem, Repository } from "../types";
import { resolveProjectMainSessionAnchor } from "./projectSessionAnchor";
import {
  pickProjectMainSessionForSidebarSelect,
  pickSessionForRepositorySidebarSelect,
} from "./claudeSessionSelection";
import { filterSessionsForWorkspace } from "./projectSessionPanelFilter";
import {
  normalizeRepositoryPathKey,
  projectMainSessionBindingKey,
  resolveBoundMainSessionId,
  resolveMainOwnerAgentNameForRepositoryPath,
  resolveRepositoryForSession,
  resolveRepositoryMainSessionId,
} from "./repositoryMainSessionBinding";
import { loadSessionOwnerHints } from "./sessionOwnerHints";
import type { WorkspaceFocus, WorkspaceMode } from "./workspaceMode";

export interface ResolveWorkspaceMainSessionInput {
  sessions: readonly ClaudeSession[];
  bindings: Record<string, string>;
  repositories: readonly Repository[];
  activeRepository?: Repository | null;
  activeProject?: ProjectItem | null;
  activeWorkspaceFocus?: WorkspaceFocus;
  workspaceMode?: WorkspaceMode;
  /** 当前活动标签；绑定/侧栏 pick 未命中时，若归属本仓库/项目则作为主会话 */
  activeSessionId?: string | null;
}

function findSessionByTabOrClaudeId(
  list: readonly ClaudeSession[],
  sessionKey: string | null | undefined,
): ClaudeSession | null {
  const trimmed = sessionKey?.trim();
  if (!trimmed) return null;
  return list.find((session) => session.id === trimmed || session.claudeSessionId === trimmed) ?? null;
}

function pickBestProjectWorkspaceSession(
  list: ClaudeSession[],
  project: ProjectItem,
  repositories: readonly Repository[],
  workspaceMode: WorkspaceMode,
): ClaudeSession | null {
  const candidates = filterSessionsForWorkspace({
    sessions: list,
    workspaceMode,
    project,
    repositories,
    activeWorkspaceFocus: "project",
  });
  if (candidates.length === 0) return null;
  let best: ClaudeSession | null = null;
  let bestScore = -Infinity;
  for (const session of candidates) {
    const messageScore = session.messages.length > 0 ? 1_000_000 : 0;
    const previewScore = session.diskPreview?.trim() ? 1_000 : 0;
    const ts = session.messages[session.messages.length - 1]?.timestamp ?? session.createdAt;
    const score = messageScore + previewScore + ts;
    if (score > bestScore) {
      bestScore = score;
      best = session;
    }
  }
  return best;
}

function fallbackActiveSessionForProject(
  list: ClaudeSession[],
  activeSessionId: string | null | undefined,
  project: ProjectItem,
  repositories: readonly Repository[],
  workspaceMode: WorkspaceMode,
): ClaudeSession | null {
  const active = findSessionByTabOrClaudeId(list, activeSessionId);
  if (!active) {
    return null;
  }
  if (
    filterSessionsForWorkspace({
      sessions: [active],
      workspaceMode,
      project,
      repositories,
      activeWorkspaceFocus: "project",
    }).length > 0
  ) {
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
  const active = list.find((s) => s.id === activeSessionId || s.claudeSessionId === activeSessionId);
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
    workspaceMode = "multi_repo",
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
      pickBestProjectWorkspaceSession(list, activeProject, repositories, workspaceMode) ??
      pickProjectMainSessionForSidebarSelect(list, anchorPath, loadSessionOwnerHints()) ??
      pickSessionForRepositorySidebarSelect(list, anchorPath, loadSessionOwnerHints(), undefined);
    if (picked) {
      return picked;
    }
    return (
      fallbackActiveSessionForProject(
        list,
        input.activeSessionId,
        activeProject,
        repositories,
        workspaceMode,
      ) ?? fallbackActiveSessionForRepository(list, input)
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
