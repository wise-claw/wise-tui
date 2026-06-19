import type { FeedbackLoopTrendPoint } from "../utils/sessionFeedbackLoop";
import { buildFeedbackLoopTrend, extractFeedbackLoopHabits } from "../utils/sessionFeedbackLoop";
import type { SessionFeedbackLoopState } from "../utils/sessionFeedbackLoop";
import {
  listSessionFeedbackLoopHistoryDb,
  migrateSessionFeedbackLoopLocalStorageToDb,
  upsertSessionFeedbackLoopHistoryDb,
} from "./sessionFeedbackLoopDb";
import { loadAllPatchEffectivenessRecordsLocal } from "./sessionFeedbackConfigPatchEffectiveness";

const HISTORY_KEY = "wise.sessionFeedbackLoop.history.v1";
const MAX_HISTORY = 40;

export interface FeedbackLoopHistoryRecord {
  id: string;
  sessionId: string;
  repositoryPath: string;
  repositoryName?: string;
  claudeSessionId?: string | null;
  completedAt: number;
  completionReason?: SessionFeedbackLoopState["completionReason"];
  cycleCount: number;
  maxCycles: number;
  finalOverallScore: number | null;
  improvedCycles: number;
  finalSummary: string;
  habits: string[];
  trend: FeedbackLoopTrendPoint[];
}

let historyCache: FeedbackLoopHistoryRecord[] | null = null;
let hydratePromise: Promise<void> | null = null;

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

function normalizePath(path: string): string {
  return path.trim().replace(/\\/g, "/").replace(/\/$/, "");
}

function loadAllLocal(): FeedbackLoopHistoryRecord[] {
  const storage = readStorage();
  if (!storage) return [];
  try {
    const raw = storage.getItem(HISTORY_KEY);
    if (!raw?.trim()) return [];
    const parsed = JSON.parse(raw) as FeedbackLoopHistoryRecord[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveAllLocal(records: FeedbackLoopHistoryRecord[]): void {
  const storage = readStorage();
  if (!storage) return;
  try {
    storage.setItem(HISTORY_KEY, JSON.stringify(records.slice(0, MAX_HISTORY)));
  } catch {
    /* quota */
  }
}

function setHistoryCache(records: FeedbackLoopHistoryRecord[]): void {
  historyCache = records.slice(0, MAX_HISTORY);
  saveAllLocal(historyCache);
}

/** 桌面版从 SQLite 水合历史缓存（一次性迁移 localStorage）。 */
export function ensureFeedbackLoopHistoryHydrated(): Promise<void> {
  if (hydratePromise) return hydratePromise;
  hydratePromise = (async () => {
    const local = loadAllLocal();
    await migrateSessionFeedbackLoopLocalStorageToDb({
      historyRecords: local,
      patchRecords: loadAllPatchEffectivenessRecordsLocal(),
    });
    const dbRows = await listSessionFeedbackLoopHistoryDb(null, MAX_HISTORY);
    if (dbRows.length > 0) {
      historyCache = dbRows.slice(0, MAX_HISTORY);
      saveAllLocal(historyCache);
    } else if (local.length > 0) {
      historyCache = local.slice(0, MAX_HISTORY);
    }
  })().catch(() => {
    historyCache = loadAllLocal();
  });
  return hydratePromise;
}

export function archiveFeedbackLoopHistory(input: {
  state: SessionFeedbackLoopState;
  repositoryPath: string;
  repositoryName?: string;
  claudeSessionId?: string | null;
}): FeedbackLoopHistoryRecord {
  const habits = extractFeedbackLoopHabits(input.state);
  const trend = buildFeedbackLoopTrend(input.state.cycles);
  const completed = input.state.cycles.filter((c) => c.comparison != null);
  const last = completed[completed.length - 1]?.comparison;

  const record: FeedbackLoopHistoryRecord = {
    id: `fb-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    sessionId: input.state.sessionId,
    repositoryPath: normalizePath(input.repositoryPath),
    repositoryName: input.repositoryName,
    claudeSessionId: input.claudeSessionId,
    completedAt: Date.now(),
    completionReason: input.state.completionReason,
    cycleCount: completed.length,
    maxCycles: input.state.maxCycles,
    finalOverallScore: last?.overallScore ?? null,
    improvedCycles: completed.filter((c) => c.comparison?.improved).length,
    finalSummary: last?.summary ?? "—",
    habits,
    trend,
  };

  const all = (historyCache ?? loadAllLocal()).filter((r) => r.id !== record.id);
  all.unshift(record);
  setHistoryCache(all);
  void upsertSessionFeedbackLoopHistoryDb(record);
  return record;
}

export function listFeedbackLoopHistory(repositoryPath?: string | null): FeedbackLoopHistoryRecord[] {
  const all = historyCache ?? loadAllLocal();
  const path = repositoryPath?.trim() ? normalizePath(repositoryPath) : "";
  if (!path) return all.slice(0, 8);
  return all.filter((r) => normalizePath(r.repositoryPath) === path).slice(0, 8);
}

export function compareWithHistoryAverage(
  records: readonly FeedbackLoopHistoryRecord[],
  currentScore: number | null,
): { average: number | null; delta: number | null } {
  const scores = records
    .map((r) => r.finalOverallScore)
    .filter((s): s is number => s != null && Number.isFinite(s));
  if (scores.length === 0 || currentScore == null) {
    return { average: null, delta: null };
  }
  const average = scores.reduce((a, b) => a + b, 0) / scores.length;
  return { average, delta: currentScore - average };
}
