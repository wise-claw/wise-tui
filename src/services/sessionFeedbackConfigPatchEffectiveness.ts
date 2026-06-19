import {
  attachSessionFeedbackPatchScoresDb,
  insertSessionFeedbackPatchEffectivenessBatchDb,
  listSessionFeedbackPatchEffectivenessDb,
} from "./sessionFeedbackLoopDb";
import { ensureFeedbackLoopHistoryHydrated } from "./sessionFeedbackLoopHistoryStore";

import type {
  FeedbackConfigArtifactKind,
  FeedbackConfigOverheadDelta,
  FeedbackConfigPatch,
} from "../utils/sessionFeedbackConfigPatch";

const STORAGE_KEY = "wise.sessionFeedbackLoop.patchEffectiveness.v1";
const MAX_RECORDS = 200;

let patchCache: PatchEffectivenessRecord[] | null = null;

export interface PatchEffectivenessRecord {
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

export interface PatchKindEffectivenessSummary {
  kind: FeedbackConfigArtifactKind;
  count: number;
  avgSessionScore: number | null;
  avgRulesDelta: number | null;
  score: number;
}

function normalizePath(path: string): string {
  return path.trim().replace(/\\/g, "/").replace(/\/$/, "");
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

function loadAll(): PatchEffectivenessRecord[] {
  if (patchCache) return patchCache;
  return loadAllPatchEffectivenessRecordsLocal();
}

export function loadAllPatchEffectivenessRecordsLocal(): PatchEffectivenessRecord[] {
  const storage = readStorage();
  if (!storage) return [];
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw?.trim()) return [];
    const parsed = JSON.parse(raw) as PatchEffectivenessRecord[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveAll(records: PatchEffectivenessRecord[]): void {
  const storage = readStorage();
  patchCache = records.slice(0, MAX_RECORDS);
  if (!storage) return;
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(patchCache));
  } catch {
    /* quota */
  }
}

async function refreshPatchCacheFromDb(repositoryPath?: string | null): Promise<void> {
  await ensureFeedbackLoopHistoryHydrated();
  const rows = await listSessionFeedbackPatchEffectivenessDb(repositoryPath, MAX_RECORDS);
  if (rows.length > 0) {
    patchCache = rows;
    const storage = readStorage();
    storage?.setItem(STORAGE_KEY, JSON.stringify(patchCache));
  }
}

export function recordPatchApplyBatch(input: {
  repositoryPath: string;
  appliedPatches: readonly FeedbackConfigPatch[];
  overheadDelta?: FeedbackConfigOverheadDelta | null;
}): void {
  const repo = normalizePath(input.repositoryPath);
  if (!repo || input.appliedPatches.length === 0) return;

  const entries: PatchEffectivenessRecord[] = input.appliedPatches
    .filter((p) => p.status === "applied")
    .map((patch) => ({
      id: `pe-${Date.now()}-${patch.id}`,
      repositoryPath: repo,
      kind: patch.kind,
      action: patch.action,
      path: patch.path,
      source: patch.source,
      appliedAt: patch.appliedAt ?? Date.now(),
      overheadDelta: input.overheadDelta ?? undefined,
    }));

  if (entries.length === 0) return;
  saveAll([...entries, ...loadAll()]);
  void insertSessionFeedbackPatchEffectivenessBatchDb(entries);
}

export function attachSessionScoreToRecentPatchRecords(input: {
  repositoryPath: string;
  sessionFinalScore: number | null;
  withinMs?: number;
}): void {
  const repo = normalizePath(input.repositoryPath);
  if (!repo || input.sessionFinalScore == null || !Number.isFinite(input.sessionFinalScore)) return;
  const cutoff = Date.now() - (input.withinMs ?? 30 * 60_000);
  const all = loadAll();
  let changed = false;
  const next = all.map((record) => {
    if (normalizePath(record.repositoryPath) !== repo) return record;
    if (record.appliedAt < cutoff) return record;
    if (record.sessionFinalScore != null) return record;
    changed = true;
    return { ...record, sessionFinalScore: input.sessionFinalScore };
  });
  if (changed) saveAll(next);
  if (changed && input.sessionFinalScore != null) {
    void attachSessionFeedbackPatchScoresDb({
      repositoryPath: repo,
      sessionFinalScore: input.sessionFinalScore,
      withinMs: input.withinMs,
    });
  }
}

export function rankPatchKindEffectiveness(
  repositoryPath?: string | null,
  limit = 4,
): PatchKindEffectivenessSummary[] {
  void refreshPatchCacheFromDb(repositoryPath);
  const path = repositoryPath?.trim() ? normalizePath(repositoryPath) : "";
  const records = loadAll().filter((r) => !path || normalizePath(r.repositoryPath) === path);

  const byKind = new Map<FeedbackConfigArtifactKind, PatchEffectivenessRecord[]>();
  for (const record of records) {
    const list = byKind.get(record.kind) ?? [];
    list.push(record);
    byKind.set(record.kind, list);
  }

  const summaries: PatchKindEffectivenessSummary[] = [];
  for (const [kind, list] of byKind) {
    const scores = list
      .map((r) => r.sessionFinalScore)
      .filter((s): s is number => s != null && Number.isFinite(s));
    const rulesDeltas = list
      .map((r) => r.overheadDelta?.rules)
      .filter((d): d is number => d != null && Number.isFinite(d));

    const avgSessionScore =
      scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : null;
    const avgRulesDelta =
      rulesDeltas.length > 0 ? rulesDeltas.reduce((a, b) => a + b, 0) / rulesDeltas.length : null;

    const score =
      (avgSessionScore ?? 0) * 0.6 + (avgRulesDelta != null ? -avgRulesDelta * 0.04 : 0);

    summaries.push({
      kind,
      count: list.length,
      avgSessionScore,
      avgRulesDelta,
      score,
    });
  }

  return summaries.sort((a, b) => b.score - a.score).slice(0, limit);
}

export function formatPatchKindEffectivenessHint(
  summaries: readonly PatchKindEffectivenessSummary[],
): string | null {
  if (summaries.length === 0) return null;
  return summaries
    .map((s) => {
      const scorePart =
        s.avgSessionScore != null ? `均分 ${s.avgSessionScore.toFixed(1)}` : "均分 —";
      return `${s.kind} (n=${s.count}, ${scorePart})`;
    })
    .join(" · ");
}
