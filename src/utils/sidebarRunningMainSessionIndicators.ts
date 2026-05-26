import type { ClaudeHostProcess, ClaudeSession, Repository } from "../types";
import { isClaudeSessionRunningInHostOrUi } from "../services/claudeSessionState";
import { isClaudeSessionRunningByHostProcesses } from "./claudeHostRunningSessionIds";
import {
  isProjectRootSessionDisplayName,
  isRepositoryMainSessionTab,
  normalizeRepositoryPathKey,
  projectMainSessionBindingKey,
  resolveBoundMainSessionId,
  resolveMainOwnerAgentNameForRepositoryPath,
} from "./repositoryMainSessionBinding";

export interface SidebarRunningMainSessionMaps {
  runningByProjectId: Record<string, boolean>;
  runningByRepositoryId: Record<number, boolean>;
}

/** 主会话是否仍在跑：本机 PID、宿主注册表、或 UI running/connecting（Hook 启动窗口）。 */
function isMainSessionConsideredRunning(
  session: ClaudeSession,
  claudeProcesses: ReadonlyArray<Pick<ClaudeHostProcess, "sessionId" | "pid" | "projectPath">>,
  registryRunningClaudeSessionIds: ReadonlySet<string>,
): boolean {
  return (
    isClaudeSessionRunningByHostProcesses(session, claudeProcesses) ||
    isClaudeSessionRunningInHostOrUi(session, registryRunningClaudeSessionIds)
  );
}

function isBoundMainSessionRunning(
  sessionId: string | null,
  sessions: ClaudeSession[],
  claudeProcesses: ReadonlyArray<Pick<ClaudeHostProcess, "sessionId" | "pid" | "projectPath">>,
  registryRunningClaudeSessionIds: ReadonlySet<string>,
): boolean {
  if (!sessionId) {
    return false;
  }
  const session = sessions.find((item) => item.id === sessionId);
  if (!session) {
    return false;
  }
  return isMainSessionConsideredRunning(session, claudeProcesses, registryRunningClaudeSessionIds);
}

/**
 * 绑定指向已 idle 的标签时：同路径其它**非 Project 根**主会话若在跑仍亮绿点。
 * 不把仅挂在工作区项目绑定上的 `Project: …` 根会话算进成员仓，避免子仓误亮。
 */
function isAlternateRepositoryMainSessionRunning(
  repositoryPathKey: string,
  mainOwnerAgentName: string | null,
  boundSessionId: string,
  sessions: ClaudeSession[],
  claudeProcesses: ReadonlyArray<Pick<ClaudeHostProcess, "sessionId" | "pid" | "projectPath">>,
  registryRunningClaudeSessionIds: ReadonlySet<string>,
): boolean {
  return sessions.some(
    (session) =>
      session.id !== boundSessionId &&
      !isProjectRootSessionDisplayName(session.repositoryName ?? "") &&
      isRepositoryMainSessionTab(session, repositoryPathKey, mainOwnerAgentName) &&
      isMainSessionConsideredRunning(session, claudeProcesses, registryRunningClaudeSessionIds),
  );
}

/**
 * 侧栏工作区：按项目/仓库**显式绑定**的主会话是否在跑（Claude 会话 ID ↔ 本机 PID），供绿色圆点展示。
 * 仓库行只用 `resolveBoundMainSessionId`，不用 `resolveRepositoryMainSessionId` 的项目根回退，
 * 避免「仅工作区/父路径有绑定、子仓从未绑过」时子仓误亮绿点。
 */
export function buildSidebarRunningMainSessionMaps(params: {
  projects: ReadonlyArray<{ id: string }>;
  repositories: Repository[];
  sessions: ClaudeSession[];
  bindings: Record<string, string>;
  claudeProcesses: ReadonlyArray<Pick<ClaudeHostProcess, "sessionId" | "pid" | "projectPath">>;
  registryRunningClaudeSessionIds?: ReadonlySet<string>;
}): SidebarRunningMainSessionMaps {
  const {
    projects,
    repositories,
    sessions,
    bindings,
    claudeProcesses,
    registryRunningClaudeSessionIds = new Set(),
  } = params;
  const runningByProjectId: Record<string, boolean> = {};
  for (const project of projects) {
    const sessionId = resolveBoundMainSessionId(
      projectMainSessionBindingKey(project.id),
      bindings,
      sessions,
      null,
    );
    runningByProjectId[project.id] = isBoundMainSessionRunning(
      sessionId,
      sessions,
      claudeProcesses,
      registryRunningClaudeSessionIds,
    );
  }

  const runningByRepositoryId: Record<number, boolean> = {};
  for (const repository of repositories) {
    const repositoryPathKey = normalizeRepositoryPathKey(repository.path);
    const mainOwnerAgentName = resolveMainOwnerAgentNameForRepositoryPath(repositories, repository.path);
    const sessionId = resolveBoundMainSessionId(
      repository.path,
      bindings,
      sessions,
      mainOwnerAgentName,
    );
    if (!sessionId) {
      runningByRepositoryId[repository.id] = false;
      continue;
    }
    runningByRepositoryId[repository.id] =
      isBoundMainSessionRunning(sessionId, sessions, claudeProcesses, registryRunningClaudeSessionIds) ||
      isAlternateRepositoryMainSessionRunning(
        repositoryPathKey,
        mainOwnerAgentName,
        sessionId,
        sessions,
        claudeProcesses,
        registryRunningClaudeSessionIds,
      );
  }

  return { runningByProjectId, runningByRepositoryId };
}
