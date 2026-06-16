import type { FeedbackLoopTrendPoint } from "../utils/sessionFeedbackLoop";
import { buildFeedbackLoopTrend, extractFeedbackLoopHabits } from "../utils/sessionFeedbackLoop";
import type { SessionFeedbackLoopState } from "../utils/sessionFeedbackLoop";

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

function loadAll(): FeedbackLoopHistoryRecord[] {
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

function saveAll(records: FeedbackLoopHistoryRecord[]): void {
  const storage = readStorage();
  if (!storage) return;
  try {
    storage.setItem(HISTORY_KEY, JSON.stringify(records.slice(0, MAX_HISTORY)));
  } catch {
    /* quota */
  }
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

  const all = loadAll().filter((r) => r.id !== record.id);
  all.unshift(record);
  saveAll(all);
  return record;
}

export function listFeedbackLoopHistory(repositoryPath?: string | null): FeedbackLoopHistoryRecord[] {
  const all = loadAll();
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
