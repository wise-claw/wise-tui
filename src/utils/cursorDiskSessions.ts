import type { ClaudeSession, CursorDiskSessionItem } from "../types";
import { listCursorDiskSessions } from "../services/cursorDisk";
import { pathIsAccessibleDirectoryCached } from "./pathAccessibilityCache";
import { normalizeRepositoryPathKey, repositoryPathsMatch } from "./repositoryMainSessionBinding";
import {
  collectRepositoryPathListingCandidates,
  normalizeSessionRepositoryPath,
} from "./sessionHistoryScope";

function sessionMatchesCursorTabId(
  session: Pick<ClaudeSession, "id" | "claudeSessionId">,
  tabId: string,
): boolean {
  return session.id === tabId;
}

/**
 * 合并 Wise 自己落在 `~/.wise/cursor-runs` 的会话索引。
 *
 * Cursor ACP 原生索引（`~/.cursor/acp-sessions`）只含 agent id / 标题，无完整 UI 转录；
 * Wise 执行过的会话必须靠这里回侧栏，点开即可 hydrate 并续接。
 */
export function mergeCursorDiskSessions(
  prev: ClaudeSession[],
  repositoryPath: string,
  repositoryName: string,
  disk: ReadonlyArray<CursorDiskSessionItem>,
  configFallbackModel: string,
): ClaudeSession[] {
  const canonicalPath = normalizeRepositoryPathKey(repositoryPath) || repositoryPath.trim();
  const copy: ClaudeSession[] = [];

  for (const session of prev) {
    if (!repositoryPathsMatch(session.repositoryPath, canonicalPath)) {
      copy.push(session);
      continue;
    }
    const item = disk.find((entry) => sessionMatchesCursorTabId(session, entry.sessionId));
    if (!item) {
      copy.push(session);
      continue;
    }
    const resumeId = item.resumeSessionId?.trim() || "";
    copy.push({
      ...session,
      repositoryPath: canonicalPath,
      diskUpdatedAtMs: item.updatedAtMs,
      model: item.modelHint?.trim() || session.model || configFallbackModel,
      diskPreview: item.preview.trim() || session.diskPreview,
      claudeSessionId: resumeId || session.claudeSessionId,
      executionEngine: session.executionEngine ?? "cursor",
      diskTranscriptPartial:
        session.transcriptMemoryUnlimited === true
          ? session.diskTranscriptPartial
          : true,
      createdAt:
        session.messages.length > 0
          ? Math.min(session.createdAt, item.updatedAtMs)
          : Math.max(session.createdAt, item.updatedAtMs),
    });
  }

  const toAdd = disk
    .filter(
      (entry) =>
        !copy.some(
          (session) =>
            repositoryPathsMatch(session.repositoryPath, canonicalPath) &&
            sessionMatchesCursorTabId(session, entry.sessionId),
        ),
    )
    .sort((a, b) => b.updatedAtMs - a.updatedAtMs);

  if (toAdd.length === 0) return copy;

  const newRows: ClaudeSession[] = toAdd.map((entry) => ({
    id: entry.sessionId,
    claudeSessionId: entry.resumeSessionId?.trim() || null,
    repositoryPath: canonicalPath,
    repositoryName,
    model: entry.modelHint?.trim() || configFallbackModel,
    status: "completed" as const,
    messages: [],
    createdAt: entry.updatedAtMs,
    diskUpdatedAtMs: entry.updatedAtMs,
    pendingPrompt: "",
    diskPreview: entry.preview.trim() || "",
    executionEngine: "cursor",
    diskTranscriptPartial: true,
  }));

  let lastIdx = -1;
  for (let i = 0; i < copy.length; i += 1) {
    if (repositoryPathsMatch(copy[i]!.repositoryPath, canonicalPath)) lastIdx = i;
  }
  if (lastIdx === -1) return [...copy, ...newRows];
  return [...copy.slice(0, lastIdx + 1), ...newRows, ...copy.slice(lastIdx + 1)];
}

/** 按候选路径扫描 Wise Cursor 落盘索引。 */
export async function listCursorDiskSessionsForRepositoryScope(
  repositoryPath: string,
  existingSessions: ReadonlyArray<ClaudeSession>,
): Promise<{ disk: CursorDiskSessionItem[]; listingPath: string }> {
  const candidates = collectRepositoryPathListingCandidates(repositoryPath, existingSessions);
  const primary = normalizeSessionRepositoryPath(repositoryPath);
  const merged = new Map<string, CursorDiskSessionItem>();

  for (const candidate of candidates) {
    if (!(await pathIsAccessibleDirectoryCached(candidate))) continue;
    try {
      const chunk = await listCursorDiskSessions(candidate);
      for (const item of chunk) {
        const prev = merged.get(item.sessionId);
        if (!prev || item.updatedAtMs > prev.updatedAtMs) {
          merged.set(item.sessionId, item);
        }
      }
    } catch {
      /* Cursor 落盘索引为后台补全，单条候选失败不影响主流程 */
    }
  }

  const disk = [...merged.values()].sort((a, b) => b.updatedAtMs - a.updatedAtMs);
  return { disk, listingPath: primary };
}
