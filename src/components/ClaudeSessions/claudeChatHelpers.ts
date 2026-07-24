import type {
  ClaudeSession,
  GitStatusResponse,
  PendingExecutionTask,
  TaskFlowStatus,
  TaskItem,
} from "../../types";
import { repositoryPathsMatch } from "../../utils/repositoryMainSessionBinding";
import { stripRedundantRepoBracketPrefix } from "../../utils/sessionRepositoryDisplay";
import {
  messageTextLooksLikeOmcDispatch,
  parseOmcSlashCommandFromUserText,
} from "../../utils/omcUserMessageText";
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { buildConventionalCommitFallback } from "../../utils/conventionalCommitMessage";
import { isDisplayNoiseUserMessageText } from "../../utils/claudeChatMessageDisplay";
import type { CenterView } from "./ClaudeChat";

/**
 * 中栏视图在 slot 有无变化后的解析结果（纯函数，供 useCenterView 与单测共用）。
 *
 * - `pending`：程序化切到某视图但目标 panel 尚未挂载时的挂起目标。
 * - fallback 在 pending 匹配期间不得把视图打回 messages（打开文件竞态）。
 */
export function resolveCenterViewAfterSlotChange(input: {
  centerView: CenterView;
  hasFiles: boolean;
  hasTerminal: boolean;
  userChosen: boolean;
  pending: CenterView | null;
}): { centerView: CenterView; pending: CenterView | null } {
  let pending = input.pending;
  if (pending === "files" && input.hasFiles) pending = null;
  else if (pending === "terminal" && input.hasTerminal) pending = null;

  let centerView = input.centerView;
  if (centerView === "files" && !input.hasFiles) {
    if (pending !== "files") {
      centerView = input.hasTerminal ? "terminal" : "messages";
    }
  } else if (centerView === "terminal" && !input.hasTerminal) {
    if (pending !== "terminal") {
      centerView = input.hasFiles ? "files" : "messages";
    }
  }

  // 冷启动跟随：仅 messages 且无用户闩、无 pending 时。
  if (
    !input.userChosen &&
    pending == null &&
    centerView === "messages"
  ) {
    if (input.hasFiles) centerView = "files";
    else if (input.hasTerminal) centerView = "terminal";
  }

  return { centerView, pending };
}

/**
 * 中栏「消息/文件/终端」视图切换状态：有编辑器时默认「文件」，无编辑器但有
 * 终端时默认「终端」，都没有回「消息」。状态提升到 pane 组件 / 会话壳层，供顶栏
 * Segmented 与 ClaudeChat 共享同一份视图。effect 只依赖「下方面板有无」布尔，
 * 不依赖 ReactNode identity：终端/文件节点重渲换引用时不应把用户已选的视图
 * 强行拽回其它项。
 *
 * editor 与 terminal 是两个独立 slot（`panelBelowMessages` / `panelBelowTerminal`），
 * DOM 中并存；effect 仅在「某 slot 卸载」时把视图回退到另一个可用 slot 或 messages。
 *
 * 两套 setter：
 * - `setCenterView`：顶栏 Segmented 用户点击；置位 userChosen，阻止 slot 抖动拽回。
 * - `requestCenterView`：打开文件/终端等程序化导航；写入 pending，避免
 *   「先切到 files、editor 尚未挂上 → fallback 打回 messages → userChosen 挡住自动跟随」
 *   的竞态（表现为点 git/文件树打开文件后仍停在消息 tab）。
 */
export function useCenterView(
  panelBelowMessages: ReactNode,
  panelBelowTerminal: ReactNode,
  hideMessages: boolean,
): {
  centerView: CenterView;
  setCenterView: (view: CenterView) => void;
  requestCenterView: (view: CenterView) => void;
  visible: boolean;
} {
  const [centerView, setCenterViewRaw] = useState<CenterView>("messages");
  // 用户从未在顶栏 Segmented 显式选过视图时，才允许 effect 在 slot 变化时自动跟随；
  // 一旦用户点过任何视图（包括「消息」），就不再被 effect 强行拽回 files/terminal，
  // 避免「打开 git diff → 切到消息 → 立刻被 effect 拽回文件视图」的回归。
  const userChosenViewRef = useRef(false);
  // 程序化切视图时目标 panel 可能尚未挂载；fallback 不得在 pending 期间打回 messages。
  const pendingProgrammaticViewRef = useRef<CenterView | null>(null);
  const hasFiles = Boolean(panelBelowMessages);
  const hasTerminal = Boolean(panelBelowTerminal);
  const setCenterView = useCallback((view: CenterView) => {
    userChosenViewRef.current = true;
    pendingProgrammaticViewRef.current = null;
    setCenterViewRaw(view);
  }, []);
  const requestCenterView = useCallback((view: CenterView) => {
    // 打开文件/终端是强意图：清掉「停在消息」的用户闩，并挂起 pending 防 fallback 竞态。
    userChosenViewRef.current = false;
    pendingProgrammaticViewRef.current = view;
    setCenterViewRaw(view);
  }, []);
  useEffect(() => {
    const next = resolveCenterViewAfterSlotChange({
      centerView,
      hasFiles,
      hasTerminal,
      userChosen: userChosenViewRef.current,
      pending: pendingProgrammaticViewRef.current,
    });
    pendingProgrammaticViewRef.current = next.pending;
    if (next.centerView !== centerView) {
      setCenterViewRaw(next.centerView);
    }
  }, [centerView, hasFiles, hasTerminal]);
  return {
    centerView,
    setCenterView,
    requestCenterView,
    visible: !hideMessages && (hasFiles || hasTerminal),
  };
}

