import type { ClaudeSession } from "../types";
import { TEAM_AUTO_DRIVER_PREFIXES } from "../constants/teamAutoDriver";
import {
  extractEmployeeNameFromRepositoryDisplay,
  formatInboundNotificationBodyForRepositoryContext,
  getRepositoryBaseDisplayName,
  notificationBodyPrefixInRepositoryContext,
} from "./sessionRepositoryDisplay";

/** 与正文拼接；列表展示时由 `stripNotificationScrollSnippetForDisplay` 去掉，避免过长。 */
export const NOTIFICATION_SCROLL_SNIPPET_MARK = " · 摘录：";

/** 点击通知后由 ClaudeChat 读取，用于滚动定位（与入库 `body` 一致）。 */
export const WISE_PENDING_NOTIFICATION_SCROLL_STORAGE_KEY = "wise:pending-notification-scroll";

function getLatestUserPlainTextForTeamCheck(session: ClaudeSession): string {
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
    const c = msg.content.trim();
    if (c) {
      return c;
    }
  }
  return "";
}

export function isTeamFlowDriverSession(session: ClaudeSession): boolean {
  const t = getLatestUserPlainTextForTeamCheck(session);
  return TEAM_AUTO_DRIVER_PREFIXES.some((prefix) => t.startsWith(prefix));
}

/** 用于通知正文：主会话 / 员工 / 团队（与归属解析独立，仅作简短展示）。 */
export function resolveClaudeTurnContextBracket(session: ClaudeSession | null): string {
  if (!session) {
    return "【主会话】";
  }
  if (extractEmployeeNameFromRepositoryDisplay(session.repositoryName ?? "")) {
    return "【员工】";
  }
  if (isTeamFlowDriverSession(session)) {
    return "【团队】";
  }
  return "【主会话】";
}

/**
 * 主会话在主聊天区已可见，执行完成不写 Wise 消息通知面板；员工 / 团队仍入库便于摘要与跨栏。
 * 与 {@link resolveClaudeTurnContextBracket} 判定一致；`session` 缺失时不入库。
 */
export function shouldIngestWiseNotificationForClaudeTurnComplete(session: ClaudeSession | null): boolean {
  if (!session) {
    return false;
  }
  if (extractEmployeeNameFromRepositoryDisplay(session.repositoryName ?? "")) {
    return true;
  }
  if (isTeamFlowDriverSession(session)) {
    return true;
  }
  return false;
}

/** 前缀里已有 `[员工:…]` 时不再拼 `【员工】`，避免「员工」重复。 */
function contextBracketForTurnNotification(prefix: string, session: ClaudeSession | null): string {
  if (prefix.trimStart().startsWith("[员工:")) {
    return "";
  }
  return resolveClaudeTurnContextBracket(session);
}

/**
 * Claude 一轮流式结束后的通知正文（短）：前缀 + 角色 + 完成/失败 + 可选摘录（供点击后滚动匹配）。
 * 与 `runTurnTaskLifecycle` 无直接耦合；此处「完成/失败」对应会话执行成功/失败。
 */
export function buildClaudeTurnCompleteNotificationBody(params: {
  prefix: string;
  success: boolean;
  previewRaw: string;
  session: ClaudeSession | null;
}): string {
  const { prefix, success, previewRaw, session } = params;
  const bracket = contextBracketForTurnNotification(prefix, session);
  const statusLabel = success ? "完成" : "失败";
  const trimmed = previewRaw.trim();
  if (trimmed.length > 0) {
    const snippet = trimmed.slice(0, 120);
    return `${prefix}${bracket}执行${statusLabel}${NOTIFICATION_SCROLL_SNIPPET_MARK}${snippet}`;
  }
  return `${prefix}${bracket}执行${statusLabel}`;
}

export function stripNotificationScrollSnippetForDisplay(body: string): string {
  const idx = body.lastIndexOf(NOTIFICATION_SCROLL_SNIPPET_MARK);
  if (idx < 0) {
    return body;
  }
  return body.slice(0, idx).trimEnd();
}

/**
 * 消息通知列表/弹层展示：去掉与角标重复的文首 `[员工:…]` / `[团队:…]`；
 * 若仅有方括号姓名段而无 `【员工】`/`【团队】`，则替换为简短角标，保留「员工/团队」语义在「执行完成」等正文前。
 * 不删除 `【员工】`/`【团队】`/`【主会话】`。入库 `body` 与点击后滚动定位仍用原文。
 */
