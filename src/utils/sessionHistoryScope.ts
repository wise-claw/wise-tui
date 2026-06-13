import type { ClaudeDiskSessionItem, ClaudeSession, ProjectItem, Repository } from "../types";
import { listClaudeDiskSessions } from "../services/claudeDisk";
import { pathIsAccessibleDirectoryCached } from "./pathAccessibilityCache";
import { filterSessionsForWorkspace } from "./projectSessionPanelFilter";
import { resolveProjectMainSessionAnchor } from "./projectSessionAnchor";
import type { WorkspaceFocus, WorkspaceMode } from "./workspaceMode";
import {
  normalizeRepositoryPathKey,
  projectMainSessionBindingKey,
  repositoryPathsMatch,
  resolveBoundMainSessionId,
  sessionMatchesRepositoryScope,
} from "./repositoryMainSessionBinding";

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
  return sessions.filter((session) => sessionMatchesRepositoryScope(session, repositoryPath));
}

export interface HistorySessionScopeInput {
  repositoryScopePath: string;
  activeProject?: ProjectItem | null;
  activeWorkspaceFocus?: WorkspaceFocus;
  activeRepositoryId?: number | null;
  repositories?: ReadonlyArray<Repository>;
  workspaceMode?: WorkspaceMode;
  repositoryMainBindings?: Record<string, string>;
}

/** 历史会话弹层：工作区焦点只列 Project 主会话；仓库焦点只列该仓会话（不含 Project 主会话）。 */
export function listSessionsForHistoryScope(
  sessions: ReadonlyArray<ClaudeSession>,
  input: HistorySessionScopeInput,
): ClaudeSession[] {
  if (input.activeProject) {
    const filtered = filterSessionsForWorkspace({
      sessions: [...sessions],
      workspaceMode: input.workspaceMode ?? "multi_repo",
      project: input.activeProject,
      repositories: input.repositories ?? [],
      activeWorkspaceFocus: input.activeWorkspaceFocus ?? "repository",
      activeRepositoryId: input.activeRepositoryId ?? null,
    });
    if (input.activeWorkspaceFocus !== "project") {
      return filtered;
    }
    const boundId = resolveBoundMainSessionId(
      projectMainSessionBindingKey(input.activeProject.id),
      input.repositoryMainBindings ?? {},
      [...sessions],
      null,
    );
    if (!boundId || filtered.some((session) => session.id === boundId)) {
      return filtered;
    }
    const bound = sessions.find((session) => session.id === boundId);
    return bound ? [...filtered, bound] : filtered;
  }
  return listSessionsForRepositoryPath(sessions, input.repositoryScopePath);
}

/** 磁盘扫描路径：工作区焦点扫项目 anchor，仓库焦点扫当前 scope。 */
export function resolveHistoryDiskScopePath(input: HistorySessionScopeInput): string {
  if (input.activeProject && input.activeWorkspaceFocus === "project") {
    const anchorPath = resolveProjectMainSessionAnchor(input.activeProject, input.repositories ?? []).path.trim();
    if (anchorPath) {
      return normalizeSessionRepositoryPath(anchorPath);
    }
  }
  return normalizeSessionRepositoryPath(input.repositoryScopePath);
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
 * 尽力而为：单条候选失败或路径不可访问时跳过，不向上抛错。
 */
export async function listClaudeDiskSessionsForRepositoryScope(
  repositoryPath: string,
  existingSessions: ReadonlyArray<ClaudeSession>,
): Promise<{ disk: ClaudeDiskSessionItem[]; listingPath: string }> {
  const candidates = collectRepositoryPathListingCandidates(repositoryPath, existingSessions);
  const primary = normalizeSessionRepositoryPath(repositoryPath);
  const merged = new Map<string, ClaudeDiskSessionItem>();

  for (const candidate of candidates) {
    if (!(await pathIsAccessibleDirectoryCached(candidate))) continue;
    try {
      const chunk = await listClaudeDiskSessions(candidate);
      for (const item of chunk) {
        const prev = merged.get(item.sessionId);
        if (!prev || item.updatedAtMs > prev.updatedAtMs) {
          merged.set(item.sessionId, item);
        }
      }
    } catch {
      /* 磁盘索引为后台补全，单条候选失败不影响主流程 */
    }
  }

  const disk = [...merged.values()].sort((a, b) => b.updatedAtMs - a.updatedAtMs);
  return { disk, listingPath: primary };
}
