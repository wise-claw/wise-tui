import type {
  ExecutionFanoutLoopStageKey,
  ExecutionFanoutSnapshot,
} from "../../services/prdSplit/executionFanout";

export type RequirementAssistantStageKey =
  | "write"
  | "draft"
  | "split"
  | "review"
  | "plan"
  | "run"
  | "verify"
  | "spec";
export type RequirementAssistantStageStatus = "waiting" | "active" | "done" | "failed";

export interface RequirementAssistantStageItem {
  key: RequirementAssistantStageKey;
  label: string;
  status: RequirementAssistantStageStatus;
}

export function buildRequirementAssistantStageItems(input: {
  hasInput: boolean;
  parsing: boolean;
  hasPlannedSummary: boolean;
  hasResult: boolean;
  allTasksConfirmed: boolean;
  hasMaterializedResult: boolean;
  executionStatus: ExecutionFanoutSnapshot["status"] | null;
}): RequirementAssistantStageItem[] {
  const order: Array<Pick<RequirementAssistantStageItem, "key" | "label">> = [
    { key: "write", label: "写需求" },
    { key: "draft", label: "生成草案" },
    { key: "split", label: "任务生成" },
    { key: "review", label: "复核任务" },
    { key: "plan", label: "执行计划" },
    { key: "run", label: requirementExecutionStageLabel(input.executionStatus, input.hasMaterializedResult, "run") },
    { key: "verify", label: requirementExecutionStageLabel(input.executionStatus, input.hasMaterializedResult, "verify") },
    { key: "spec", label: requirementExecutionStageLabel(input.executionStatus, input.hasMaterializedResult, "spec") },
  ];
  const activeKey: RequirementAssistantStageKey | null = input.executionStatus === "succeeded"
    ? "verify"
    : input.executionStatus === "running" || input.executionStatus === "failed" || input.hasMaterializedResult
      ? "run"
      : input.parsing
        ? "split"
        : input.allTasksConfirmed
          ? "plan"
          : input.hasResult
            ? "review"
            : input.hasPlannedSummary
              ? "split"
              : input.hasInput
                ? "draft"
                : "write";
  const activeIndex = activeKey ? order.findIndex((item) => item.key === activeKey) : order.length;
  return order.map((item, index) => ({
    ...item,
    status: item.key === "run" && input.executionStatus === "failed"
      ? "failed"
      : index < activeIndex ? "done" : index === activeIndex ? "active" : "waiting",
  }));
}

export function requirementExecutionStageLabel(
  executionStatus: ExecutionFanoutSnapshot["status"] | null,
  materialized: boolean,
  stage: Extract<RequirementAssistantStageKey, ExecutionFanoutLoopStageKey> = "run",
): string {
  if (stage === "verify") return executionStatus === "succeeded" ? "待校验" : "校验";
  if (stage === "spec") return "Spec 反哺";
  if (executionStatus === "succeeded") return "实现完成";
  if (executionStatus === "failed") return "执行失败";
  if (executionStatus === "running") return "运行中";
  return materialized ? "已落盘" : "落盘运行";
}
