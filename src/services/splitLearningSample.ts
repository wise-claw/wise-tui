import { invoke } from "@tauri-apps/api/core";
import type { SplitResult } from "../types";
import type { TaskSplitFeedbackTagId } from "../constants/taskSplitFeedback";
import { validateSplitResult } from "./taskSplitValidator";

export const SPLIT_LEARNING_SAMPLE_REL_PATH = ".wise/prd-split-learning-samples.jsonl";

interface SplitLearningSampleRecord {
  version: 1;
  at: string;
  runId: string;
  prdFingerprint?: string;
  feedbackTags: TaskSplitFeedbackTagId[];
  before: SplitResult;
  after: SplitResult;
  badSplitSummary: string;
  fixedSplitSummary: string;
  whyItFailed: string;
  whyItWorked: string;
  promptTemplateHash?: string;
  recalledSampleRunIds?: string[];
  qualityScore?: {
    before: number;
    after: number;
    delta: number;
  };
}

export type SplitLearningSample = SplitLearningSampleRecord;

export interface SplitLearningSampleAppendInput {
  version: 1;
  at: string;
  runId: string;
  prdFingerprint?: string;
  feedbackTags: TaskSplitFeedbackTagId[];
  before: SplitResult;
  after: SplitResult;
  badSplitSummary?: string;
  fixedSplitSummary?: string;
  whyItFailed?: string;
  whyItWorked?: string;
  promptTemplateHash?: string;
  recalledSampleRunIds?: string[];
  qualityScore?: {
    before: number;
    after: number;
    delta: number;
  };
}

export interface SplitLearningSummary {
  sampleCount: number;
  avgErrorReduction: number;
  avgWarningReduction: number;
}

export async function appendSplitLearningSample(
  repositoryPath: string,
  record: SplitLearningSampleAppendInput,
): Promise<void> {
  const payload = `${JSON.stringify(normalizeSplitLearningSampleRecord(record))}\n`;
  await invoke<void>("append_project_relative_file", {
    projectPath: repositoryPath,
    relativePath: SPLIT_LEARNING_SAMPLE_REL_PATH,
    payload,
  });
}

export function summarizeSplitLearningSamples(jsonl: string): SplitLearningSummary {
  let sampleCount = 0;
  let errorDeltaTotal = 0;
  let warningDeltaTotal = 0;
  for (const line of jsonl.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const row = JSON.parse(trimmed) as SplitLearningSampleRecord;
      if (!row.before || !row.after) continue;
      const before = validateSplitResult(row.before);
      const after = validateSplitResult(row.after);
      const beforeErrors = before.hardErrors ?? before.errors ?? [];
      const afterErrors = after.hardErrors ?? after.errors ?? [];
      const beforeWarnings = before.softWarnings ?? before.warnings ?? [];
      const afterWarnings = after.softWarnings ?? after.warnings ?? [];
      sampleCount += 1;
      errorDeltaTotal += (beforeErrors.length - afterErrors.length);
      warningDeltaTotal += (beforeWarnings.length - afterWarnings.length);
    } catch {
      // ignore malformed sample line
    }
  }
  if (sampleCount === 0) {
    return { sampleCount: 0, avgErrorReduction: 0, avgWarningReduction: 0 };
  }
  return {
    sampleCount,
    avgErrorReduction: Number((errorDeltaTotal / sampleCount).toFixed(2)),
    avgWarningReduction: Number((warningDeltaTotal / sampleCount).toFixed(2)),
  };
}

function normalizeSplitLearningSampleRecord(record: SplitLearningSampleAppendInput): SplitLearningSampleRecord {
  const fallbackBadSplitSummary = deriveSplitSummary(record.before);
  const fallbackFixedSplitSummary = deriveSplitSummary(record.after);
  const fallbackWhyItFailed = deriveFailureReason(record.before, record.after);
  const fallbackWhyItWorked = deriveSuccessReason(record.before, record.after);
  return {
    ...record,
    badSplitSummary: normalizeSampleText(record.badSplitSummary, fallbackBadSplitSummary),
    fixedSplitSummary: normalizeSampleText(record.fixedSplitSummary, fallbackFixedSplitSummary),
    whyItFailed: normalizeSampleText(record.whyItFailed, fallbackWhyItFailed),
    whyItWorked: normalizeSampleText(record.whyItWorked, fallbackWhyItWorked),
  };
}

function normalizeSampleText(input: string | undefined, fallback: string): string {
  const trimmed = input?.trim();
  if (trimmed && trimmed.length > 0) return trimmed;
  return fallback;
}

function deriveSplitSummary(result: SplitResult): string {
  const report = validateSplitResult(result);
  const taskCount = result.splitTasks.length;
  const frontend = result.splitTasks.filter((task) => task.role === "frontend").length;
  const backend = result.splitTasks.filter((task) => task.role === "backend").length;
  const document = result.splitTasks.filter((task) => task.role === "document").length;
  const hardErrors = (report.hardErrors ?? report.errors ?? []).length;
  const softWarnings = (report.softWarnings ?? report.warnings ?? []).length;
  return `任务 ${taskCount} 条（前端 ${frontend} / 后端 ${backend} / 文档 ${document}），hardErrors ${hardErrors}，softWarnings ${softWarnings}`;
}

function deriveFailureReason(before: SplitResult, after: SplitResult): string {
  const beforeReport = validateSplitResult(before);
  const afterReport = validateSplitResult(after);
  const beforeErrors = (beforeReport.hardErrors ?? beforeReport.errors ?? []).length;
  const afterErrors = (afterReport.hardErrors ?? afterReport.errors ?? []).length;
  const beforeWarnings = (beforeReport.softWarnings ?? beforeReport.warnings ?? []).length;
  const afterWarnings = (afterReport.softWarnings ?? afterReport.warnings ?? []).length;
  if (afterErrors >= beforeErrors && afterWarnings >= beforeWarnings) {
    return "校验问题未明显下降，需针对依赖、覆盖和 DoD 约束进一步修正。";
  }
  return `初始拆分存在结构或覆盖问题（error ${beforeErrors} / warning ${beforeWarnings}）。`;
}

function deriveSuccessReason(before: SplitResult, after: SplitResult): string {
  const beforeReport = validateSplitResult(before);
  const afterReport = validateSplitResult(after);
  const beforeErrors = (beforeReport.hardErrors ?? beforeReport.errors ?? []).length;
  const afterErrors = (afterReport.hardErrors ?? afterReport.errors ?? []).length;
  const beforeWarnings = (beforeReport.softWarnings ?? beforeReport.warnings ?? []).length;
  const afterWarnings = (afterReport.softWarnings ?? afterReport.warnings ?? []).length;
  return `修复后校验改善：error ${beforeErrors} -> ${afterErrors}，warning ${beforeWarnings} -> ${afterWarnings}。`;
}
