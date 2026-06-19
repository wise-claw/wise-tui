import { invoke, isTauri } from "@tauri-apps/api/core";
import type { FeedbackLoopTrendPoint } from "../utils/sessionFeedbackLoop";
import type {
  FeedbackConfigArtifactKind,
  FeedbackConfigOverheadDelta,
  FeedbackConfigPatch,
} from "../utils/sessionFeedbackConfigPatch";
import type { FeedbackLoopHistoryRecord } from "./sessionFeedbackLoopHistoryStore";
import type { PatchEffectivenessRecord } from "./sessionFeedbackConfigPatchEffectiveness";

const MIGRATION_FLAG = "wise.sessionFeedbackLoop.dbMigrated.v1";

interface FeedbackLoopHistoryRecordDto {
  id: string;
  sessionId: string;
  repositoryPath: string;
  repositoryName?: string;
  claudeSessionId?: string | null;
  completedAt: number;
  completionReason?: string;
  cycleCount: number;
  maxCycles: number;
  finalOverallScore: number | null;
  improvedCycles: number;
  finalSummary: string;
  habits: string[];
  trend: FeedbackLoopTrendPoint[];
}

interface PatchEffectivenessRecordDto {
  id: string;
  repositoryPath: string;
  kind: FeedbackConfigArtifactKind;
  action: FeedbackConfigPatch["action"];
  path: string;
  source: FeedbackConfigPatch["source"];
  appliedAt: number;
  overheadDelta?: FeedbackConfigOverheadDelta;
  sessionFinalScore?: number | null;
}

function historyToDto(record: FeedbackLoopHistoryRecord): FeedbackLoopHistoryRecordDto {
  return {
    id: record.id,
    sessionId: record.sessionId,
    repositoryPath: record.repositoryPath,
    repositoryName: record.repositoryName,
    claudeSessionId: record.claudeSessionId,
    completedAt: record.completedAt,
    completionReason: record.completionReason,
    cycleCount: record.cycleCount,
    maxCycles: record.maxCycles,
    finalOverallScore: record.finalOverallScore,
    improvedCycles: record.improvedCycles,
    finalSummary: record.finalSummary,
    habits: record.habits,
    trend: record.trend,
  };
}

function historyFromDto(dto: FeedbackLoopHistoryRecordDto): FeedbackLoopHistoryRecord {
  return {
    id: dto.id,
    sessionId: dto.sessionId,
    repositoryPath: dto.repositoryPath,
    repositoryName: dto.repositoryName,
    claudeSessionId: dto.claudeSessionId,
    completedAt: dto.completedAt,
    completionReason: dto.completionReason as FeedbackLoopHistoryRecord["completionReason"],
    cycleCount: dto.cycleCount,
    maxCycles: dto.maxCycles,
    finalOverallScore: dto.finalOverallScore,
    improvedCycles: dto.improvedCycles,
    finalSummary: dto.finalSummary,
    habits: dto.habits ?? [],
    trend: Array.isArray(dto.trend) ? dto.trend : [],
  };
}

function patchToDto(record: PatchEffectivenessRecord): PatchEffectivenessRecordDto {
  return {
    id: record.id,
    repositoryPath: record.repositoryPath,
    kind: record.kind,
    action: record.action,
    path: record.path,
    source: record.source,
    appliedAt: record.appliedAt,
    overheadDelta: record.overheadDelta,
    sessionFinalScore: record.sessionFinalScore,
  };
}

function patchFromDto(dto: PatchEffectivenessRecordDto): PatchEffectivenessRecord {
  return {
    id: dto.id,
    repositoryPath: dto.repositoryPath,
    kind: dto.kind,
    action: dto.action,
    path: dto.path,
    source: dto.source,
    appliedAt: dto.appliedAt,
    overheadDelta: dto.overheadDelta,
    sessionFinalScore: dto.sessionFinalScore,
  };
}

function readStorage(): Storage | null {
  try {
    if (typeof window !== "undefined" && window.localStorage) return window.localStorage;
    if (typeof globalThis !== "undefined" && "localStorage" in globalThis) {
      return globalThis.localStorage as Storage;
    }
  } catch {
    /* ignore */
  }
  return null;
}

export async function migrateSessionFeedbackLoopLocalStorageToDb(input: {
  historyRecords: readonly FeedbackLoopHistoryRecord[];
  patchRecords: readonly PatchEffectivenessRecord[];
}): Promise<void> {
  if (!isTauri()) return;
  const storage = readStorage();
  if (storage?.getItem(MIGRATION_FLAG) === "1") return;

  if (input.historyRecords.length > 0) {
    for (const record of input.historyRecords) {
      await invoke("upsert_session_feedback_loop_history", { record: historyToDto(record) });
    }
  }
  if (input.patchRecords.length > 0) {
    await invoke("insert_session_feedback_patch_effectiveness_batch", {
      records: input.patchRecords.map(patchToDto),
    });
  }
  storage?.setItem(MIGRATION_FLAG, "1");
}

export async function upsertSessionFeedbackLoopHistoryDb(
  record: FeedbackLoopHistoryRecord,
): Promise<void> {
  if (!isTauri()) return;
  await invoke("upsert_session_feedback_loop_history", { record: historyToDto(record) });
}

export async function listSessionFeedbackLoopHistoryDb(
  repositoryPath?: string | null,
  limit = 40,
): Promise<FeedbackLoopHistoryRecord[]> {
  if (!isTauri()) return [];
  const rows = await invoke<FeedbackLoopHistoryRecordDto[]>("list_session_feedback_loop_history", {
    repositoryPath: repositoryPath?.trim() || null,
    limit,
  });
  return rows.map(historyFromDto);
}

export async function insertSessionFeedbackPatchEffectivenessBatchDb(
  records: readonly PatchEffectivenessRecord[],
): Promise<void> {
  if (!isTauri() || records.length === 0) return;
  await invoke("insert_session_feedback_patch_effectiveness_batch", {
    records: records.map(patchToDto),
  });
}

export async function listSessionFeedbackPatchEffectivenessDb(
  repositoryPath?: string | null,
  limit = 200,
): Promise<PatchEffectivenessRecord[]> {
  if (!isTauri()) return [];
  const rows = await invoke<PatchEffectivenessRecordDto[]>("list_session_feedback_patch_effectiveness", {
    repositoryPath: repositoryPath?.trim() || null,
    limit,
  });
  return rows.map(patchFromDto);
}

export async function attachSessionFeedbackPatchScoresDb(input: {
  repositoryPath: string;
  sessionFinalScore: number;
  withinMs?: number;
}): Promise<void> {
  if (!isTauri()) return;
  await invoke("attach_session_feedback_patch_scores", {
    repositoryPath: input.repositoryPath,
    sessionFinalScore: input.sessionFinalScore,
    withinMs: input.withinMs ?? 30 * 60_000,
  });
}
