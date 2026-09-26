import type { ClaudeSession, NativeCliDiskSessionItem, NativeCliEngine } from "../types";
import type { SessionExecutionEngine } from "../constants/sessionExecutionEngine";
import { listNativeCliDiskSessions } from "../services/nativeCliSessions";
import { pathIsAccessibleDirectoryCached } from "./pathAccessibilityCache";
import { normalizeRepositoryPathKey, repositoryPathsMatch } from "./repositoryMainSessionBinding";
import {
  collectRepositoryPathListingCandidates,
  normalizeSessionRepositoryPath,
} from "./sessionHistoryScope";

/** 原生会话索引对应的 Wise 执行环境。 */
export const NATIVE_CLI_ENGINE_EXECUTION_ENGINE: Record<NativeCliEngine, SessionExecutionEngine> = {
  codex: "codex-rpc",
  deepseek: "deepseek",
};

export const NATIVE_CLI_ENGINE_LABELS: Record<NativeCliEngine, string> = {
  codex: "Codex",
  deepseek: "DeepSeek",
};

export const NATIVE_CLI_ENGINES: readonly NativeCliEngine[] = ["codex", "deepseek"];

function sessionMatchesNativeId(
  session: Pick<ClaudeSession, "id" | "claudeSessionId">,
  sessionId: string,
): boolean {
  return session.id === sessionId || session.claudeSessionId === sessionId;
}

/**
 * 之前由原生索引引入、但磁盘上已不存在的「纯索引占位行」。
 *
 * 有正文、处于运行态、或 tab id 已与原生 session id 分离（Wise 侧已接管转录）的行一律保留，
 * 避免刷新后把正在使用的会话误删。
 */
export function isDroppableNativeCliPlaceholder(
  session: ClaudeSession,
  engine: NativeCliEngine,
  liveSessionIds: ReadonlySet<string>,
): boolean {
  if (session.nativeCliSource !== engine) return false;
  if (session.messages.length > 0) return false;
  if (session.status === "running" || session.status === "connecting") return false;
  const claudeId = session.claudeSessionId?.trim();
  if (claudeId && session.id !== claudeId) return false;
  return !liveSessionIds.has(session.id) && !(claudeId && liveSessionIds.has(claudeId));
}

/**
 * 合并一类原生 CLI 会话索引（Codex / DeepSeek Harness）。
 *
 * 与 `mergeRepositoryDiskSessions` 同构，但：
 * - 命中既有行时只补预览 / 模型 / `claudeSessionId`，并在引擎一致时打上 `nativeCliSource`；
 * - 新建行显式绑定 `executionEngine`，保证点开即可用对应引擎续接；
 * - 不改变既有行的 tab id（避免打断已挂载的流式监听）。
 */
export function mergeNativeCliDiskSessions(
  prev: ClaudeSession[],
  repositoryPath: string,
  repositoryName: string,
  engine: NativeCliEngine,
  disk: ReadonlyArray<NativeCliDiskSessionItem>,
  configFallbackModel: string,
): ClaudeSession[] {
  const canonicalPath = normalizeRepositoryPathKey(repositoryPath) || repositoryPath.trim();
  const expectedEngine = NATIVE_CLI_ENGINE_EXECUTION_ENGINE[engine];
  const liveIds = new Set(disk.map((item) => item.sessionId));
  const copy: ClaudeSession[] = [];

  for (const session of prev) {
    if (!repositoryPathsMatch(session.repositoryPath, canonicalPath)) {
      copy.push(session);
      continue;
    }
    const item = disk.find((entry) => sessionMatchesNativeId(session, entry.sessionId));
    if (!item) {
      if (!isDroppableNativeCliPlaceholder(session, engine, liveIds)) {
        copy.push(session);
      }
      continue;
    }
    const claimsNativeSource =
      session.nativeCliSource === engine || session.executionEngine === expectedEngine;
    copy.push({
      ...session,
      claudeSessionId: item.sessionId,
      repositoryPath: canonicalPath,
      model: item.modelHint?.trim() || session.model,
      diskPreview: item.preview.trim() || item.title?.trim() || session.diskPreview,
      ...(claimsNativeSource ? { nativeCliSource: engine } : {}),
      // 与 Claude 磁盘索引一致：有正文时取更早时间；纯索引占位用磁盘 mtime 当「上次活跃」。
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
            sessionMatchesNativeId(session, entry.sessionId),
        ),
    )
    .sort((a, b) => b.updatedAtMs - a.updatedAtMs);

  if (toAdd.length === 0) return copy;

  const newRows: ClaudeSession[] = toAdd.map((entry) => ({
    id: entry.sessionId,
    claudeSessionId: entry.sessionId,
    repositoryPath: canonicalPath,
    repositoryName,
    model: entry.modelHint?.trim() || configFallbackModel,
    status: "completed" as const,
    messages: [],
    createdAt: entry.updatedAtMs,
    pendingPrompt: "",
    diskPreview: entry.preview.trim() || entry.title?.trim() || "",
    executionEngine: expectedEngine,
    nativeCliSource: engine,
  }));

  // 与 Claude 磁盘索引一致：新行紧跟同仓库最后一行，避免落在其它仓库的会话之后。
  let lastIdx = -1;
  for (let i = 0; i < copy.length; i += 1) {
    if (repositoryPathsMatch(copy[i]!.repositoryPath, canonicalPath)) lastIdx = i;
  }
  if (lastIdx === -1) return [...copy, ...newRows];
  return [...copy.slice(0, lastIdx + 1), ...newRows, ...copy.slice(lastIdx + 1)];
}

/**
 * 按候选路径扫描原生会话索引（兼容路径写法差异导致的编码目录不一致）。
 * 尽力而为：单条候选失败或路径不可访问时跳过，不向上抛错。
 */
export async function listNativeCliDiskSessionsForRepositoryScope(
  engine: NativeCliEngine,
  repositoryPath: string,
  existingSessions: ReadonlyArray<ClaudeSession>,
): Promise<{ disk: NativeCliDiskSessionItem[]; listingPath: string }> {
  const candidates = collectRepositoryPathListingCandidates(repositoryPath, existingSessions);
  const primary = normalizeSessionRepositoryPath(repositoryPath);
  const merged = new Map<string, NativeCliDiskSessionItem>();

  for (const candidate of candidates) {
    if (!(await pathIsAccessibleDirectoryCached(candidate))) continue;
    try {
      const chunk = await listNativeCliDiskSessions(engine, candidate);
      for (const item of chunk) {
        const prev = merged.get(item.sessionId);
        if (!prev || item.updatedAtMs > prev.updatedAtMs) {
          merged.set(item.sessionId, item);
        }
      }
    } catch {
      /* 原生索引为后台补全，单条候选失败不影响主流程 */
    }
  }

  const disk = [...merged.values()].sort((a, b) => b.updatedAtMs - a.updatedAtMs);
  return { disk, listingPath: primary };
}
