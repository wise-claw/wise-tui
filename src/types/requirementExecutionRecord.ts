export type RequirementExecutionOutcome = "processed" | "incomplete" | "failed" | "cancelled" | "accepted" | "rejected" | "reopened";

export interface RequirementExecutionRecord {
  id: string;
  requirementId: string;
  sessionId: string;
  kind: "execution" | "review";
  outcome: RequirementExecutionOutcome;
  startedAt: number | null;
  finishedAt: number;
  engine: string;
  summary: string;
  files: string[];
}

export const REQUIREMENT_OUTCOME_LABELS: Record<RequirementExecutionOutcome, string> = {
  processed: "已处理，待验收",
  incomplete: "执行结束，未完成需求",
  failed: "执行失败",
  cancelled: "已停止",
  accepted: "验收通过",
  rejected: "验收未通过，继续修改",
  reopened: "重新打开需求",
};
