import type { SessionExecutionEngine } from "../constants/sessionExecutionEngine";
import { SESSION_EXECUTION_ENGINE_LABELS } from "../constants/sessionExecutionEngine";
import type { ClaudeSession } from "../types";
import {
  parseDispatchRecord,
  parseDispatchRecordDisplayTimeMs,
  systemMessagePlainText,
  type DispatchRecordMeta,
} from "./claudeChatMessageDisplay";
import {
  isExecutionEnvironmentWorkerRepositoryName,
  parseExecutionEnvironmentWorkerRepositoryName,
} from "./executionEnvironmentDispatch";
import { sessionMatchesRepositoryScope } from "./repositoryMainSessionBinding";
import {
  getExecutionEnvironmentDispatchesSnapshotForAnchor,
  mergeExecutionEnvironmentDispatchesForAnchor,
  type ExecutionEnvironmentDispatchRecord,
} from "../stores/executionEnvironmentDispatchStore";

function executionEngineFromDispatchMeta(meta: DispatchRecordMeta): SessionExecutionEngine {
  const label = `${meta.engineName ?? ""} ${meta.targetName ?? ""}`.trim();
  if (label.includes(SESSION_EXECUTION_ENGINE_LABELS.opencode.title)) return "opencode";
  if (label.includes(SESSION_EXECUTION_ENGINE_LABELS.gemini.title)) return "gemini";
  if (label.includes(SESSION_EXECUTION_ENGINE_LABELS.codex.title)) return "codex";
  if (label.includes(SESSION_EXECUTION_ENGINE_LABELS.cursor.title)) return "cursor";
  return "claude";
}

function dispatchCreatedAtMs(meta: DispatchRecordMeta, fallback: number): number {
  return parseDispatchRecordDisplayTimeMs(meta.dispatchTime) ?? fallback;
}

function findWorkersForRehydratedBatch(input: {
  repositoryPath: string;
  executionEngine: SessionExecutionEngine;
  sessionCount: number;
  previewText: string;
  createdAtMs: number;
  sessions: readonly ClaudeSession[];
}): ClaudeSession[] {
  const windowMs = 15 * 60 * 1000;
  const preview = input.previewText.trim();
  return input.sessions
    .filter((session) => {
      if (!sessionMatchesRepositoryScope(session, input.repositoryPath)) return false;
      if (!isExecutionEnvironmentWorkerRepositoryName(session.repositoryName ?? "")) return false;
      const parsed = parseExecutionEnvironmentWorkerRepositoryName(session.repositoryName ?? "");
      if (parsed?.engine && parsed.engine !== input.executionEngine) return false;
      const firstMessageAt = session.messages[0]?.timestamp ?? 0;
      if (firstMessageAt > 0 && Math.abs(firstMessageAt - input.createdAtMs) > windowMs) {
        return false;
      }
      if (preview) {
        const userText = session.messages.find((message) => message.role === "user")?.content ?? "";
        if (userText && !userText.includes(preview.slice(0, Math.min(preview.length, 24)))) {
          return false;
        }
      }
      return true;
    })
    .slice(0, Math.max(1, input.sessionCount));
}

function recordFromDispatchMeta(input: {
  meta: DispatchRecordMeta;
  anchorSessionId: string;
  repositoryPath: string;
  sessions: readonly ClaudeSession[];
}): ExecutionEnvironmentDispatchRecord | null {
  const batchId = input.meta.dispatchBatchId?.trim();
  if (!batchId) return null;
  if (input.meta.dispatchType?.trim() !== "执行环境") return null;

  const previewText = input.meta.dispatchContent?.trim() || "（无正文）";
  const createdAt = dispatchCreatedAtMs(input.meta, Date.now());
  const executionEngine = executionEngineFromDispatchMeta(input.meta);
  const sessionCount = Math.max(
    1,
    findWorkersForRehydratedBatch({
      repositoryPath: input.repositoryPath,
      executionEngine,
      sessionCount: 12,
      previewText,
      createdAtMs: createdAt,
      sessions: input.sessions,
    }).length,
  );

  const workers = findWorkersForRehydratedBatch({
    repositoryPath: input.repositoryPath,
    executionEngine,
    sessionCount,
    previewText,
    createdAtMs: createdAt,
    sessions: input.sessions,
  });

  const items =
    workers.length > 0
      ? workers.map((worker, index) => ({
          key: `exec-env:${batchId}:${worker.id}`,
          batchId,
          anchorSessionId: input.anchorSessionId,
          workerSessionId: worker.id,
          label: workers.length > 1 ? `任务 ${index + 1}` : "任务",
          previewText,
          batchIndex: index + 1,
          sessionCount: workers.length,
          updatedAt:
            (worker.messages.length > 0
              ? worker.messages[worker.messages.length - 1]?.timestamp
              : undefined) ?? createdAt,
        }))
      : [
          {
            key: `exec-env:${batchId}:rehydrated`,
            batchId,
            anchorSessionId: input.anchorSessionId,
            workerSessionId: `rehydrated:${batchId}`,
            label: "任务",
            previewText,
            batchIndex: 1,
            sessionCount: 1,
            updatedAt: createdAt,
          },
        ];

  return {
    batchId,
    anchorSessionId: input.anchorSessionId,
    repositoryPath: input.repositoryPath,
    executionEngine,
    createdAt,
    items,
  };
}

/** 从主会话系统消息回填派发 store（刷新 transcript / 持久化缺失时的兜底）。 */
export function rehydrateExecutionEnvironmentDispatchesFromAnchorSession(
  anchorSession: ClaudeSession | null | undefined,
  sessions: readonly ClaudeSession[],
): void {
  const anchorId = anchorSession?.id.trim();
  if (!anchorId || !anchorSession) return;

  const repositoryPath = anchorSession.repositoryPath?.trim();
  if (!repositoryPath) return;

  const existing = getExecutionEnvironmentDispatchesSnapshotForAnchor(anchorId);
  const existingBatchIds = new Set(existing.map((record) => record.batchId));

  const rehydrated: ExecutionEnvironmentDispatchRecord[] = [];
  for (const message of anchorSession.messages) {
    if (message.role !== "system") continue;
    const text = systemMessagePlainText(message);
    const meta = parseDispatchRecord(text);
    if (!meta?.dispatchBatchId?.trim()) continue;
    if (meta.dispatchType?.trim() !== "执行环境") continue;
    if (existingBatchIds.has(meta.dispatchBatchId.trim())) continue;

    const record = recordFromDispatchMeta({
      meta,
      anchorSessionId: anchorId,
      repositoryPath,
      sessions,
    });
    if (record) {
      rehydrated.push(record);
      existingBatchIds.add(record.batchId);
    }
  }

  if (rehydrated.length === 0) return;
  mergeExecutionEnvironmentDispatchesForAnchor(anchorId, rehydrated);
}
