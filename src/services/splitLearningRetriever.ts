import type { TaskSplitFeedbackTagId } from "../constants/taskSplitFeedback";
import type { SplitLearningSample } from "./splitLearningSample";

type LearningSource = "split_learning_sample";

interface SplitLearningRetrieverInput {
  prdFingerprint?: string;
  feedbackTags: TaskSplitFeedbackTagId[];
  topK: number;
}

export interface SplitLearningRetrievedItem {
  score: number;
  runId: string;
  at: string;
  source: LearningSource;
  prdFingerprint?: string;
  feedbackTags: TaskSplitFeedbackTagId[];
  badSplitSummary: string;
  fixedSplitSummary: string;
  whyItFailed: string;
  whyItWorked: string;
}

export function retrieveSplitLearningTopK(
  jsonl: string,
  input: SplitLearningRetrieverInput,
): SplitLearningRetrievedItem[] {
  const rows = parseSplitLearningSamples(jsonl);
  const sorted = rows
    .map((row, index) => ({
      row,
      index,
      score: scoreSplitLearningRow(row, input.prdFingerprint, input.feedbackTags),
    }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => {
      if (a.score !== b.score) return b.score - a.score;
      const timeDiff = parseIsoTimeMs(b.row.at) - parseIsoTimeMs(a.row.at);
      if (timeDiff !== 0) return timeDiff;
      const runIdCmp = a.row.runId.localeCompare(b.row.runId);
      if (runIdCmp !== 0) return runIdCmp;
      return a.index - b.index;
    });
  return sorted.slice(0, Math.max(0, input.topK)).map((entry) => ({
    score: entry.score,
    runId: entry.row.runId,
    at: entry.row.at,
    source: "split_learning_sample",
    prdFingerprint: entry.row.prdFingerprint,
    feedbackTags: entry.row.feedbackTags,
    badSplitSummary: entry.row.badSplitSummary,
    fixedSplitSummary: entry.row.fixedSplitSummary,
    whyItFailed: entry.row.whyItFailed,
    whyItWorked: entry.row.whyItWorked,
  }));
}

function parseSplitLearningSamples(jsonl: string): SplitLearningSample[] {
  const records: SplitLearningSample[] = [];
  for (const line of jsonl.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const row = JSON.parse(trimmed) as SplitLearningSample;
      if (!isValidSplitLearningSample(row)) continue;
      records.push(row);
    } catch {
      // ignore malformed lines
    }
  }
  return records;
}

function isValidSplitLearningSample(value: unknown): value is SplitLearningSample {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  if (row.version !== 1) return false;
  if (typeof row.runId !== "string" || row.runId.trim().length === 0) return false;
  if (typeof row.at !== "string" || row.at.trim().length === 0) return false;
  if (!Array.isArray(row.feedbackTags)) return false;
  if (typeof row.badSplitSummary !== "string") return false;
  if (typeof row.fixedSplitSummary !== "string") return false;
  if (typeof row.whyItFailed !== "string") return false;
  if (typeof row.whyItWorked !== "string") return false;
  return true;
}

function scoreSplitLearningRow(
  row: SplitLearningSample,
  prdFingerprint: string | undefined,
  feedbackTags: TaskSplitFeedbackTagId[],
): number {
  const rowFingerprint = row.prdFingerprint?.trim();
  const targetFingerprint = prdFingerprint?.trim();
  const fingerprintScore = rowFingerprint && targetFingerprint && rowFingerprint === targetFingerprint ? 1000 : 0;
  const rowTagSet = new Set(row.feedbackTags);
  const hitTags = feedbackTags.filter((tag) => rowTagSet.has(tag)).length;
  const tagScore = hitTags * 100;
  return fingerprintScore + tagScore;
}

function parseIsoTimeMs(value: string): number {
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : 0;
}
