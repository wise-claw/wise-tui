import type { ClaudeSession } from "../types";
import { isExecutionEnvironmentWorkerRepositoryName } from "./executionEnvironmentDispatch";
import { normalizeRepositoryPathKey, repositoryPathsMatch } from "./repositoryMainSessionBinding";

/** 终端 / 执行环境 worker：磁盘合并与 stream init 须保留 Wise tab id。 */
export function preservesWorkerWiseTabId(
  session: Pick<ClaudeSession, "repositoryName">,
): boolean {
  const name = session.repositoryName?.trim() ?? "";
  if (!name) return false;
  if (name.includes("/员工:")) return true;
  if (name.includes("/执行环境:")) return true;
  return name.includes("/神经网:");
}

export function resolveSessionForExecuteKey(
  sessions: readonly ClaudeSession[],
  sessionKey: string,
  sessionIdMap?: ReadonlyMap<string, string>,
): ClaudeSession | undefined {
  const raw = sessionKey.trim();
  if (!raw) return undefined;

  const byDirect = sessions.find((s) => s.id === raw || s.claudeSessionId?.trim() === raw);
  if (byDirect) return byDirect;

  if (sessionIdMap) {
    const mapped = sessionIdMap.get(raw)?.trim();
    if (mapped) {
      const hit = sessions.find((s) => s.id === mapped || s.claudeSessionId?.trim() === mapped);
      if (hit) return hit;
    }
    for (const [tabId, claudeId] of sessionIdMap.entries()) {
      if (claudeId === raw || tabId === raw) {
        const hit = sessions.find(
          (s) => s.id === tabId || s.claudeSessionId?.trim() === claudeId || s.id === claudeId,
        );
        if (hit) return hit;
      }
    }
  }

  return undefined;
}

export function materializeWorkerTabSession(
  source: ClaudeSession,
  workerSessionId: string,
): ClaudeSession {
  const tabId = workerSessionId.trim();
  if (!tabId) return source;
  const claudeSid =
    source.claudeSessionId?.trim() ||
    (source.id.trim() !== tabId ? source.id.trim() : null);
  return {
    ...source,
    id: tabId,
    claudeSessionId: claudeSid,
    status:
      source.status === "running" || source.status === "connecting"
        ? source.status
        : "completed",
  };
}

/** 派发 worker 从内存消失或 tab id 漂移时，按仓库 + 标签名回退匹配。 */
export function findExecutionEnvironmentWorkerInRepository(
  sessions: readonly ClaudeSession[],
  input: {
    workerSessionId: string;
    repositoryPath: string;
    taskLabel?: string;
    sessionIdMap?: ReadonlyMap<string, string>;
  },
): ClaudeSession | undefined {
  const workerKey = input.workerSessionId.trim();
  const repoPath = normalizeRepositoryPathKey(input.repositoryPath.trim()) || input.repositoryPath.trim();
  if (!workerKey || !repoPath) {
    return resolveSessionForExecuteKey(sessions, workerKey, input.sessionIdMap);
  }

  const direct = resolveSessionForExecuteKey(sessions, workerKey, input.sessionIdMap);
  if (direct) return direct;

  const labelNeedle = input.taskLabel?.replace(/\s+/g, " ").trim();
  const execEnvSessions = sessions.filter(
    (s) =>
      repositoryPathsMatch(s.repositoryPath, repoPath) &&
      isExecutionEnvironmentWorkerRepositoryName(s.repositoryName),
  );

  if (labelNeedle) {
    const byLabel = execEnvSessions.filter((s) => s.repositoryName.includes(labelNeedle));
    if (byLabel.length === 1) return byLabel[0];
  }

  const mapped = input.sessionIdMap?.get(workerKey)?.trim();
  if (mapped) {
    const byMap = execEnvSessions.find(
      (s) => s.id === mapped || s.claudeSessionId?.trim() === mapped,
    );
    if (byMap) return byMap;
  }

  const byTab = execEnvSessions.find((s) => s.id === workerKey);
  if (byTab) return byTab;

  // 无明确 worker id 时才允许「仓库内唯一 worker」回退；否则会把历史派发误绑到当前存活标签。
  if (!workerKey && execEnvSessions.length === 1) return execEnvSessions[0];

  return undefined;
}

/**
 * 执行会话详情 drawer：只按派发记录的 workerSessionId（及 id 映射）解析，不做标签/唯一 worker 回退。
 */
export function findExecutionEnvironmentWorkerForTaskDetail(
  sessions: readonly ClaudeSession[],
  input: {
    workerSessionId: string;
    repositoryPath?: string;
    sessionIdMap?: ReadonlyMap<string, string>;
  },
): ClaudeSession | undefined {
  const workerKey = input.workerSessionId.trim();
  if (!workerKey) return undefined;

  const direct = resolveSessionForExecuteKey(sessions, workerKey, input.sessionIdMap);
  if (direct) return direct;

  const repoPath = input.repositoryPath?.trim();
  if (!repoPath) return undefined;

  const execEnvSessions = sessions.filter(
    (s) =>
      repositoryPathsMatch(s.repositoryPath, repoPath) &&
      isExecutionEnvironmentWorkerRepositoryName(s.repositoryName),
  );

  const mapped = input.sessionIdMap?.get(workerKey)?.trim();
  if (mapped) {
    const byMap = execEnvSessions.find(
      (s) => s.id === mapped || s.claudeSessionId?.trim() === mapped,
    );
    if (byMap) return byMap;
  }

  return (
    execEnvSessions.find((s) => s.id === workerKey) ??
    execEnvSessions.find((s) => s.claudeSessionId?.trim() === workerKey)
  );
}

export function findSessionForMonitorDrawerResume(
  sessions: readonly ClaudeSession[],
  input: {
    sessionId: string;
    repositoryPath?: string;
    taskLabel?: string;
    sessionIdMap?: ReadonlyMap<string, string>;
  },
): ClaudeSession | undefined {
  const direct = resolveSessionForExecuteKey(sessions, input.sessionId, input.sessionIdMap);
  if (direct) return direct;
  if (input.repositoryPath?.trim()) {
    return findExecutionEnvironmentWorkerInRepository(sessions, {
      workerSessionId: input.sessionId,
      repositoryPath: input.repositoryPath,
      taskLabel: input.taskLabel,
      sessionIdMap: input.sessionIdMap,
    });
  }
  return undefined;
}
