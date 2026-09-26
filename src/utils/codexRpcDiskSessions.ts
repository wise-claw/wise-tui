import type { ClaudeSession, CodexRpcDiskSessionItem } from "../types";
import { listCodexRpcDiskSessions } from "../services/claudeDisk";
import { pathIsAccessibleDirectoryCached } from "./pathAccessibilityCache";
import { normalizeRepositoryPathKey, repositoryPathsMatch } from "./repositoryMainSessionBinding";
import {
  collectRepositoryPathListingCandidates,
  normalizeSessionRepositoryPath,
} from "./sessionHistoryScope";

function sessionMatchesCodexRpcTabId(
  session: Pick<ClaudeSession, "id" | "claudeSessionId">,
  tabId: string,
): boolean {
  return session.id === tabId;
}

/**
 * 合并 Wise 自己落在 `~/.wise/codex-runs` 的会话索引。
 *
 * 这些会话不会出现在外部 `~/.codex/sessions` 原生索引（originator=wise 被跳过），
 * 也不在 `~/.claude/projects`。若不并入侧栏，刷新后只剩空「新会话」壳。
 *
 * - 命中既有行：补 `diskPreview` / `claudeSessionId`（thread id），不改 tab id；
 * - 新建行：绑定 `executionEngine: "codex-rpc"`，点开即可用 Codex RPC 续接并 hydrate。
 */
export function mergeCodexRpcDiskSessions(
  prev: ClaudeSession[],
  repositoryPath: string,
  repositoryName: string,
  disk: ReadonlyArray<CodexRpcDiskSessionItem>,
  configFallbackModel: string,
): ClaudeSession[] {
  const canonicalPath = normalizeRepositoryPathKey(repositoryPath) || repositoryPath.trim();
  const copy: ClaudeSession[] = [];

  for (const session of prev) {
    if (!repositoryPathsMatch(session.repositoryPath, canonicalPath)) {
      copy.push(session);
      continue;
    }
    const item = disk.find((entry) => sessionMatchesCodexRpcTabId(session, entry.sessionId));
    if (!item) {
      copy.push(session);
      continue;
    }
    const resumeId = item.resumeSessionId?.trim() || "";
    copy.push({
      ...session,
      repositoryPath: canonicalPath,
      model: item.modelHint?.trim() || session.model || configFallbackModel,
      diskPreview: item.preview.trim() || session.diskPreview,
      claudeSessionId: resumeId || session.claudeSessionId,
      executionEngine: session.executionEngine ?? "codex-rpc",
      // 磁盘有完整 transcript：未全量进内存的行标 partial，切回时强制 hydrate 覆盖流式残片。
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
            sessionMatchesCodexRpcTabId(session, entry.sessionId),
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
    pendingPrompt: "",
    diskPreview: entry.preview.trim() || "",
    executionEngine: "codex-rpc",
    diskTranscriptPartial: true,
  }));

  let lastIdx = -1;
  for (let i = 0; i < copy.length; i += 1) {
    if (repositoryPathsMatch(copy[i]!.repositoryPath, canonicalPath)) lastIdx = i;
  }
  if (lastIdx === -1) return [...copy, ...newRows];
  return [...copy.slice(0, lastIdx + 1), ...newRows, ...copy.slice(lastIdx + 1)];
}

/**
 * 按候选路径扫描 Wise Codex RPC 落盘索引（兼容路径写法差异）。
 * 尽力而为：单条候选失败时跳过。
 */
export async function listCodexRpcDiskSessionsForRepositoryScope(
  repositoryPath: string,
  existingSessions: ReadonlyArray<ClaudeSession>,
): Promise<{ disk: CodexRpcDiskSessionItem[]; listingPath: string }> {
  const candidates = collectRepositoryPathListingCandidates(repositoryPath, existingSessions);
  const primary = normalizeSessionRepositoryPath(repositoryPath);
  const merged = new Map<string, CodexRpcDiskSessionItem>();

  for (const candidate of candidates) {
    if (!(await pathIsAccessibleDirectoryCached(candidate))) continue;
    try {
      const chunk = await listCodexRpcDiskSessions(candidate);
      for (const item of chunk) {
        const prev = merged.get(item.sessionId);
        if (!prev || item.updatedAtMs > prev.updatedAtMs) {
          merged.set(item.sessionId, item);
        }
      }
    } catch {
      /* Wise 落盘索引为后台补全，单条候选失败不影响主流程 */
    }
  }

  const disk = [...merged.values()].sort((a, b) => b.updatedAtMs - a.updatedAtMs);
  return { disk, listingPath: primary };
}