/**
 * 中栏「消息/文件」视图切换命令通道。由持有 `setCenterView` 的 pane 组件
 * （单屏 `AppWorkspaceLayout` / 多屏 `ClaudeMultiPaneGrid` 的 primary、extra）
 * 提供，供消息列表深处（如 `ToolFileEditCard`）在用户点击「变更文件」时显式
 * 请求切到「文件」视图。
 *
 * Provider value 即 `useState` 的 `setCenterView`（引用恒定），不触发消费组件
 * 额外重渲染；context 穿透各层 memo 比较器，故无需把手写比较器改成识别它。
 * 与 `useCenterView` 的 effect 正交：effect 处理编辑器挂载/卸载的自动切换，
 * 本通道处理「编辑器已开、用户在消息视图」时点击变更文件显式切到文件视图。
 */
export const CenterViewControlContext = createContext<((view: CenterView) => void) | null>(null);

export function useCenterViewControl(): ((view: CenterView) => void) | null {
  return useContext(CenterViewControlContext);
}

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

export function buildSessionsNotificationScopeFingerprint(sessions: readonly ClaudeSession[]): string {
  return [...sessions]
    .map((s) => `${s.id}\0${s.repositoryPath ?? ""}\0${s.claudeSessionId ?? ""}`)
    .sort()
    .join("\n");
}

export function buildPendingTasksQueueFingerprint(tasks: readonly PendingExecutionTask[]): string {
  return tasks
    .map((t) =>
      [
        t.id,
        t.targetType ?? "main",
        t.targetEmployeeName ?? "",
        t.targetWorkflowId ?? "",
      ].join(":"),
    )
    .join("\n");
}

/** 当前仓库内 running/connecting 会话 id，用于待办队列自动派发 gate（避免依赖 sessions 数组引用）。 */
export function buildRepoRunningSessionsFingerprint(
  sessions: readonly ClaudeSession[],
  repositoryPath: string,
): string {
  const repoKey = sessionRepoPathKey(repositoryPath);
  return sessions
    .filter(
      (s) =>
        sessionRepoPathKey(s.repositoryPath) === repoKey &&
        (s.status === "running" || s.status === "connecting"),
    )
    .map((s) => s.id)
    .sort()
    .join(",");
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
      if (isDisplayNoiseUserMessageText(fromParts)) continue;
      return fromParts;
    }
    const fromContent = msg.content.trim();
    if (fromContent) {
      if (isDisplayNoiseUserMessageText(fromContent)) continue;
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

/** 会话列表 / Cursor 风格短标题：单行、折叠空白、超长省略。 */
export const SESSION_LIST_TITLE_MAX = 42;

export function getSessionPreview(session: ClaudeSession): string {
  const repo = session.repositoryName ?? "";
  const firstUserMsg = session.messages.find((m) => m.role === "user");
  if (firstUserMsg) {
    const line = truncateSingleLine(stripRedundantRepoBracketPrefix(firstUserMsg.content, repo), SESSION_LIST_TITLE_MAX);
    if (line.trim()) {
      return line;
    }
  }
  const fromDisk = session.diskPreview?.trim();
  if (fromDisk) {
    const line = truncateSingleLine(stripRedundantRepoBracketPrefix(fromDisk, repo), SESSION_LIST_TITLE_MAX);
    if (line.trim()) {
      return line;
    }
  }
  return "新会话";
}

export function buildAiCommitSummary(status: GitStatusResponse): string {
  return buildConventionalCommitFallback(status);
}

export function truncateSingleLine(value: string, maxLength: number): string {
  const singleLine = value.replace(/\s+/g, " ").trim();
  return singleLine.length > maxLength ? `${singleLine.slice(0, maxLength)}...` : singleLine;
}

/** 列表行展示用：悬停/复制仍可用原文，列表只显示短标题。 */
export function formatSessionListTitle(value: string, maxLength: number = SESSION_LIST_TITLE_MAX): string {
  return truncateSingleLine(value, maxLength);
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
