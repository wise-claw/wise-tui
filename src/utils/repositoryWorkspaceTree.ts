import type {
  ClaudeSession,
  EmployeeMonitorItem,
  Repository,
  SessionConversationTaskItem,
  TeamMonitorItem,
} from "../types";
import { isCodeReviewPromptHistorySession } from "./codeReviewPromptSession";
import { isConventionalCommitPromptHistorySession } from "./conventionalCommitMessage";
import { repositoryPathsMatch } from "./repositoryMainSessionBinding";
import { isSessionFeedbackLoopHistorySession } from "./sessionFeedbackLoopDispatch";
import { listSessionsForRepositoryPath, dedupeClaudeSessionsByIdentity } from "./sessionHistoryScope";
import { sortRepositoriesByWorkspaceOrder } from "./workspaceRepositoryOrder";
import { WORKSPACE_SIDEBAR_ROW_PREVIEW_LIMIT_DEFAULT } from "../constants/workspaceSidebarLayout";

/** 仓库展开子树默认展示行数（终端/派发/工作流 + 会话合计，不含 More）。 */
export const WORKSPACE_SIDEBAR_ROW_PREVIEW_LIMIT = WORKSPACE_SIDEBAR_ROW_PREVIEW_LIMIT_DEFAULT;

/** 侧栏「更多」每次追加的行数。 */
export const WORKSPACE_SIDEBAR_ROW_MORE_STEP = 10;

/** @deprecated 使用 WORKSPACE_SIDEBAR_ROW_PREVIEW_LIMIT */
export const WORKSPACE_SIDEBAR_SESSION_PREVIEW_LIMIT = WORKSPACE_SIDEBAR_ROW_PREVIEW_LIMIT;

function excludeUtilityHistorySessions(sessions: ClaudeSession[]): ClaudeSession[] {
  return sessions.filter(
    (session) =>
      !isConventionalCommitPromptHistorySession(session) &&
      !isCodeReviewPromptHistorySession(session) &&
      !isSessionFeedbackLoopHistorySession(session),
  );
}

function sessionUpdatedAtMs(session: ClaudeSession): number {
  const last = session.messages[session.messages.length - 1]?.timestamp;
  if (typeof last === "number" && Number.isFinite(last) && last > 0) return last;
  return session.createdAt;
}

/** 主侧栏：仓库即工作区，扁平去重后按自定义顺序（无顺序则按显示名）。 */
export function collectFlatWorkspaceRepositories(
  repositories: ReadonlyArray<Repository>,
  floatingRepositories: ReadonlyArray<Repository> = [],
  order: readonly number[] = [],
): Repository[] {
  const byId = new Map<number, Repository>();
  for (const repo of repositories) {
    byId.set(repo.id, repo);
  }
  for (const repo of floatingRepositories) {
    if (!byId.has(repo.id)) {
      byId.set(repo.id, repo);
    }
  }
  return sortRepositoriesByWorkspaceOrder([...byId.values()], order);
}

/** 侧栏会话历史：按仓库归属，排除工具型 oneshot，按更新时间倒序。 */
export function listWorkspaceSidebarHistorySessions(
  sessions: ReadonlyArray<ClaudeSession>,
  repositoryPath: string,
): ClaudeSession[] {
  const scoped = excludeUtilityHistorySessions(
    dedupeClaudeSessionsByIdentity(listSessionsForRepositoryPath(sessions, repositoryPath)),
  );
  return scoped.sort((a, b) => sessionUpdatedAtMs(b) - sessionUpdatedAtMs(a));
}

/** 选中工作区时默认激活的会话：与侧栏列表第一项一致。 */
export function pickFirstWorkspaceSidebarHistorySession(
  sessions: ReadonlyArray<ClaudeSession>,
  repositoryPath: string,
): ClaudeSession | null {
  return listWorkspaceSidebarHistorySessions(sessions, repositoryPath)[0] ?? null;
}

export function filterEmployeeMonitorForRepository(
  items: ReadonlyArray<EmployeeMonitorItem>,
  repositoryPath: string,
): EmployeeMonitorItem[] {
  return items.filter((item) => {
    const path = item.repositoryPath?.trim();
    return Boolean(path) && repositoryPathsMatch(path!, repositoryPath);
  });
}

