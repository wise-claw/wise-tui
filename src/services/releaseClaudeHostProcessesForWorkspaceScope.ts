import type { ClaudeHostProcess, ClaudeSession, ClaudeSessionInfo, ProjectItem, Repository } from "../types";
import { endClaudeProcessRow } from "../components/LeftSidebar/endClaudeProcessRow";
import {
  buildHostClaudeProcessSession,
  buildRegistryOrphanClaudeSession,
} from "../components/LeftSidebar/systemSessions";
import { isClaudeSessionRunningByHostProcesses } from "../utils/claudeHostRunningSessionIds";
import {
  collectProjectScopePathKeys,
  collectRepositoryScopePathKeys,
  isHostProcessInWorkspaceScope,
  isRegistryInfoInWorkspaceScope,
  isSessionInWorkspaceScope,
} from "../utils/workspaceScopeClaudeProcessMatch";
import { cancelClaudeExecution, listRunningClaudeSessions } from "./claude";
import { isClaudeSessionRunningInHostOrUi } from "./claudeSessionState";
import { getSystemResourceSnapshot, killClaudeHostProcess } from "./systemResource";

export interface ReleaseClaudeHostProcessesForWorkspaceScopeParams {
  scopePathKeys: ReadonlySet<string>;
  sessions: ClaudeSession[];
  /** 新建会话 id：不参与清理 */
  excludeSessionIds?: ReadonlySet<string>;
  /** Wise 标签会话：完整释放（streaming / 状态 / 本机进程） */
  releaseWiseTabSession?: (sessionId: string) => Promise<void>;
  /** 进程弹窗 Wise 行兜底 */
  onCancelTabSession?: (sessionId: string) => void;
}

async function loadClaudeRuntimeSnapshot(): Promise<{
  claudeProcesses: ClaudeHostProcess[];
  registryRunning: ClaudeSessionInfo[];
}> {
  const [snapshotResult, registryResult] = await Promise.allSettled([
    getSystemResourceSnapshot(),
    listRunningClaudeSessions(),
  ]);
  return {
    claudeProcesses:
      snapshotResult.status === "fulfilled" ? (snapshotResult.value.claudeProcesses ?? []) : [],
    registryRunning:
      registryResult.status === "fulfilled"
        ? registryResult.value.filter((item) => item.status === "running")
        : [],
  };
}

function isExcludedSession(
  sessionId: string,
  excludeSessionIds: ReadonlySet<string> | undefined,
): boolean {
  const id = sessionId.trim();
  return Boolean(id && excludeSessionIds?.has(id));
}

function collectScopedRunningWiseTabs(
  params: ReleaseClaudeHostProcessesForWorkspaceScopeParams & {
    claudeProcesses: ClaudeHostProcess[];
    registryRunningIds: ReadonlySet<string>;
  },
): ClaudeSession[] {
  const { scopePathKeys, sessions, excludeSessionIds, claudeProcesses, registryRunningIds } =
    params;
  const picked: ClaudeSession[] = [];
  const seenTabIds = new Set<string>();
  for (const session of sessions) {
    if (isExcludedSession(session.id, excludeSessionIds)) {
      continue;
    }
    if (!isSessionInWorkspaceScope(session, scopePathKeys)) {
      continue;
    }
    const running =
      isClaudeSessionRunningInHostOrUi(session, registryRunningIds) ||
      isClaudeSessionRunningByHostProcesses(session, claudeProcesses);
    if (!running || seenTabIds.has(session.id)) {
      continue;
    }
    seenTabIds.add(session.id);
    picked.push(session);
  }
  return picked;
}

