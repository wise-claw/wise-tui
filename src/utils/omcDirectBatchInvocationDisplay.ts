import type { WorkflowInvocationStreamDetail } from "../constants/workflowUiEvents";
import { sanitizeOmcDirectBatchPreviewLineForList } from "./claudeInvocationText";

/** 子进程仍在跑（`complete` 保留在列表中直至下一批批量开始，不算运行中） */
export function isOmcDirectBatchInvocationRunning(inv: WorkflowInvocationStreamDetail): boolean {
  return inv.phase !== "complete";
}

/** 侧栏 / 抽屉中直连批量子进程列表主标题：优先任务标题，否则回退 `任务 {id}` */
export function formatOmcDirectBatchInvocationListTitle(inv: WorkflowInvocationStreamDetail): string {
  const rawTitle = inv.taskTitle?.trim() ?? "";
  const titleMain =
    rawTitle.length > 0 ? (rawTitle.length > 56 ? `${rawTitle.slice(0, 56)}…` : rawTitle) : inv.taskId?.trim() ? `任务 ${inv.taskId}` : "Claude Code";
  const tpl = inv.templateId?.trim();
  return tpl ? `${titleMain} · ${tpl}` : titleMain;
}

/**
 * 列表/气泡内仅在「子进程已结束且标记失败」时展示预览（错误原因摘要）；成功完成不展示 stdout 摘要。
 */
export function formatOmcDirectBatchInvocationErrorPreviewLineForList(
  inv: WorkflowInvocationStreamDetail,
  maxChars = 72,
): string {
  if (inv.phase !== "complete" || inv.success !== false) return "";
  const raw = (sanitizeOmcDirectBatchPreviewLineForList(inv.previewLine) ?? "").trim();
  if (!raw) return "";
  return raw.length > maxChars ? `${raw.slice(0, maxChars)}…` : raw;
}
