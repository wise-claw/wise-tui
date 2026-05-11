import type { ClaudeSession } from "../types";

export interface SessionOwnerHint {
  type: "employee" | "team";
  name: string;
  updatedAt: number;
}

export const WISE_SESSION_OWNER_HINTS_STORAGE_KEY = "wise:session-owner-hints-v1";

/** 顶栏等非 ClaudeChat 内写入 hints 后派发，便于已挂载会话拉取最新 sessionStorage。 */
export const WISE_SESSION_OWNER_HINTS_CHANGED_EVENT = "wise-session-owner-hints-changed";

/** 与监控面板一致：取展示名中最后一个 `员工:` 后的姓名（支持嵌套路径）。 */
export function extractBoundEmployeeNameFromDisplay(repositoryName: string): string | null {
  const marker = "员工:";
  const idx = repositoryName.lastIndexOf(marker);
  if (idx < 0) {
    return null;
  }
  const value = repositoryName.slice(idx + marker.length).trim();
  return value || null;
}

/** 从通知正文首段 `[…]` 解析员工归属（与侧栏点击通知逻辑一致）。 */
export function parseOwnerHintFromNotificationBody(body: string): SessionOwnerHint | null {
  const open = body.indexOf("[");
  const close = body.indexOf("]", open + 1);
  if (open < 0 || close <= open) {
    return null;
  }
  const prefix = body.slice(open + 1, close).trim();
  if (!prefix) {
    return null;
  }
  const employee = extractBoundEmployeeNameFromDisplay(prefix);
  if (employee) {
    return {
      type: "employee",
      name: employee,
      updatedAt: Date.now(),
    };
  }
  return null;
}

export function loadSessionOwnerHints(): Record<string, SessionOwnerHint> {
  try {
    const raw = sessionStorage.getItem(WISE_SESSION_OWNER_HINTS_STORAGE_KEY);
    if (!raw) {
      return {};
    }
    const parsed = JSON.parse(raw) as Record<string, SessionOwnerHint>;
    if (!parsed || typeof parsed !== "object") {
      return {};
    }
    return parsed;
  } catch {
    return {};
  }
}

export function persistSessionOwnerHints(hints: Record<string, SessionOwnerHint>): void {
  try {
    sessionStorage.setItem(WISE_SESSION_OWNER_HINTS_STORAGE_KEY, JSON.stringify(hints));
  } catch {
    /* ignore */
  }
}

export function resolveOwnerHintForSession(
  hints: Record<string, SessionOwnerHint>,
  session: ClaudeSession,
): SessionOwnerHint | null {
  const byClaudeId = session.claudeSessionId ? hints[session.claudeSessionId] : undefined;
  if (byClaudeId) {
    return byClaudeId;
  }
  const bySessionId = hints[session.id];
  return bySessionId ?? null;
}
