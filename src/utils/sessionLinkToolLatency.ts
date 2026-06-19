import type { SessionLinkRecord } from "../types/sessionLink";

const MAX_TOOL_DURATION_MS = 30 * 60_000;
const MIN_DUPLICATE_READ_COUNT = 3;

export interface SessionToolLatencySample {
  name: string;
  durationMs: number;
  turnIndex: number;
}

export interface SessionToolLatencyHotspot {
  name: string;
  count: number;
  totalDurationMs: number;
  avgDurationMs: number;
  p95DurationMs: number | null;
  maxDurationMs: number;
  turns: number[];
}

export interface SessionDuplicateReadPath {
  path: string;
  count: number;
  turns: number[];
}

function percentile(values: number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, idx)] ?? null;
}

function extractToolNameFromRecord(record: SessionLinkRecord): string {
  const head = record.summary.split("·")[0]?.trim();
  return head || record.summary.trim() || "tool";
}

function normalizeReadPath(path: string): string {
  return path.trim().replace(/\\/g, "/");
}

/** 从 tool_use 的 detail 块解析 Read/Glob 目标路径。 */
export function extractToolTargetPathFromDetail(detail?: string): string | null {
  if (!detail?.trim()) return null;
  const inputMatch = detail.match(/^input:\s*\n([\s\S]*?)(?:\n\n---|\n*$)/);
  if (!inputMatch?.[1]?.trim()) return null;
  try {
    const obj = JSON.parse(inputMatch[1].trim()) as Record<string, unknown>;
    const candidate = obj.file_path ?? obj.path ?? obj.target_file ?? obj.pattern;
    if (typeof candidate === "string" && candidate.trim()) {
      return normalizeReadPath(candidate);
    }
  } catch {
    /* ignore malformed tool input */
  }
  return null;
}

/** 配对 tool_use / tool_result，计算墙钟耗时样本。 */
export function computeToolLatencySamples(
  records: readonly SessionLinkRecord[],
): SessionToolLatencySample[] {
  const pending = new Map<
    string,
    { timestampMs: number; turnIndex: number; name: string; detail?: string }
  >();

  for (const record of records) {
    if (record.kind === "tool_use" && record.toolUseId) {
      pending.set(record.toolUseId, {
        timestampMs: record.timestampMs,
        turnIndex: record.turnIndex,
        name: extractToolNameFromRecord(record),
        detail: record.detail,
      });
    }
  }

  const samples: SessionToolLatencySample[] = [];
  for (const record of records) {
    if (record.kind !== "tool_result" || !record.toolUseId) continue;
    const use = pending.get(record.toolUseId);
    if (!use) continue;
    const durationMs = record.timestampMs - use.timestampMs;
    if (durationMs <= 0 || durationMs > MAX_TOOL_DURATION_MS) continue;
    samples.push({
      name: use.name,
      durationMs,
      turnIndex: use.turnIndex,
    });
  }
  return samples;
}

export function aggregateToolLatencyHotspots(
  samples: readonly SessionToolLatencySample[],
  limit = 6,
): SessionToolLatencyHotspot[] {
  const byName = new Map<string, { durations: number[]; turns: Set<number> }>();
  for (const sample of samples) {
    const entry = byName.get(sample.name) ?? { durations: [], turns: new Set<number>() };
    entry.durations.push(sample.durationMs);
    entry.turns.add(sample.turnIndex);
    byName.set(sample.name, entry);
  }

  return [...byName.entries()]
    .map(([name, { durations, turns }]) => {
      const totalDurationMs = durations.reduce((a, b) => a + b, 0);
      return {
        name,
        count: durations.length,
        totalDurationMs,
        avgDurationMs: totalDurationMs / durations.length,
        p95DurationMs: percentile(durations, 95),
        maxDurationMs: Math.max(...durations),
        turns: [...turns].sort((a, b) => a - b),
      };
    })
    .sort((a, b) => b.p95DurationMs ?? b.maxDurationMs - (a.p95DurationMs ?? a.maxDurationMs))
    .slice(0, limit);
}

/** 检测同路径 Read 重复调用（≥3 次）。 */
export function detectDuplicateReadPaths(
  records: readonly SessionLinkRecord[],
  minCount = MIN_DUPLICATE_READ_COUNT,
): SessionDuplicateReadPath[] {
  const pending = new Map<string, { turnIndex: number; name: string; detail?: string }>();
  const pathCounts = new Map<string, { count: number; turns: Set<number> }>();

  for (const record of records) {
    if (record.kind === "tool_use" && record.toolUseId) {
      pending.set(record.toolUseId, {
        turnIndex: record.turnIndex,
        name: extractToolNameFromRecord(record),
        detail: record.detail,
      });
      continue;
    }
    if (record.kind !== "tool_result" || !record.toolUseId) continue;
    const use = pending.get(record.toolUseId);
    if (!use) continue;
    const toolName = use.name.toLowerCase();
    if (toolName !== "read" && !toolName.startsWith("read ")) continue;
    const path = extractToolTargetPathFromDetail(use.detail);
    if (!path) continue;
    const entry = pathCounts.get(path) ?? { count: 0, turns: new Set<number>() };
    entry.count += 1;
    entry.turns.add(use.turnIndex);
    pathCounts.set(path, entry);
  }

  return [...pathCounts.entries()]
    .filter(([, v]) => v.count >= minCount)
    .map(([path, { count, turns }]) => ({
      path,
      count,
      turns: [...turns].sort((a, b) => a - b),
    }))
    .sort((a, b) => b.count - a.count);
}

export function analyzeSessionLinkToolLatency(records: readonly SessionLinkRecord[]): {
  samples: SessionToolLatencySample[];
  hotspots: SessionToolLatencyHotspot[];
  duplicateReadPaths: SessionDuplicateReadPath[];
} {
  const samples = computeToolLatencySamples(records);
  return {
    samples,
    hotspots: aggregateToolLatencyHotspots(samples),
    duplicateReadPaths: detectDuplicateReadPaths(records),
  };
}
