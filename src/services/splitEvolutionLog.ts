import type { TaskSplitFeedbackTagId } from "../constants/taskSplitFeedback";
import { appendWiseRelativeFile } from "./materializePrdSnapshot";

export const SPLIT_EVOLUTION_LOG_REL_PATH = "prd-split-evolution.jsonl";

export type SplitEvolutionLogKind =
  | "deepen_request"
  | "deepen_success"
  | "deepen_mapping_rejected"
  | "deepen_failed"
  | "deepen_template_promoted"
  | "deepen_template_holdback";

/** 写入用户目录 `~/.wise/prd-split-evolution.jsonl` 的单行记录（JSON Lines）。 */
export interface SplitEvolutionLogRecord {
  version: 1;
  kind: SplitEvolutionLogKind;
  at: string;
  prdFingerprint?: string;
  runId?: string;
  prdTitle?: string;
  taskCount?: number;
  refineMode?: "full" | "delta";
  deltaPlanSize?: {
    affectedRequirements: number;
    affectedTaskIds: number;
    boundaryTaskIds: number;
  } | null;
  feedbackTags: TaskSplitFeedbackTagId[];
  feedbackNote: string;
  /** 校验失败时附带，便于后续分析 */
  validationMessages?: string[];
  /** 执行失败时附带 */
  failureCode?: string;
  failureReason?: string;
  /** 本轮深化使用的提示词模板 hash（用于归因与回溯）。 */
  promptTemplateHash?: string;
  /** 结构化任务 JSON 的 Schema 门禁模式（严格/宽松）。 */
  schemaGateMode?: "lenient" | "strict";
  /** 深化前后质量评分对比（分值越高越好）。 */
  qualityScore?: {
    before: number;
    after?: number;
    delta?: number;
  };
  /** 本轮召回命中的学习样本 runId（用于效果归因）。 */
  recalledSampleRunIds?: string[];
}

export async function appendSplitEvolutionLog(_repositoryPath: string, record: SplitEvolutionLogRecord): Promise<void> {
  const line = `${JSON.stringify(record)}\n`;
  await appendWiseRelativeFile(SPLIT_EVOLUTION_LOG_REL_PATH, line);
}

export interface EvolutionLogNotifyApi {
  info: (content: string) => void;
}

/** 创建「失败只提示一次」的进化日志写入器，不阻断主流程。 */
export function createSafeSplitEvolutionLogger(notify: EvolutionLogNotifyApi) {
  let hasNotifiedFailure = false;

  function resetRound() {
    hasNotifiedFailure = false;
  }

  function append(repositoryPath: string, record: SplitEvolutionLogRecord) {
    void appendSplitEvolutionLog(repositoryPath, record).catch((err) => {
      if (hasNotifiedFailure) return;
      hasNotifiedFailure = true;
      const detail = err instanceof Error ? err.message : String(err);
      notify.info(`进化日志写入失败（不影响当前流程）：${detail}`);
    });
  }

  return { resetRound, append };
}
