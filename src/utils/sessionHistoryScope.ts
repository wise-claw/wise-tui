import type { ClaudeDiskSessionItem, ClaudeSession } from "../types";
import { listClaudeDiskSessions } from "../services/claudeDisk";
import { normalizeRepositoryPathKey, repositoryPathsMatch } from "./repositoryMainSessionBinding";

export function normalizeSessionRepositoryPath(path: string): string {
  return normalizeRepositoryPathKey(path) || path.trim();
}

/** 同一 Claude session_id / 本地 tab id 只保留一条（优先保留消息更多、更新更晚者）。 */
export function dedupeClaudeSessionsByIdentity(sessions: ClaudeSession[]): ClaudeSession[] {
  const byKey = new Map<string, ClaudeSession>();
  for (const session of sessions) {
    const key = session.claudeSessionId?.trim() || session.id;
    const prev = byKey.get(key);
    if (!prev) {
      byKey.set(key, session);
      continue;
    }
    const prevScore = sessionHistoryRankScore(prev);
    const nextScore = sessionHistoryRankScore(session);
    if (nextScore > prevScore) {
      byKey.set(key, session);
    }
  }
  return [...byKey.values()];
}

function sessionHistoryRankScore(session: ClaudeSession): number {
  const lastTs = session.messages[session.messages.length - 1]?.timestamp ?? session.createdAt;
  return lastTs + session.messages.length * 1e-3;
}

export function listSessionsForRepositoryPath(
  sessions: ReadonlyArray<ClaudeSession>,
  repositoryPath: string,
): ClaudeSession[] {
  return sessions.filter((session) => repositoryPathsMatch(session.repositoryPath ?? "", repositoryPath));
}

export function collectRepositoryPathListingCandidates(
  repositoryPath: string,
  existingSessions: ReadonlyArray<ClaudeSession>,
): string[] {
  const scopeKey = normalizeRepositoryPathKey(repositoryPath);
  const seen = new Set<string>();
  const out: string[] = [];
  const push = (raw: string) => {
    const trimmed = raw.trim();
    if (!trimmed || seen.has(trimmed)) return;
    seen.add(trimmed);
    out.push(trimmed);
  };
  push(repositoryPath);
  if (scopeKey) {
    for (const session of existingSessions) {
      if (repositoryPathsMatch(session.repositoryPath, scopeKey)) {
        push(session.repositoryPath);
      }
    }
  }
  return out;
}

/**
 * 按候选路径扫描 ~/.claude/projects，合并结果（兼容路径写法差异导致的编码目录不一致）。
 */
export async function listClaudeDiskSessionsForRepositoryScope(
  repositoryPath: string,
  existingSessions: ReadonlyArray<ClaudeSession>,
): Promise<{ disk: ClaudeDiskSessionItem[]; listingPath: string }> {
  const candidates = collectRepositoryPathListingCandidates(repositoryPath, existingSessions);
  const primary = normalizeSessionRepositoryPath(repositoryPath);
  const merged = new Map<string, ClaudeDiskSessionItem>();
  let lastError: unknown;

  for (const candidate of candidates) {
    try {
      const chunk = await listClaudeDiskSessions(candidate);
      for (const item of chunk) {
        const prev = merged.get(item.sessionId);
        if (!prev || item.updatedAtMs > prev.updatedAtMs) {
          merged.set(item.sessionId, item);
        }
      }
    } catch (error) {
      lastError = error;
    }
  }

  if (merged.size === 0 && lastError && candidates.length <= 1) {
    throw lastError;
  }

  const disk = [...merged.values()].sort((a, b) => b.updatedAtMs - a.updatedAtMs);
  return { disk, listingPath: primary };
}
