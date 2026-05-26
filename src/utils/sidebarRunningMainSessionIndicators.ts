import type { ClaudeSession, Repository } from "../types";
import {
  projectMainSessionBindingKey,
  resolveBoundMainSessionId,
  resolveMainOwnerAgentNameForRepositoryPath,
} from "./repositoryMainSessionBinding";

export interface SidebarRunningMainSessionMaps {
  runningByProjectId: Record<string, boolean>;
  runningByRepositoryId: Record<number, boolean>;
}

import type { ClaudeHostProcess } from "../types";
import { isClaudeSessionRunningByHostProcesses } from "./claudeHostRunningSessionIds";

/** 绑定主会话的 Claude 会话 ID 是否在本机进程扫描中有对应存活 PID。 */
function isBoundMainSessionRunningInHost(
  sessionId: string | null,
  sessions: ClaudeSession[],
  claudeProcesses: ReadonlyArray<Pick<ClaudeHostProcess, "sessionId" | "pid" | "projectPath">>,
): boolean {
  if (!sessionId) {
    return false;
  }
  const session = sessions.find((item) => item.id === sessionId);
  if (!session) {
    return false;
  }
  return isClaudeSessionRunningByHostProcesses(session, claudeProcesses);
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
}): SidebarRunningMainSessionMaps {
  const { projects, repositories, sessions, bindings, claudeProcesses } = params;
  const runningByProjectId: Record<string, boolean> = {};
  for (const project of projects) {
    const sessionId = resolveBoundMainSessionId(
      projectMainSessionBindingKey(project.id),
      bindings,
      sessions,
      null,
    );
    runningByProjectId[project.id] = isBoundMainSessionRunningInHost(
      sessionId,
      sessions,
      claudeProcesses,
    );
  }

  const runningByRepositoryId: Record<number, boolean> = {};
  for (const repository of repositories) {
    const mainOwnerAgentName = resolveMainOwnerAgentNameForRepositoryPath(repositories, repository.path);
    const sessionId = resolveBoundMainSessionId(
      repository.path,
      bindings,
      sessions,
      mainOwnerAgentName,
    );
    runningByRepositoryId[repository.id] = isBoundMainSessionRunningInHost(
      sessionId,
      sessions,
      claudeProcesses,
    );
  }

  return { runningByProjectId, runningByRepositoryId };
}
