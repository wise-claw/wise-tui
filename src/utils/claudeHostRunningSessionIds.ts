import type { ClaudeHostProcess, ClaudeSession } from "../types";
import { normalizeRepositoryPathKey } from "./repositoryMainSessionBinding";

/** Claude 会话 ID → 本机扫描到的存活 PID 列表（同一 sid 可能对应多个进程行）。 */
export function buildClaudeSessionIdToLivePids(
  claudeProcesses: ReadonlyArray<Pick<ClaudeHostProcess, "sessionId" | "pid">>,
): Map<string, number[]> {
  const out = new Map<string, number[]>();
  for (const proc of claudeProcesses) {
    if (!Number.isFinite(proc.pid) || proc.pid <= 0) {
      continue;
    }
    const sid = proc.sessionId?.trim();
    if (!sid) {
      continue;
    }
    const prev = out.get(sid);
    if (prev) {
      if (!prev.includes(proc.pid)) {
        prev.push(proc.pid);
      }
    } else {
      out.set(sid, [proc.pid]);
    }
  }
  return out;
}

/**
 * 侧栏运行态：仅当本机 `ps` 扫描能根据 Claude 会话 ID 解析到存活 PID 时视为在跑。
 * 不使用注册表 alone，避免「注册表仍标记 running 但进程已退出」误亮绿点。
 */
export function collectRunningClaudeSessionIdsFromHostProcesses(
  claudeProcesses: ReadonlyArray<Pick<ClaudeHostProcess, "sessionId" | "pid">>,
): Set<string> {
  return new Set(buildClaudeSessionIdToLivePids(claudeProcesses).keys());
}

/** 绑定 Claude 会话 ID 是否对应当前扫描到的存活 PID。 */
export function isClaudeSessionIdRunningByHostPid(
  claudeSessionId: string | null | undefined,
  claudeProcesses: ReadonlyArray<Pick<ClaudeHostProcess, "sessionId" | "pid">>,
): boolean {
  const sid = claudeSessionId?.trim();
  if (!sid) {
    return false;
  }
  const pids = buildClaudeSessionIdToLivePids(claudeProcesses).get(sid);
  return Boolean(pids && pids.length > 0);
}

/** 会话工作区路径与本机进程 `projectPath` 是否同一目录或父子目录。 */
export function hostProcessPathsCorrelate(sessionPathKey: string, processPathKey: string): boolean {
  if (!sessionPathKey || !processPathKey) {
    return false;
  }
  if (sessionPathKey === processPathKey) {
    return true;
  }
  return (
    sessionPathKey.startsWith(`${processPathKey}/`) || processPathKey.startsWith(`${sessionPathKey}/`)
  );
}

/**
 * 侧栏运行态：绑定会话是否对应本机存活 Claude PID。
 * 优先 Claude 会话 ID ↔ 进程行 sessionId；否则在路径相关且会话 ID 不冲突时，仅凭 PID + projectPath 判定。
 */
export function isClaudeSessionRunningByHostProcesses(
  session: Pick<ClaudeSession, "claudeSessionId" | "repositoryPath">,
  claudeProcesses: ReadonlyArray<Pick<ClaudeHostProcess, "sessionId" | "pid" | "projectPath">>,
): boolean {
  const sid = session.claudeSessionId?.trim() ?? "";
  const sessionPathKey = normalizeRepositoryPathKey(session.repositoryPath);

  for (const proc of claudeProcesses) {
    if (!Number.isFinite(proc.pid) || proc.pid <= 0) {
      continue;
    }
    const procSid = proc.sessionId?.trim() ?? "";
    if (sid && procSid && sid === procSid) {
      return true;
    }
    const procPathKey = proc.projectPath?.trim()
      ? normalizeRepositoryPathKey(proc.projectPath)
      : "";
    if (!sessionPathKey || !procPathKey || !hostProcessPathsCorrelate(sessionPathKey, procPathKey)) {
      continue;
    }
    if (procSid && sid && procSid !== sid) {
      continue;
    }
    return true;
  }
  return false;
}

/** 与 `isClaudeSessionRunningByHostProcesses` 同源：收集绑定会话对应的本机存活 PID。 */
export function collectLiveHostPidsForClaudeSession(
  session: Pick<ClaudeSession, "claudeSessionId" | "repositoryPath">,
  claudeProcesses: ReadonlyArray<Pick<ClaudeHostProcess, "sessionId" | "pid" | "projectPath">>,
): number[] {
  const sid = session.claudeSessionId?.trim() ?? "";
  const sessionPathKey = normalizeRepositoryPathKey(session.repositoryPath);
  const pids: number[] = [];
  const seen = new Set<number>();

  const pushPid = (pid: number) => {
    if (!Number.isFinite(pid) || pid <= 0 || seen.has(pid)) {
      return;
    }
    seen.add(pid);
    pids.push(pid);
  };

  if (sid) {
    for (const live of buildClaudeSessionIdToLivePids(claudeProcesses).get(sid) ?? []) {
      pushPid(live);
    }
  }

  for (const proc of claudeProcesses) {
    if (!Number.isFinite(proc.pid) || proc.pid <= 0) {
      continue;
    }
    const procSid = proc.sessionId?.trim() ?? "";
    if (sid && procSid && sid === procSid) {
      pushPid(proc.pid);
      continue;
    }
    const procPathKey = proc.projectPath?.trim()
      ? normalizeRepositoryPathKey(proc.projectPath)
      : "";
    if (!sessionPathKey || !procPathKey || !hostProcessPathsCorrelate(sessionPathKey, procPathKey)) {
      continue;
    }
    if (procSid && sid && procSid !== sid) {
      continue;
    }
    pushPid(proc.pid);
  }
  return pids;
}
