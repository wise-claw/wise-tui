import type { ClaudeSession, GitStatusResponse, TaskFlowStatus, TaskItem } from "../../types";
import { repositoryPathsMatch } from "../../utils/repositoryMainSessionBinding";
import { stripRedundantRepoBracketPrefix } from "../../utils/sessionRepositoryDisplay";
import {
  messageTextLooksLikeOmcDispatch,
  parseOmcSlashCommandFromUserText,
} from "../../utils/omcUserMessageText";

export type NotificationInboxRow = {
  conversationId: string;
  readAt?: unknown;
};

export function formatWorktreeBranchLabel(branch: string | null): string {
  if (!branch?.trim()) return "（detached）";
  return branch.replace(/^refs\/heads\//, "");
}

export function sessionRepoPathKey(p: string): string {
  return p.trim().replace(/\\/g, "/").replace(/\/$/, "");
}

export function formatWorktreePathRelative(repoPath: string, worktreePath: string): string {
  const norm = (path: string) => path.replace(/\\/g, "/").replace(/\/$/, "");
  const repo = norm(repoPath);
  const worktree = norm(worktreePath);
  if (worktree.startsWith(`${repo}/`)) return worktree.slice(repo.length + 1);
  return worktreePath;
}

export function sameLogicalClaudeSession(a: ClaudeSession, b: ClaudeSession): boolean {
  if (a.id === b.id) return true;
  const ac = a.claudeSessionId?.trim();
  const bc = b.claudeSessionId?.trim();
  if (ac && (ac === b.id || (bc && ac === bc))) return true;
  if (bc && (bc === a.id || (ac && bc === ac))) return true;
  return false;
}

export function formatTaskRoleLabel(role: string | undefined): string {
  const r = (role ?? "").trim().toLowerCase();
  if (r === "frontend") return "前端";
  if (r === "backend") return "后端";
  if (r === "document") return "文档";
  if (r === "fullstack" || r === "full-stack") return "全栈";
  if (r === "devops") return "运维";
  if (r === "mobile") return "移动端";
  if (r === "design" || r === "designer") return "设计";
  return (role ?? "").trim() || "未指定";
}

export function buildTaskExecutionPrompt(task: TaskItem): string {
  const lines = [
    `请执行以下任务：${task.title || task.id}`,
    "",
    `任务ID：${task.id}`,
    `角色：${formatTaskRoleLabel(task.role)}`,
    `规模：${task.size}`,
    `预估工期：${task.estimateDays} 天`,
  ];
  if (task.description.trim()) {
    lines.push("", "任务描述：", task.description.trim());
  }
  if (task.dod.length > 0) {
    lines.push("", "验收标准：");
    for (const item of task.dod) {
      if (item.trim()) {
        lines.push(`- ${item.trim()}`);
      }
    }
  }
  return lines.join("\n");
}

export function normalizeSplitTaskListFlowStatus(status: TaskFlowStatus | undefined): "todo" | "done" | undefined {
  if (status === undefined) return undefined;
  if (status === "done") return "done";
  return "todo";
}

export function splitTaskListBinaryLabel(status: TaskFlowStatus | undefined): string {
  return status === "done" ? "已完成" : "未完成";
}

export function countSessionUnreadNotifications(
  rows: NotificationInboxRow[],
  sess: ClaudeSession,
  allSessions: ClaudeSession[],
): number {
  return rows.filter((row) => notificationRowInSessionInboxScope(row, sess, allSessions)).length;
}

export function notificationInboxConversationMatchesSession(
  conversationId: string,
  sess: ClaudeSession,
  allSessions: ClaudeSession[],
): boolean {
  const c = conversationId.trim();
  if (!c) return false;
  if (c === sess.id) return true;
  const claude = sess.claudeSessionId?.trim();
  if (claude && c === claude) return true;
  const owner = allSessions.find((s) => s.id === c || (s.claudeSessionId?.trim() && s.claudeSessionId.trim() === c));
  if (!owner) return false;
  return sameLogicalClaudeSession(owner, sess);
}

export function notificationConversationInSessionInboxScope(
  conversationId: string,
  sess: ClaudeSession,
  allSessions: ClaudeSession[],
): boolean {
  const c = conversationId.trim();
  if (!c) return false;
  const owner = allSessions.find((s) => s.id === c || (s.claudeSessionId?.trim() && s.claudeSessionId.trim() === c));
  if (owner) {
    return repositoryPathsMatch(owner.repositoryPath, sess.repositoryPath);
  }
  return notificationInboxConversationMatchesSession(c, sess, allSessions);
}

export function buildSessionsNotificationScopeFingerprint(sessions: ClaudeSession[]): string {
  return sessions
    .map((s) => `${s.id}\0${s.repositoryPath ?? ""}\0${s.claudeSessionId ?? ""}`)
    .join("\n");
}

export function notificationRowInSessionInboxScope(
  row: NotificationInboxRow,
  sess: ClaudeSession,
  allSessions: ClaudeSession[],
): boolean {
  if (row.readAt) return false;
  return notificationConversationInSessionInboxScope(row.conversationId, sess, allSessions);
}

export function extractEmployeeNameFromBracketPreview(preview: string | undefined): string | null {
  if (!preview?.trim()) {
    return null;
  }
  const marker = "员工:";
  const open = preview.indexOf("[");
  const close = preview.indexOf("]", open + 1);
  if (open < 0 || close <= open) {
    return null;
  }
  const inner = preview.slice(open + 1, close);
  const idx = inner.lastIndexOf(marker);
  if (idx < 0) {
    return null;
  }
  const value = inner.slice(idx + marker.length).trim();
  return value || null;
}

export function getLatestUserPlainText(session: ClaudeSession): string {
  for (let i = session.messages.length - 1; i >= 0; i -= 1) {
    const msg = session.messages[i];
    if (msg.role !== "user") {
      continue;
    }
    const fromParts =
      msg.parts
        ?.filter((part): part is { type: "text"; text: string } => part.type === "text" && typeof part.text === "string")
        .map((part) => part.text.trim())
        .filter(Boolean)
        .join("\n\n") ?? "";
    if (fromParts) {
      return fromParts;
    }
    const fromContent = msg.content.trim();
    if (fromContent) {
      return fromContent;
    }
  }
  return "";
}

export function extractOmcCommandFromUserPrompt(session: ClaudeSession): string | null {
  const latestUserText = getLatestUserPlainText(session);
  if (!latestUserText) return null;
  if (!messageTextLooksLikeOmcDispatch(latestUserText)) return null;
  return parseOmcSlashCommandFromUserText(latestUserText) ?? "/autopilot";
}

export function getLatestDispatchedTeamName(session: ClaudeSession): string | null {
  for (let i = session.messages.length - 1; i >= 0; i -= 1) {
    const msg = session.messages[i];
    if (msg.role !== "system") {
      continue;
    }
    const systemText =
      msg.parts
        ?.filter((part): part is { type: "text"; text: string } => part.type === "text" && typeof part.text === "string")
        .map((part) => part.text)
        .join("\n") || msg.content;
    if (!systemText.includes("任务分发记录") || !systemText.includes("类型：团队流程")) {
      continue;
    }
    const targetLine = systemText
      .split("\n")
      .map((line) => line.trim())
      .find((line) => line.startsWith("- 目标："));
    if (!targetLine) {
      continue;
    }
    const teamName = targetLine.replace("- 目标：", "").trim();
    if (teamName) {
      return teamName;
    }
  }
  return null;
}

export function getSessionPreview(session: ClaudeSession): string {
  const repo = session.repositoryName ?? "";
  const firstUserMsg = session.messages.find((m) => m.role === "user");
  if (firstUserMsg) {
    const line = truncateSingleLine(stripRedundantRepoBracketPrefix(firstUserMsg.content, repo), 28);
    if (line.trim()) {
      return line;
    }
  }
  const fromDisk = session.diskPreview?.trim();
  if (fromDisk) {
    const line = truncateSingleLine(stripRedundantRepoBracketPrefix(fromDisk, repo), 28);
    if (line.trim()) {
      return line;
    }
  }
  return "新会话";
}

export function buildAiCommitSummary(status: GitStatusResponse): string {
  const changedFiles = [...status.staged, ...status.unstaged];
  const uniqueFiles = Array.from(new Set(changedFiles.map((item) => item.path))).slice(0, 5);
  const fileSummary = uniqueFiles.length > 0 ? `涉及文件：${uniqueFiles.join("、")}` : "涉及文件：当前无改动文件";
  const totalChanged = changedFiles.length;
  const scopeText = totalChanged > 0 ? `本次改动覆盖 ${totalChanged} 个文件` : "本次改动较小";
  return [
    `${scopeText}，优化会话与界面交互体验。`,
    fileSummary,
    `变更统计：+${Math.max(0, status.additions || 0)} / -${Math.max(0, status.deletions || 0)}。`,
  ].join("\n");
}

export function truncateSingleLine(value: string, maxLength: number): string {
  const singleLine = value.replace(/\s+/g, " ").trim();
  return singleLine.length > maxLength ? `${singleLine.slice(0, maxLength)}...` : singleLine;
}

export function formatShortQuestionTime(ms: number): string {
  try {
    return new Date(ms).toLocaleString("zh-CN", {
      month: "numeric",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
}
