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
  lifecycleStages?: ExecutionFanoutSnapshot["lifecycleStages"];
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
  if (input.lifecycleStages && input.lifecycleStages.length > 0) {
    const lifecycleByKey = new Map(input.lifecycleStages.map((stage) => [stage.key, stage.status]));
    return order.map((item) => ({
      key: item.key,
      label: requirementLifecycleStageLabel(item.key, lifecycleByKey.get(item.key as ExecutionFanoutLoopStageKey)) ?? item.label,
      status: lifecycleByKey.get(item.key as ExecutionFanoutLoopStageKey) ?? inferPreExecutionStatus(input, item.key),
    }));
  }
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

function inferPreExecutionStatus(
  input: Parameters<typeof buildRequirementAssistantStageItems>[0],
  key: RequirementAssistantStageKey,
): RequirementAssistantStageStatus {
  if (key === "write") return input.hasInput ? "done" : "active";
  if (key === "draft") return input.hasResult || input.hasPlannedSummary || input.parsing ? "done" : input.hasInput ? "active" : "waiting";
  if (key === "split") return input.hasResult ? "done" : input.parsing || input.hasPlannedSummary ? "active" : "waiting";
  if (key === "review") return input.allTasksConfirmed ? "done" : input.hasResult ? "active" : "waiting";
  if (key === "plan") return input.hasMaterializedResult ? "done" : input.allTasksConfirmed ? "active" : "waiting";
  return "waiting";
}

function requirementLifecycleStageLabel(
  key: RequirementAssistantStageKey,
  status: RequirementAssistantStageStatus | undefined,
): string | null {
  if (key === "run") {
    if (status === "failed") return "执行失败";
    if (status === "active") return "运行中";
    if (status === "done") return "实现完成";
  }
  if (key === "verify") {
    if (status === "failed") return "校验失败";
    if (status === "active") return "校验中";
    if (status === "done") return "校验完成";
  }
  if (key === "spec") {
    if (status === "active") return "Spec 反哺中";
    if (status === "done") return "Spec 已反哺";
  }
  return null;
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
