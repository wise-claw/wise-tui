import type { ClaudeMessage, TodoItem } from "../types";
import {
  computeTodoProgress,
  extractTodoWriteFromMessageParts,
  pickActiveTodoTitle,
  truncateTodoTitle,
} from "../notifications/todoIngest";

export interface TaskListTreeRow {
  id: string;
  content: string;
  status: TodoItem["status"];
}

export interface TaskListDisplayModel {
  headerTitle: string;
  progressLabel: string;
  metaDuration: string;
  metaTokens: string | null;
  rows: TaskListTreeRow[];
  hiddenCompletedCount: number;
}

export function shouldShowClaudeCodeTaskListInMessages(
  status: "idle" | "connecting" | "running" | "completed" | "cancelled" | "error",
  items: readonly { status: TodoItem["status"] }[],
): boolean {
  if (items.length === 0) return false;
  if (status === "running" || status === "connecting") return true;
  return items.some((item) => item.status === "in_progress" || item.status === "pending");
}

/** 当前 TodoWrite 批次起始时间：优先取 transcript 中首次 TodoWrite 消息时间。 */
export function resolveTodoBatchStartedAt(
  messages: readonly ClaudeMessage[],
  fallbackStartedAt: number,
): number {
  for (const message of messages) {
    if (message.role !== "assistant") continue;
    if (!extractTodoWriteFromMessageParts(message.parts)) continue;
    if (typeof message.timestamp === "number" && message.timestamp > 0) {
      return message.timestamp;
    }
  }
  return fallbackStartedAt;
}

export function formatTaskListDuration(createdAt: number, nowMs = Date.now()): string {
  const diff = Math.max(0, nowMs - createdAt);
  const totalSeconds = Math.floor(diff / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) {
    return `${hours}h ${String(minutes).padStart(2, "0")}m`;
  }
  if (minutes > 0) {
    return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
  }
  return `${seconds}s`;
}

export function formatTaskListTokens(estimatedTokens: number | null | undefined): string | null {
  if (estimatedTokens == null || !Number.isFinite(estimatedTokens) || estimatedTokens <= 0) {
    return null;
  }
  if (estimatedTokens >= 1_000_000) {
    return `${(estimatedTokens / 1_000_000).toFixed(1)}M tokens`;
  }
  if (estimatedTokens >= 1_000) {
    const compact = estimatedTokens / 1_000;
    const rounded = compact >= 100 ? Math.round(compact) : Math.round(compact * 10) / 10;
    return `${rounded}k tokens`;
  }
  return `${Math.round(estimatedTokens)} tokens`;
}

export function formatTaskListProgressLabel(items: readonly TodoItem[]): string {
  const { progressed, total } = computeTodoProgress(items);
  if (total <= 0) return "0/0";
  return `${progressed}/${total}`;
}

export function formatTaskListOverflowLabel(hiddenCompletedCount: number): string | null {
  if (hiddenCompletedCount <= 0) return null;
  return `… +${hiddenCompletedCount} 项已完成`;
}

export function buildTaskListDisplayModel(
  items: readonly TodoItem[],
  options?: {
    sessionStartedAt?: number;
    estimatedTokens?: number | null;
    maxVisibleRows?: number;
    compact?: boolean;
    nowMs?: number;
  },
): TaskListDisplayModel | null {
  if (items.length === 0) return null;

  const compact = options?.compact === true;
  const maxVisibleRows = Math.max(1, options?.maxVisibleRows ?? 5);
  const activeTitle = pickActiveTodoTitle(items);
  const headerTitle = activeTitle ? truncateTodoTitle(activeTitle, 48) : "任务列表";
  const progressLabel = formatTaskListProgressLabel(items);
  const metaDuration = formatTaskListDuration(options?.sessionStartedAt ?? Date.now(), options?.nowMs);
  const metaTokens = formatTaskListTokens(options?.estimatedTokens);

  const inProgress = items.filter((item) => item.status === "in_progress");
  const pending = items.filter((item) => item.status === "pending");
  const completed = items.filter((item) => item.status === "completed");

  if (compact) {
    const rows: TaskListTreeRow[] = inProgress.map((item) => ({
      id: item.id,
      content: item.content,
      status: item.status,
    }));
    const hiddenCompletedCount = completed.length;
    const hiddenPendingCount = pending.length;
    const hiddenCount = hiddenCompletedCount + hiddenPendingCount;
    return {
      headerTitle,
      progressLabel,
      metaDuration,
      metaTokens,
      rows,
      hiddenCompletedCount: hiddenCount,
    };
  }

  const slotsForCompleted = Math.max(0, maxVisibleRows - inProgress.length - pending.length);
  const visibleCompleted = completed.slice(-slotsForCompleted);
  const hiddenCompletedCount = Math.max(0, completed.length - visibleCompleted.length);
  const visibleItems = [...inProgress, ...pending, ...visibleCompleted];
  const rows: TaskListTreeRow[] = visibleItems.map((item) => ({
    id: item.id,
    content: item.content,
    status: item.status,
  }));

  return {
    headerTitle,
    progressLabel,
    metaDuration,
    metaTokens,
    rows,
    hiddenCompletedCount,
  };
}