export function stripNotificationEmployeeTeamLabelsForDisplay(text: string): string {
  let s = text.trim();
  if (!s) {
    return s;
  }
  s = s.replace(/^\[员工:[^\]]+\]\s*(?=【员工】)/u, "");
  s = s.replace(/^\[团队:[^\]]+\]\s*(?=【团队】)/u, "");
  s = s.replace(/^\[员工:[^\]]+\]\s*/u, "【员工】");
  s = s.replace(/^\[团队:[^\]]+\]\s*/u, "【团队】");
  return s.replace(/\s{2,}/g, " ").trim();
}

/** 列表左侧「张三」：按归属会话解析员工名 / 团队 / 主会话；无匹配时退回「通知」。 */
export function resolveNotificationInboxActorLabel(owner: ClaudeSession | null): string {
  if (!owner) {
    return "通知";
  }
  const emp = extractEmployeeNameFromRepositoryDisplay(owner.repositoryName ?? "");
  if (emp) {
    return emp;
  }
  if (isTeamFlowDriverSession(owner)) {
    return "团队";
  }
  const base = getRepositoryBaseDisplayName(owner.repositoryName ?? "").trim();
  return base || "主会话";
}

export function findSessionByConversationId(
  sessions: ClaudeSession[],
  conversationId: string,
): ClaudeSession | null {
  const c = conversationId.trim();
  if (!c) {
    return null;
  }
  return (
    sessions.find((s) => {
      if (s.id === c) {
        return true;
      }
      const sid = s.claudeSessionId?.trim();
      return Boolean(sid && sid === c);
    }) ?? null
  );
}

/** 与左侧 actor 并列展示时去掉文首重复的语境角标，避免「张三 · 【员工】…」重复。 */
export function stripLeadingNotificationContextTags(text: string): string {
  return text.replace(/^(?:【(?:员工|团队|主会话)】\s*)+/u, "").trim();
}

/**
 * 消息通知列表单行：`张三 · 消息内容`（actor 为员工名 / 团队 / 主会话或仓库基名；message 为入库正文经列表化裁剪）。
 */
export function formatNotificationInboxDisplayLine(params: {
  body: string;
  conversationId: string;
  sessions: ClaudeSession[];
  repositoryDisplayNameForInbound: string;
}): string {
  const owner = findSessionByConversationId(params.sessions, params.conversationId);
  const actor = resolveNotificationInboxActorLabel(owner);
  const snippetStripped = stripNotificationScrollSnippetForDisplay(params.body);
  let message = stripLeadingNotificationContextTags(
    stripNotificationEmployeeTeamLabelsForDisplay(
      formatInboundNotificationBodyForRepositoryContext(
        snippetStripped,
        params.repositoryDisplayNameForInbound.trim(),
      ),
    ),
  );
  if (!message) {
    message = stripLeadingNotificationContextTags(
      stripNotificationEmployeeTeamLabelsForDisplay(snippetStripped),
    ).trim();
  }
  if (!message) {
    message = snippetStripped.trim() || "（无正文）";
  }
  return `${actor} · ${message}`;
}

/** 点击通知后用于在消息列表中定位：优先匹配「摘录：」后的文本，否则退回正文前 28 字。 */
export function extractNotificationScrollKeyword(body: string | undefined): string {
  if (!body?.trim()) {
    return "";
  }
  const idx = body.lastIndexOf(NOTIFICATION_SCROLL_SNIPPET_MARK);
  if (idx >= 0) {
    return body.slice(idx + NOTIFICATION_SCROLL_SNIPPET_MARK.length).trim().slice(0, 120);
  }
  return body.trim().slice(0, 28);
}

export type WorkflowLifecycleNotifyStatus = "done" | "blocked" | "execute_failed" | "persist_failed";

/**
 * 工作流看板「执行一轮任务」结果写入通知（与 `runTurnTaskLifecycle` 状态一致）。
 */
export function buildWorkflowTaskLifecycleNotificationBody(params: {
  repositoryName: string;
  taskId: string;
  status: WorkflowLifecycleNotifyStatus;
  detailMessage?: string;
}): string {
  const prefix = notificationBodyPrefixInRepositoryContext(params.repositoryName);
  const statusZh =
    params.status === "done"
      ? "完成"
      : params.status === "blocked"
        ? "阻塞"
        : params.status === "execute_failed"
          ? "执行失败"
          : "写入失败";
  const fallback = `任务 ${params.taskId} ${statusZh}`;
  const excerpt =
    params.detailMessage?.trim().slice(0, 160) ||
    (params.status === "done" ? `任务 ${params.taskId} 已通过 Gate` : fallback);
  return `${prefix}任务 ${params.taskId}：【工作流】${statusZh}${NOTIFICATION_SCROLL_SNIPPET_MARK}${excerpt}`;
}
