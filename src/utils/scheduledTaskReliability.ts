import { CronExpressionParser } from "cron-parser";
import type { RepositoryScheduledClaudeTask } from "../types";

export type ScheduledTaskLastKind = NonNullable<RepositoryScheduledClaudeTask["lastExecuteKind"]>;

export type ScheduledTaskGate =
  | { status: "disabled" }
  | { status: "paused"; scope: "global" | "repository" }
  | { status: "invalid_cron" }
  | { status: "hold" }
  | { status: "due"; nextFireMs: number };

export const SCHEDULED_TASK_RETRY_BUSY = "会话忙或已达并发上限，空闲后补跑";
export const SCHEDULED_TASK_RETRY_DISPATCH = "工作流派发未启动，空闲后补跑";
export const SCHEDULED_TASK_SKIP_CRON = "Cron 表达式无效";
export const SCHEDULED_TASK_SKIP_EMPTY = "执行内容为空，已跳过";
export const SCHEDULED_TASK_SKIP_PROMPT_EMPTY = "组装提示结果为空，已跳过";
export const SCHEDULED_TASK_SKIP_WORKFLOW = "所选团队工作流不存在或不可用，已跳过";

export function nextScheduledFireMs(
  cronExpression: string,
  lastScheduledSlotAt: number | undefined,
): number | "invalid" {
  const cron = cronExpression.trim();
  if (!cron) return "invalid";
  try {
    return CronExpressionParser.parse(cron, {
      currentDate: new Date(lastScheduledSlotAt ?? 0),
    }).next().getTime();
  } catch {
    return "invalid";
  }
}

export function evaluateScheduledTaskGate(input: {
  enabled: boolean;
  cronExpression: string;
  lastScheduledSlotAt?: number;
  nowMs: number;
  pausedGlobal: boolean;
  pausedRepository: boolean;
}): ScheduledTaskGate {
  if (!input.enabled) return { status: "disabled" };
  if (input.pausedGlobal) return { status: "paused", scope: "global" };
  if (input.pausedRepository) return { status: "paused", scope: "repository" };
  const nextFireMs = nextScheduledFireMs(input.cronExpression, input.lastScheduledSlotAt);
  if (nextFireMs === "invalid") return { status: "invalid_cron" };
  if (nextFireMs > input.nowMs) return { status: "hold" };
  return { status: "due", nextFireMs };
}

export function alignConsumedScheduledSlotAt(
  cronExpression: string,
  dueFireMs: number,
  nowMs: number,
): number {
  try {
    const prev = CronExpressionParser.parse(cronExpression.trim(), {
      currentDate: new Date(nowMs),
    }).prev().getTime();
    if (!Number.isFinite(prev)) return dueFireMs;
    const aligned = Math.max(prev, dueFireMs);
    const nextAfterAligned = nextScheduledFireMs(cronExpression, aligned);
    if (nextAfterAligned !== "invalid" && nextAfterAligned <= nowMs) {
      return nextAfterAligned;
    }
    return aligned;
  } catch {
    return dueFireMs;
  }
}

export function buildScheduledTaskResultPatch(input: {
  nextFireMs?: number;
  nowMs: number;
  consumeSlot: boolean;
  kind: ScheduledTaskLastKind;
  message?: string;
  cronExpression?: string;
}): Partial<Omit<RepositoryScheduledClaudeTask, "id" | "createdAt">> {
  const consumedSlotAt =
    input.consumeSlot && input.nextFireMs != null
      ? input.cronExpression
        ? alignConsumedScheduledSlotAt(input.cronExpression, input.nextFireMs, input.nowMs)
        : input.nextFireMs
      : undefined;
  return {
    ...(consumedSlotAt != null ? { lastScheduledSlotAt: consumedSlotAt } : {}),
    lastExecutedAt: input.nowMs,
    lastExecuteOk: input.kind === "ok",
    lastExecuteKind: input.kind,
    lastExecuteMessage: input.message,
  };
}

export function resolveScheduledTaskLastKind(
  task: Pick<RepositoryScheduledClaudeTask, "lastExecuteKind" | "lastExecuteOk" | "lastExecutedAt">,
): ScheduledTaskLastKind | null {
  if (task.lastExecuteKind === "ok" || task.lastExecuteKind === "failed" || task.lastExecuteKind === "skipped" || task.lastExecuteKind === "retrying") {
    return task.lastExecuteKind;
  }
  if (!task.lastExecutedAt) return null;
  return task.lastExecuteOk === false ? "failed" : "ok";
}

export function formatScheduledTaskLastKindLabel(kind: ScheduledTaskLastKind | null): string {
  if (kind === "ok") return "成功";
  if (kind === "failed") return "失败";
  if (kind === "skipped") return "已跳过";
  if (kind === "retrying") return "待补跑";
  return "暂无";
}

export function summarizeScheduledTaskKinds(
  tasks: Array<Pick<RepositoryScheduledClaudeTask, "lastExecuteKind" | "lastExecuteOk" | "lastExecutedAt">>,
): { failed: number; skipped: number; retrying: number } {
  let failed = 0;
  let skipped = 0;
  let retrying = 0;
  for (const task of tasks) {
    const kind = resolveScheduledTaskLastKind(task);
    if (kind === "failed") failed += 1;
    else if (kind === "skipped") skipped += 1;
    else if (kind === "retrying") retrying += 1;
  }
  return { failed, skipped, retrying };
}
