import type { ClaudeSession } from "../types";
import { normalizeRepositoryPathKey } from "./repositoryMainSessionBinding";

function isLive(session: ClaudeSession): boolean {
  return session.status === "running" || session.status === "connecting";
}

/** 父目录和成员仓扫描可能导入相同原生 tab；保留正文/运行态及更具体的仓库归属。 */
export function dedupeNativeCliSessionTabs(sessions: ClaudeSession[]): ClaudeSession[] {
  const positions = new Map<string, number>();
  const result: ClaudeSession[] = [];
  let changed = false;
  for (const session of sessions) {
    const index = positions.get(session.id);
    const previous = index === undefined ? undefined : result[index];
    if (!previous || !session.nativeCliSource || previous.nativeCliSource !== session.nativeCliSource) {
      positions.set(session.id, result.length);
      result.push(session);
      continue;
    }
    changed = true;
    const preferred = isLive(previous) !== isLive(session)
      ? (isLive(previous) ? previous : session)
      : previous.messages.length !== session.messages.length
        ? (previous.messages.length > session.messages.length ? previous : session)
        : (previous.diskUpdatedAtMs ?? previous.createdAt) >= (session.diskUpdatedAtMs ?? session.createdAt)
          ? previous : session;
    const other = preferred === previous ? session : previous;
    const preferredPath = normalizeRepositoryPathKey(preferred.repositoryPath);
    const otherPath = normalizeRepositoryPathKey(other.repositoryPath);
    const owner = preferredPath && otherPath.startsWith(`${preferredPath}/`) ? other : preferred;
    result[index!] = {
      ...other,
      ...preferred,
      repositoryPath: owner.repositoryPath,
      repositoryName: owner.repositoryName,
    };
  }
  return changed ? result : sessions;
}
