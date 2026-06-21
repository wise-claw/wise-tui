import type { ClaudeSession, Repository } from "../types";
import { isExecutionEnvironmentWorkerRepositoryName } from "./executionEnvironmentDispatch";
import {
  resolveMainOwnerAgentNameForRepositoryPath,
  resolveRepositoryMainSessionId,
} from "./repositoryMainSessionBinding";
import { extractBoundEmployeeNameFromDisplay } from "./sessionOwnerHints";

/** 运行面板派发记录应绑定到仓库主会话，而非终端/worker 标签。 */
export function resolveExecutionEnvironmentDispatchAnchorSessionId(input: {
  activeSessionId: string | null | undefined;
  sessions: readonly ClaudeSession[];
  repositoryMainSessionBindings: Record<string, string>;
  repositories: readonly Repository[];
}): string | null {
  const activeId = input.activeSessionId?.trim();
  if (!activeId) return null;

  const active = input.sessions.find((session) => session.id === activeId);
  if (!active) return activeId;

  const repoPath = active.repositoryPath?.trim();
  if (!repoPath) return activeId;

  const mainOwner = resolveMainOwnerAgentNameForRepositoryPath([...input.repositories], repoPath);
  const mainId = resolveRepositoryMainSessionId(
    repoPath,
    input.repositoryMainSessionBindings,
    [...input.sessions],
    mainOwner,
  );

  const isSidecarTab =
    isExecutionEnvironmentWorkerRepositoryName(active.repositoryName ?? "") ||
    Boolean(extractBoundEmployeeNameFromDisplay(active.repositoryName ?? ""));

  if (isSidecarTab && mainId) {
    return mainId;
  }

  return mainId ?? activeId;
}

/** 运行面板终端状态 / 历史：解析当前上下文下的仓库 cwd。 */
export function resolveMonitorRepositoryPath(input: {
  activeSessionId: string | null | undefined;
  sessions: readonly ClaudeSession[];
  repositoryMainSessionBindings: Record<string, string>;
  repositories: readonly Repository[];
  employeeItems?: ReadonlyArray<{ repositoryPath?: string | null }>;
  dispatchTasks?: ReadonlyArray<{ repositoryPath?: string | null }>;
}): string {
  const anchorId = resolveExecutionEnvironmentDispatchAnchorSessionId({
    activeSessionId: input.activeSessionId,
    sessions: input.sessions,
    repositoryMainSessionBindings: input.repositoryMainSessionBindings,
    repositories: input.repositories,
  });
  if (anchorId) {
    const anchor = input.sessions.find((session) => session.id === anchorId);
    if (anchor?.repositoryPath?.trim()) {
      return anchor.repositoryPath.trim();
    }
  }

  const activeId = input.activeSessionId?.trim();
  if (activeId) {
    const active = input.sessions.find((session) => session.id === activeId);
    if (active?.repositoryPath?.trim()) {
      return active.repositoryPath.trim();
    }
  }

  for (const item of input.employeeItems ?? []) {
    if (item.repositoryPath?.trim()) {
      return item.repositoryPath.trim();
    }
  }

  for (const task of input.dispatchTasks ?? []) {
    if (task.repositoryPath?.trim()) {
      return task.repositoryPath.trim();
    }
  }

  return "";
}
