import type { ClaudeSession } from "../../types";
import type { TrellisRequirementTaskRow } from "../../services/trellisTaskBridge";

export type RefreshHistorySessionsScope = {
  repositoryPath: string;
  repositoryName: string;
};

/** 中栏「历史会话」「完成任务」：首屏条数与滚动加载步长 */
export const FEATURE_SESSION_LIST_PAGE_SIZE = 20;

/** 设为 true 时显示会话特性面板「完成任务」入口与弹窗 */
export const SHOW_SESSION_TASK_COMPLETION_FEATURE = false;

/** 会话跟踪持久化与内存中保留的上限 */
export const SESSION_SEND_TRACE_PERSIST_MAX = 32;

export interface SessionSendTraceEntry {
  id: string;
  sessionId: string;
  createdAt: number;
  composerText: string;
  outboundText: string;
  nodes: Array<{ label: string; timestamp: number; detail?: string }>;
}

export interface RepositorySessionExecutionRow {
  key: string;
  sessionId: string;
  ownerType: "main" | "employee" | "team";
  scopeLabel: string;
  preview: string;
  status: ClaudeSession["status"];
  statusLabel: string;
  claudeSessionId: string;
  messageCount: number;
  updatedAt: number;
}

export type TaskCompletionOwnerFilter = "all" | RepositorySessionExecutionRow["ownerType"];
export type TaskCompletionStatusFilter = "all" | ClaudeSession["status"];

/** 会话工具栏「历史消息」Popover 单行 */
export interface SessionUserQuestionRow {
  id: number;
  text: string;
  timestamp: number;
}

function normalizeTrellisPath(path: string): string {
  return path.trim().replace(/\\/g, "/").replace(/\/$/, "");
}

export function getTrellisTaskRelativePath(task: TrellisRequirementTaskRow): string {
  const dir = normalizeTrellisPath(task.dir);
  const root = normalizeTrellisPath(task.rootPath);
  if (root && dir.startsWith(`${root}/`)) return dir.slice(root.length + 1);
  const marker = "/.trellis/tasks/";
  const markerIndex = dir.indexOf(marker);
  if (markerIndex >= 0) return dir.slice(markerIndex + 1);
  return dir || `.trellis/tasks/${task.taskId}`;
}

export function trellisTaskRowKey(task: TrellisRequirementTaskRow): string {
  return `${normalizeTrellisPath(task.rootPath)}:${normalizeTrellisPath(task.dir)}`;
}
