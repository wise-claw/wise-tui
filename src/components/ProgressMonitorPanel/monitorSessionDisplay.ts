import type { ClaudeSession } from "../../types";
import { extractBoundEmployeeNameFromDisplay } from "../../utils/sessionOwnerHints";
import {
  getSessionPreview,
  historySessionStatusLabel,
  historySessionStatusTagColor,
} from "./historySessionDrawerChrome";
import { sessionUpdatedAt } from "./progressMonitorSearch";

/** 从仓库标签解析终端/员工展示名（`…/员工:名称`）。 */
export function resolveMonitorSessionTerminalLabel(session: ClaudeSession): string | null {
  const fromRepo = extractBoundEmployeeNameFromDisplay(session.repositoryName?.trim() ?? "");
  if (fromRepo) {
    return fromRepo;
  }
  return null;
}

/** 仓库标签中的项目/仓库短名（去掉 `员工:` 后缀段）。 */
export function resolveMonitorSessionRepoShortLabel(session: ClaudeSession): string {
  const raw = session.repositoryName?.trim() ?? "";
  if (!raw) {
    return "未命名仓库";
  }
  const employeeIdx = raw.lastIndexOf("员工:");
  const withoutEmployee = employeeIdx >= 0 ? raw.slice(0, employeeIdx).trim() : raw;
  const normalized = withoutEmployee.replace(/[/\\]+$/, "");
  if (!normalized) {
    return raw;
  }
  const slash = Math.max(normalized.lastIndexOf("/"), normalized.lastIndexOf("\\"));
  const leaf = slash >= 0 ? normalized.slice(slash + 1) : normalized;
  return leaf || normalized;
}

export function compactMonitorSessionId(value: string | undefined): string {
  const normalized = value?.trim() ?? "";
  if (!normalized) {
    return "—";
  }
  if (normalized.length <= 20) {
    return normalized;
  }
  return `${normalized.slice(0, 10)}…${normalized.slice(-6)}`;
}

export interface MonitorSessionDrawerTitleModel {
  headline: string;
  preview: string;
  statusLabel: string;
  updatedAtText: string;
  sessionIdCopy: string;
  sessionIdDisplay: string;
}

export function buildMonitorSessionDrawerHeadline(
  session: ClaudeSession,
  context?: { terminalName?: string },
): string {
  const terminal =
    context?.terminalName?.trim() ||
    resolveMonitorSessionTerminalLabel(session) ||
    null;
  const repoShort = resolveMonitorSessionRepoShortLabel(session);
  return terminal ? `${terminal} · 会话记录` : `${repoShort} · 会话记录`;
}

export interface MonitorSessionDrawerContextModel {
  repoShort: string;
  updatedAtText: string;
  sessionIdCopy: string;
  sessionIdDisplay: string;
}

export function buildMonitorSessionDrawerContextModel(
  session: ClaudeSession,
): MonitorSessionDrawerContextModel {
  const claudeId = session.claudeSessionId?.trim();
  const sessionIdCopy = claudeId && claudeId.length > 0 ? claudeId : session.id;
  return {
    repoShort: resolveMonitorSessionRepoShortLabel(session),
    updatedAtText: formatMonitorSessionDateTime(sessionUpdatedAt(session)),
    sessionIdCopy,
    sessionIdDisplay: compactMonitorSessionId(sessionIdCopy),
  };
}

/** @deprecated 列表等场景仍可用；抽屉标题请用 buildMonitorSessionDrawerHeadline + ContextModel */
export function buildMonitorSessionDrawerTitleModel(
  session: ClaudeSession,
  context?: { terminalName?: string },
): MonitorSessionDrawerTitleModel {
  const preview = getSessionPreview(session);
  const ctx = buildMonitorSessionDrawerContextModel(session);
  return {
    headline: buildMonitorSessionDrawerHeadline(session, context),
    preview,
    statusLabel: historySessionStatusLabel(session.status),
    updatedAtText: ctx.updatedAtText,
    sessionIdCopy: ctx.sessionIdCopy,
    sessionIdDisplay: ctx.sessionIdDisplay,
  };
}

export interface MonitorSessionListRowModel {
  preview: string;
  statusLabel: string;
  statusColor: "default" | "processing" | "success" | "error";
  updatedAtText: string;
  relativeUpdatedAtText: string;
  terminalLabel: string | null;
  repoShort: string;
}

export function buildMonitorSessionListRowModel(
  session: ClaudeSession,
  context?: { employeeName?: string },
): MonitorSessionListRowModel {
  const terminal =
    context?.employeeName?.trim() ||
    resolveMonitorSessionTerminalLabel(session) ||
    null;
  const updatedMs = sessionUpdatedAt(session);
  return {
    preview: getSessionPreview(session),
    statusLabel: historySessionStatusLabel(session.status),
    statusColor: historySessionStatusTagColor(session.status),
    updatedAtText: formatMonitorSessionDateTime(updatedMs),
    relativeUpdatedAtText: formatMonitorSessionRelativeTime(updatedMs),
    terminalLabel: terminal,
    repoShort: resolveMonitorSessionRepoShortLabel(session),
  };
}

export function formatMonitorSessionDateTime(value: number): string {
  if (!Number.isFinite(value) || value <= 0) {
    return "—";
  }
  return new Date(value).toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function formatMonitorSessionRelativeTime(value: number): string {
  if (!Number.isFinite(value) || value <= 0) {
    return "—";
  }
  const diffMs = Date.now() - value;
  if (diffMs < 45_000) {
    return "刚刚";
  }
  if (diffMs < 3_600_000) {
    return `${Math.max(1, Math.floor(diffMs / 60_000))} 分钟前`;
  }
  if (diffMs < 86_400_000) {
    return `${Math.max(1, Math.floor(diffMs / 3_600_000))} 小时前`;
  }
  if (diffMs < 7 * 86_400_000) {
    return `${Math.max(1, Math.floor(diffMs / 86_400_000))} 天前`;
  }
  return formatMonitorSessionDateTime(value);
}
