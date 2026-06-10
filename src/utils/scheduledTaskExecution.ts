import type { RepositoryScheduledClaudeTask, RepositoryScheduledTaskExecutionKind } from "../types";

export type ScheduledTaskExecutionKind = RepositoryScheduledTaskExecutionKind;

export const SCHEDULED_TASK_EXECUTION_KIND_OPTIONS: {
  value: ScheduledTaskExecutionKind;
  label: string;
  description: string;
}[] = [
  {
    value: "claude",
    label: "Claude 提示词",
    description: "向执行会话发送 Markdown 提示，可指定主会话、员工或团队工作流分发",
  },
  {
    value: "script",
    label: "脚本执行",
    description: "在仓库根目录通过 zsh -c 执行 Shell 命令或多行脚本",
  },
];

export function resolveScheduledTaskExecutionKind(
  task: Pick<RepositoryScheduledClaudeTask, "executionKind">,
): ScheduledTaskExecutionKind {
  const kind = task.executionKind;
  if (kind === "script" || kind === "claude") return kind;
  // 兼容旧数据：曾用 CC Workflow Studio 的 workflow 类型已下线，按 claude 处理。
  return "claude";
}

export function formatScheduledTaskExecutionKindLabel(
  task: Pick<RepositoryScheduledClaudeTask, "executionKind">,
): string {
  const kind = resolveScheduledTaskExecutionKind(task);
  return SCHEDULED_TASK_EXECUTION_KIND_OPTIONS.find((item) => item.value === kind)?.label ?? "Claude 提示词";
}
