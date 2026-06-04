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
  return name.includes("/执行环境:");
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

  if (execEnvSessions.length === 1) return execEnvSessions[0];

  return undefined;
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
