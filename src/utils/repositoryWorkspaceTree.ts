import type {
  ClaudeSession,
  EmployeeMonitorItem,
  Repository,
  SessionConversationTaskItem,
  TeamMonitorItem,
} from "../types";
import { isConventionalCommitPromptHistorySession } from "./conventionalCommitMessage";
import { repositoryPathsMatch } from "./repositoryMainSessionBinding";
import { isSessionFeedbackLoopHistorySession } from "./sessionFeedbackLoopDispatch";
import { listSessionsForRepositoryPath, dedupeClaudeSessionsByIdentity } from "./sessionHistoryScope";
import { sortRepositoriesByWorkspaceOrder } from "./workspaceRepositoryOrder";

/** 仓库展开子树默认展示行数（终端/派发/工作流 + 会话合计，不含 More）。 */
export const WORKSPACE_SIDEBAR_ROW_PREVIEW_LIMIT = 5;

/** 侧栏「更多」每次追加的行数。 */
export const WORKSPACE_SIDEBAR_ROW_MORE_STEP = 10;

/** @deprecated 使用 WORKSPACE_SIDEBAR_ROW_PREVIEW_LIMIT */
export const WORKSPACE_SIDEBAR_SESSION_PREVIEW_LIMIT = WORKSPACE_SIDEBAR_ROW_PREVIEW_LIMIT;

function excludeUtilityHistorySessions(sessions: ClaudeSession[]): ClaudeSession[] {
  return sessions.filter(
    (session) =>
      !isConventionalCommitPromptHistorySession(session) &&
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

function employeeIsRunning(item: EmployeeMonitorItem): boolean {
  return item.status === "in_progress";
}

function dispatchIsRunning(item: SessionConversationTaskItem): boolean {
  return item.status === "running";
}

function teamIsRunning(item: TeamMonitorItem): boolean {
  return item.status === "in_progress";
}

/** 运行中项排前，其余按 updatedAt 倒序。 */
export function sortEmployeeMonitorRunningFirst(
  items: ReadonlyArray<EmployeeMonitorItem>,
): EmployeeMonitorItem[] {
  return [...items].sort((a, b) => {
    const ar = employeeIsRunning(a) ? 1 : 0;
    const br = employeeIsRunning(b) ? 1 : 0;
    if (ar !== br) return br - ar;
    return b.updatedAt - a.updatedAt;
  });
}

export function sortDispatchTasksRunningFirst(
  items: ReadonlyArray<SessionConversationTaskItem>,
): SessionConversationTaskItem[] {
  return [...items].sort((a, b) => {
    const ar = dispatchIsRunning(a) ? 1 : 0;
    const br = dispatchIsRunning(b) ? 1 : 0;
    if (ar !== br) return br - ar;
    return b.updatedAt - a.updatedAt;
  });
}

export function sortTeamMonitorRunningFirst(
  items: ReadonlyArray<TeamMonitorItem>,
): TeamMonitorItem[] {
  return [...items].sort((a, b) => {
    const ar = teamIsRunning(a) ? 1 : 0;
    const br = teamIsRunning(b) ? 1 : 0;
    if (ar !== br) return br - ar;
    return b.updatedAt - a.updatedAt;
  });
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
