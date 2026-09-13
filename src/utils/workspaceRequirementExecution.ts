import type { ClaudeSession } from "../types";
import type { WorkspaceRequirementItem } from "../types/workspaceRequirements";

export type RequirementExecutionState = ClaudeSession["status"] | "unavailable" | "not_started" | "dispatched";

export const REQUIREMENT_EXECUTION_LABELS: Record<RequirementExecutionState, string> = {
  not_started: "未执行",
  dispatched: "已派发",
  connecting: "连接中",
  running: "运行中",
  idle: "空闲",
  completed: "执行结束",
  cancelled: "已停止",
  error: "执行失败",
  unavailable: "状态未知",
};

export interface RequirementExecutionSession {
  sessionId: string;
  ordinal: number;
  state: RequirementExecutionState;
  session: ClaudeSession | null;
}

/** 保留已落盘的关联顺序；运行时关联补齐派发与需求写回之间的短暂间隙。 */
export function requirementExecutionSessions(
  item: WorkspaceRequirementItem,
  sessions: readonly ClaudeSession[],
): RequirementExecutionSession[] {
  const ids = [...new Set([
    ...item.executionSessionIds,
    ...sessions.filter((session) => session.requirementId === item.id).map((session) => session.id),
  ])];
  const byId = new Map(sessions.map((session) => [session.id, session]));
  return ids.map((sessionId, index) => {
    const session = byId.get(sessionId) ?? null;
    return { sessionId, ordinal: index + 1, state: session?.status ?? "unavailable", session };
  });
}

/** 活跃执行优先于最近一次结果；不从需求验收状态推断会话执行成功。 */
export function requirementExecutionState(
  item: WorkspaceRequirementItem,
  sessions: readonly ClaudeSession[],
): RequirementExecutionState {
  const history = requirementExecutionSessions(item, sessions);
  if (history.some((row) => row.state === "running")) return "running";
  if (history.some((row) => row.state === "connecting")) return "connecting";
  return history[history.length - 1]?.state ?? (item.lastDispatchedAt == null ? "not_started" : "dispatched");
}

export function isRequirementExecutionActive(state: RequirementExecutionState): boolean {
  return state === "running" || state === "connecting";
}
