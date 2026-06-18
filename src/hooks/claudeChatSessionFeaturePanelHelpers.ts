import type { ClaudeSession, WorkflowTaskItem, WorkflowTemplateItem } from "../types";
import type { SessionOwnerHint } from "../utils/sessionOwnerHints";
import { extractBoundEmployeeNameFromDisplay } from "../utils/sessionOwnerHints";
import { TEAM_AUTO_DRIVER_PREFIXES } from "../constants/teamAutoDriver";
import {
  extractEmployeeNameFromBracketPreview,
  extractOmcCommandFromUserPrompt,
  getLatestDispatchedTeamName,
  getLatestUserPlainText,
} from "../components/ClaudeSessions/claudeChatHelpers";
import type { RepositorySessionExecutionRow } from "../components/ClaudeSessions/ClaudeChatSessionFeatureShared";

export function mapClaudeExecutionStatusLabel(status: ClaudeSession["status"]): string {
  if (status === "running") return "运行中";
  if (status === "connecting") return "连接中";
  if (status === "completed") return "已完成";
  if (status === "cancelled") return "已取消";
  if (status === "error") return "异常";
  return "空闲";
}

export function executionStatusTagColor(
  status: ClaudeSession["status"],
): "default" | "processing" | "success" | "error" {
  if (status === "running" || status === "connecting") return "processing";
  if (status === "completed") return "success";
  if (status === "error") return "error";
  return "default";
}

export function formatCompletionActivityTime(t: number): string {
  const d = new Date(t);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

export function rowMatchesCompletionSearch(row: RepositorySessionExecutionRow, q: string): boolean {
  const needle = q.trim().toLowerCase();
  if (!needle) return true;
  const hay = [
    row.scopeLabel,
    row.preview,
    row.claudeSessionId,
    row.sessionId,
    row.statusLabel,
    row.ownerType === "main" ? "主会话" : row.ownerType === "employee" ? "员工" : "团队",
  ]
    .join("\n")
    .toLowerCase();
  return hay.includes(needle);
}

export function getSessionTraceStorageKey(sessionId: string, repositoryPath?: string): string {
  return `wise:claude:session-send-traces:${repositoryPath ?? ""}:${sessionId}`;
}

export function resolveSessionOwnerInfo(input: {
  session: ClaudeSession;
  workflowTasks: WorkflowTaskItem[];
  workflowTemplates: WorkflowTemplateItem[];
  taskPendingEmployeesByTaskId: Record<string, Array<{ employeeId: string; name: string }>>;
  ownerHint: SessionOwnerHint | null;
}): { type: "main" | "employee" | "team"; typeLabel: string; name: string } {
  const { session, workflowTasks, workflowTemplates, taskPendingEmployeesByTaskId, ownerHint } = input;
  if (ownerHint) {
    return {
      type: ownerHint.type,
      typeLabel: ownerHint.type === "employee" ? "员工会话" : "团队会话",
      name: ownerHint.name,
    };
  }
  const employeeNameFromRepo = extractBoundEmployeeNameFromDisplay(session.repositoryName ?? "");
  const employeeNameFromPreview = extractEmployeeNameFromBracketPreview(session.diskPreview);
  const employeeName = employeeNameFromRepo ?? employeeNameFromPreview;
  if (employeeName) {
    return {
      type: "employee",
      typeLabel: "员工会话",
      name: employeeName,
    };
  }
  const omcCommand = extractOmcCommandFromUserPrompt(session);
  if (omcCommand) {
    return {
      type: "employee",
      typeLabel: "员工会话",
      name: `OMC员工 · ${omcCommand}`,
    };
  }

  const latestUserText = getLatestUserPlainText(session);
  const isTeamAutoDriver = TEAM_AUTO_DRIVER_PREFIXES.some((prefix) => latestUserText.startsWith(prefix));
  if (isTeamAutoDriver) {
    const latestTask = [...workflowTasks].sort((a, b) => b.updatedAt - a.updatedAt)[0];
    const workflowTemplateById = new Map(workflowTemplates.map((item) => [item.id, item.name] as const));
    const teamName =
      (latestTask ? workflowTemplateById.get(latestTask.workflowId) : undefined) ??
      getLatestDispatchedTeamName(session) ??
      "团队流程";
    const pendingEmployees = latestTask ? taskPendingEmployeesByTaskId[latestTask.id] ?? [] : [];
    const currentEmployeeName = pendingEmployees[0]?.name?.trim();
    return {
      type: "team",
      typeLabel: "团队会话",
      name: currentEmployeeName ? `${teamName} · 当前：${currentEmployeeName}` : teamName,
    };
  }

  return {
    type: "main",
    typeLabel: "主会话",
    name: "",
  };
}

export const EMPTY_TASK_LIST: never[] = [];
export const EMPTY_STRING_LIST: string[] = [];