/** 新建主会话前：结束同仓库 / 项目工作区范围内仍存活的本机 Claude 进程。 */
export async function releaseClaudeHostProcessesForWorkspaceScope(
  params: ReleaseClaudeHostProcessesForWorkspaceScopeParams,
): Promise<void> {
  const { scopePathKeys, releaseWiseTabSession, onCancelTabSession } = params;
  if (scopePathKeys.size === 0) {
    return;
  }

  const { claudeProcesses, registryRunning } = await loadClaudeRuntimeSnapshot();
  const registryRunningIds = new Set(
    registryRunning.map((item) => item.session_id.trim()).filter(Boolean),
  );
  const cancelledClaudeSessionIds = new Set<string>();
  const handledHostPids = new Set<number>();

  const scopedTabs = collectScopedRunningWiseTabs({
    ...params,
    claudeProcesses,
    registryRunningIds,
  });

  for (const tab of scopedTabs) {
    const sid = tab.claudeSessionId?.trim() ?? "";
    if (releaseWiseTabSession) {
      await releaseWiseTabSession(tab.id).catch(() => undefined);
    } else if (onCancelTabSession) {
      onCancelTabSession(tab.id);
    } else if (sid) {
      await cancelClaudeExecution(sid).catch(() => undefined);
    }
    if (sid) {
      cancelledClaudeSessionIds.add(sid);
    }
  }

  const sessionClaudeIdSet = new Set(
    params.sessions
      .map((session) => session.claudeSessionId?.trim())
      .filter((id): id is string => Boolean(id && id.length > 0)),
  );

  for (const proc of claudeProcesses) {
    if (!Number.isFinite(proc.pid) || proc.pid <= 0 || handledHostPids.has(proc.pid)) {
      continue;
    }
    if (!isHostProcessInWorkspaceScope(proc, scopePathKeys)) {
      continue;
    }
    const rowSession = buildHostClaudeProcessSession(proc);
    if (isExcludedSession(rowSession.id, params.excludeSessionIds)) {
      continue;
    }
    const sid = proc.sessionId?.trim() ?? "";
    if (sid && cancelledClaudeSessionIds.has(sid)) {
      handledHostPids.add(proc.pid);
      continue;
    }
    await endClaudeProcessRow({
      rowSessionId: rowSession.id,
      rowSession,
      onCancelTabSession,
    }).catch(() => undefined);
    handledHostPids.add(proc.pid);
    if (sid) {
      cancelledClaudeSessionIds.add(sid);
    }
  }

  for (const info of registryRunning) {
    const sid = info.session_id.trim();
    if (!sid || cancelledClaudeSessionIds.has(sid) || sessionClaudeIdSet.has(sid)) {
      continue;
    }
    if (!isRegistryInfoInWorkspaceScope(info, scopePathKeys)) {
      continue;
    }
    const rowSession = buildRegistryOrphanClaudeSession(info);
    if (isExcludedSession(rowSession.id, params.excludeSessionIds)) {
      continue;
    }
    await endClaudeProcessRow({
      rowSessionId: rowSession.id,
      rowSession,
      onCancelTabSession,
    }).catch(() => undefined);
    cancelledClaudeSessionIds.add(sid);
  }
}

export async function releaseClaudeHostProcessesForRepositoryScope(params: {
  repositoryPath: string;
  sessions: ClaudeSession[];
  excludeSessionId?: string | null;
  releaseWiseTabSession?: (sessionId: string) => Promise<void>;
  onCancelTabSession?: (sessionId: string) => void;
}): Promise<void> {
  const excludeSessionIds = params.excludeSessionId?.trim()
    ? new Set([params.excludeSessionId.trim()])
    : undefined;
  await releaseClaudeHostProcessesForWorkspaceScope({
    scopePathKeys: collectRepositoryScopePathKeys(params.repositoryPath),
    sessions: params.sessions,
    excludeSessionIds,
    releaseWiseTabSession: params.releaseWiseTabSession,
    onCancelTabSession: params.onCancelTabSession,
  });
}

export async function releaseClaudeHostProcessesForProjectScope(params: {
  project: ProjectItem;
  repositories: Repository[];
  sessions: ClaudeSession[];
  excludeSessionId?: string | null;
  releaseWiseTabSession?: (sessionId: string) => Promise<void>;
  onCancelTabSession?: (sessionId: string) => void;
}): Promise<void> {
  const excludeSessionIds = params.excludeSessionId?.trim()
    ? new Set([params.excludeSessionId.trim()])
    : undefined;
  await releaseClaudeHostProcessesForWorkspaceScope({
    scopePathKeys: collectProjectScopePathKeys(params.project, params.repositories),
    sessions: params.sessions,
    excludeSessionIds,
    releaseWiseTabSession: params.releaseWiseTabSession,
    onCancelTabSession: params.onCancelTabSession,
  });
}
