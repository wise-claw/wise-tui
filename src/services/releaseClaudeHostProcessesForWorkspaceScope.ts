import type {
  ClaudeHostProcess,
  ClaudeSession,
  ClaudeSessionInfo,
  ProjectItem,
  Repository,
} from "../types";

export interface ReleaseWiseTabSessionContext {
  claudeProcesses: ClaudeHostProcess[];
}
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
import { getSystemResourceSnapshot } from "./systemResource";

export interface ReleaseClaudeHostProcessesForWorkspaceScopeParams {
  scopePathKeys: ReadonlySet<string>;
  sessions: ClaudeSession[];
  /** 新建会话 id：不参与清理 */
  excludeSessionIds?: ReadonlySet<string>;
  /** Wise 标签会话：完整释放（streaming / 状态 / 本机进程） */
  releaseWiseTabSession?: (
    sessionId: string,
    ctx?: ReleaseWiseTabSessionContext,
  ) => Promise<void>;
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

/** UI 仍在执行的标签：新建主会话时不得取消（Codex RPC / Cursor / Claude 等）。 */
function isExecutingWiseTab(session: ClaudeSession): boolean {
  return session.status === "running" || session.status === "connecting";
}

/**
 * 同仓库内「僵尸」标签：宿主/注册表仍 running，但 UI 已非执行态。
 * 可安全释放；真正执行中的标签必须保留为后台会话。
 */
function collectScopedZombieWiseTabs(
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
    if (isExecutingWiseTab(session)) {
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

function collectProtectedExecutionIds(
  sessions: readonly ClaudeSession[],
  scopePathKeys: ReadonlySet<string>,
  excludeSessionIds: ReadonlySet<string> | undefined,
): Set<string> {
  const protectedIds = new Set<string>();
  for (const session of sessions) {
    if (isExcludedSession(session.id, excludeSessionIds)) continue;
    if (!isSessionInWorkspaceScope(session, scopePathKeys)) continue;
    if (!isExecutingWiseTab(session)) continue;
    protectedIds.add(session.id);
    const claudeSid = session.claudeSessionId?.trim();
    if (claudeSid) protectedIds.add(claudeSid);
  }
  return protectedIds;
}

/**
 * 新建主会话前：清理同仓库 / 项目范围内的孤儿本机进程与僵尸标签。
 * 仍在执行（running/connecting）的 Wise 标签不得取消，应作为后台会话继续跑。
 */
export async function releaseClaudeHostProcessesForWorkspaceScope(
  params: ReleaseClaudeHostProcessesForWorkspaceScopeParams,
): Promise<ReadonlySet<string>> {
  const { scopePathKeys, releaseWiseTabSession, onCancelTabSession } = params;
  const releasedWiseTabIds = new Set<string>();
  if (scopePathKeys.size === 0) {
    return releasedWiseTabIds;
  }

  const { claudeProcesses, registryRunning } = await loadClaudeRuntimeSnapshot();
  const registryRunningIds = new Set(
    registryRunning.map((item) => item.session_id.trim()).filter(Boolean),
  );
  const cancelledClaudeSessionIds = new Set<string>();
  const handledHostPids = new Set<number>();
  const protectedExecutionIds = collectProtectedExecutionIds(
    params.sessions,
    scopePathKeys,
    params.excludeSessionIds,
  );

  const scopedTabs = collectScopedZombieWiseTabs({
    ...params,
    claudeProcesses,
    registryRunningIds,
  });

  await Promise.all(
    scopedTabs.map(async (tab) => {
      const sid = tab.claudeSessionId?.trim() ?? "";
      releasedWiseTabIds.add(tab.id);
      if (releaseWiseTabSession) {
        await releaseWiseTabSession(tab.id, { claudeProcesses }).catch(() => undefined);
      } else if (onCancelTabSession) {
        onCancelTabSession(tab.id);
      } else if (sid) {
        await cancelClaudeExecution(sid).catch(() => undefined);
      }
      if (sid) {
        cancelledClaudeSessionIds.add(sid);
      }
    }),
  );

  const sessionClaudeIdSet = new Set(
    params.sessions
      .map((session) => session.claudeSessionId?.trim())
      .filter((id): id is string => Boolean(id && id.length > 0)),
  );
  for (const session of params.sessions) {
    const tabId = session.id.trim();
    if (tabId) sessionClaudeIdSet.add(tabId);
  }

  const orphanEndTasks: Promise<void>[] = [];
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
    if (sid && (cancelledClaudeSessionIds.has(sid) || protectedExecutionIds.has(sid))) {
      handledHostPids.add(proc.pid);
      continue;
    }
    if (protectedExecutionIds.has(rowSession.id)) {
      handledHostPids.add(proc.pid);
      continue;
    }
    // 任一 Wise 标签仍认领该 session id 时勿当孤儿杀掉（含后台执行中的 Codex RPC）。
    if (sid && sessionClaudeIdSet.has(sid)) {
      handledHostPids.add(proc.pid);
      continue;
    }
    orphanEndTasks.push(
      endClaudeProcessRow({
        rowSessionId: rowSession.id,
        rowSession,
        onCancelTabSession,
      }).catch(() => undefined),
    );
    handledHostPids.add(proc.pid);
    if (sid) {
      cancelledClaudeSessionIds.add(sid);
    }
  }

  for (const info of registryRunning) {
    const sid = info.session_id.trim();
    if (
      !sid ||
      cancelledClaudeSessionIds.has(sid) ||
      sessionClaudeIdSet.has(sid) ||
      protectedExecutionIds.has(sid)
    ) {
      continue;
    }
    if (!isRegistryInfoInWorkspaceScope(info, scopePathKeys)) {
      continue;
    }
    const rowSession = buildRegistryOrphanClaudeSession(info);
    if (isExcludedSession(rowSession.id, params.excludeSessionIds)) {
      continue;
    }
    orphanEndTasks.push(
      endClaudeProcessRow({
        rowSessionId: rowSession.id,
        rowSession,
        onCancelTabSession,
      }).catch(() => undefined),
    );
    cancelledClaudeSessionIds.add(sid);
  }

  await Promise.all(orphanEndTasks);
  return releasedWiseTabIds;
}

export async function releaseClaudeHostProcessesForRepositoryScope(params: {
  repositoryPath: string;
  sessions: ClaudeSession[];
  excludeSessionId?: string | null;
  releaseWiseTabSession?: ReleaseClaudeHostProcessesForWorkspaceScopeParams["releaseWiseTabSession"];
  onCancelTabSession?: (sessionId: string) => void;
}): Promise<ReadonlySet<string>> {
  const excludeSessionIds = params.excludeSessionId?.trim()
    ? new Set([params.excludeSessionId.trim()])
    : undefined;
  return releaseClaudeHostProcessesForWorkspaceScope({
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
  releaseWiseTabSession?: ReleaseClaudeHostProcessesForWorkspaceScopeParams["releaseWiseTabSession"];
  onCancelTabSession?: (sessionId: string) => void;
}): Promise<ReadonlySet<string>> {
  const excludeSessionIds = params.excludeSessionId?.trim()
    ? new Set([params.excludeSessionId.trim()])
    : undefined;
  return releaseClaudeHostProcessesForWorkspaceScope({
    scopePathKeys: collectProjectScopePathKeys(params.project, params.repositories),
    sessions: params.sessions,
    excludeSessionIds,
    releaseWiseTabSession: params.releaseWiseTabSession,
    onCancelTabSession: params.onCancelTabSession,
  });
}