export function filterDispatchTasksForRepository(
  items: ReadonlyArray<SessionConversationTaskItem>,
  repositoryPath: string,
): SessionConversationTaskItem[] {
  return items.filter((item) => {
    const path = item.repositoryPath?.trim();
    return Boolean(path) && repositoryPathsMatch(path!, repositoryPath);
  });
}

export function filterTeamMonitorForRepository(
  items: ReadonlyArray<TeamMonitorItem>,
  repositoryPath: string,
): TeamMonitorItem[] {
  return items.filter((item) => {
    const path = item.repositoryPath?.trim();
    return Boolean(path) && repositoryPathsMatch(path!, repositoryPath);
  });
}

/** 侧栏展开子树行：终端 / 派发 / 工作流 / 会话，统一按时间混排（不置顶派发）。 */
export type WorkspaceSidebarTreeRow =
  | { kind: "employee"; item: EmployeeMonitorItem; updatedAt: number }
  | { kind: "dispatch"; item: SessionConversationTaskItem; updatedAt: number }
  | { kind: "team"; item: TeamMonitorItem; updatedAt: number }
  | { kind: "session"; item: ClaudeSession; updatedAt: number };

export function buildWorkspaceSidebarTreeRows(input: {
  sessions: ReadonlyArray<ClaudeSession>;
  repositoryPath: string;
  showRunItems?: boolean;
  employeeMonitorItems?: ReadonlyArray<EmployeeMonitorItem>;
  sessionConversationTaskItems?: ReadonlyArray<SessionConversationTaskItem>;
  teamMonitorItems?: ReadonlyArray<TeamMonitorItem>;
}): WorkspaceSidebarTreeRow[] {
  const {
    sessions,
    repositoryPath,
    showRunItems = true,
    employeeMonitorItems,
    sessionConversationTaskItems,
    teamMonitorItems,
  } = input;

  const rows: WorkspaceSidebarTreeRow[] = [];

  if (showRunItems) {
    for (const item of filterEmployeeMonitorForRepository(employeeMonitorItems ?? [], repositoryPath)) {
      rows.push({ kind: "employee", item, updatedAt: item.updatedAt });
    }
    for (const item of filterDispatchTasksForRepository(
      sessionConversationTaskItems ?? [],
      repositoryPath,
    )) {
      rows.push({ kind: "dispatch", item, updatedAt: item.updatedAt });
    }
    for (const item of filterTeamMonitorForRepository(teamMonitorItems ?? [], repositoryPath)) {
      rows.push({ kind: "team", item, updatedAt: item.updatedAt });
    }
  }

  for (const item of listWorkspaceSidebarHistorySessions(sessions, repositoryPath)) {
    rows.push({ kind: "session", item, updatedAt: sessionUpdatedAtMs(item) });
  }

  rows.sort((a, b) => {
    const byTime = b.updatedAt - a.updatedAt;
    if (byTime !== 0) return byTime;
    // 时间相同：稳定次键，避免点击/重渲时行序互换。
    const aKey =
      a.kind === "session"
        ? a.item.id
        : a.kind === "employee"
          ? a.item.employeeId
          : a.kind === "dispatch"
            ? a.item.key
            : a.item.workflowId;
    const bKey =
      b.kind === "session"
        ? b.item.id
        : b.kind === "employee"
          ? b.item.employeeId
          : b.kind === "dispatch"
            ? b.item.key
            : b.item.workflowId;
    return aKey < bKey ? -1 : aKey > bKey ? 1 : 0;
  });
  return rows;
}

/** Cursor 式紧凑相对时间：刚刚 / 5m / 2h / 1d。 */
export function formatWorkspaceSidebarRelativeTime(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "—";
  const diffMs = Date.now() - value;
  if (diffMs < 45_000) return "刚刚";
  if (diffMs < 3_600_000) return `${Math.max(1, Math.floor(diffMs / 60_000))}m`;
  if (diffMs < 86_400_000) return `${Math.max(1, Math.floor(diffMs / 3_600_000))}h`;
  if (diffMs < 30 * 86_400_000) return `${Math.max(1, Math.floor(diffMs / 86_400_000))}d`;
  return new Date(value).toLocaleDateString("zh-CN", { month: "2-digit", day: "2-digit" });
}

export function workspaceSidebarSessionUpdatedAt(session: ClaudeSession): number {
  return sessionUpdatedAtMs(session);
}
