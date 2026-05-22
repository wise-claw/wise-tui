import type { ExecutionFanoutSnapshot } from "../../services/prdSplit/executionFanout";

export type RequirementAssistantStageKey = "write" | "draft" | "split" | "review" | "plan" | "execute";
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
    { key: "execute", label: requirementExecutionStageLabel(input.executionStatus, input.hasMaterializedResult) },
  ];
  const activeKey: RequirementAssistantStageKey | null = input.executionStatus === "succeeded"
    ? null
    : input.executionStatus === "running" || input.executionStatus === "failed" || input.hasMaterializedResult
      ? "execute"
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
    status: item.key === "execute" && input.executionStatus === "failed"
      ? "failed"
      : index < activeIndex ? "done" : index === activeIndex ? "active" : "waiting",
  }));
}

export function requirementExecutionStageLabel(
  executionStatus: ExecutionFanoutSnapshot["status"] | null,
  materialized: boolean,
): string {
  if (executionStatus === "succeeded") return "执行完成";
  if (executionStatus === "failed") return "执行失败";
  if (executionStatus === "running") return "执行中";
  return materialized ? "执行结果" : "开始执行";
}
