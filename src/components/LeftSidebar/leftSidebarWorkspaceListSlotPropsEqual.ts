import type { ClaudeHostProcess } from "../../types";
import type { ProjectRepositoryListEqualProps } from "./projectRepositoryListPropsEqual";
import { projectRepositoryListPropsEqual } from "./projectRepositoryListPropsEqual";

export type LeftSidebarWorkspaceListSlotEqualProps = ProjectRepositoryListEqualProps & {
  showLeftSidebarWorkspaceList: boolean;
  globalWorkspaceTodoAddOpen: boolean;
  sessionsStructureKey: string;
  repositoryMainSessionBindings: Record<string, string>;
  claudeProcessFingerprint: string;
  claudeRegistryRunningFingerprint: string;
};

/** 工作区列表 slot：忽略回调；会话 id 变化但选中态未变时跳过重渲染与 badge 钩子。 */
export function leftSidebarWorkspaceListSlotPropsEqual(
  prev: LeftSidebarWorkspaceListSlotEqualProps,
  next: LeftSidebarWorkspaceListSlotEqualProps,
): boolean {
  if (prev.showLeftSidebarWorkspaceList !== next.showLeftSidebarWorkspaceList) return false;
  if (prev.globalWorkspaceTodoAddOpen !== next.globalWorkspaceTodoAddOpen) return false;
  if (prev.sessionsStructureKey !== next.sessionsStructureKey) return false;
  if (prev.repositoryMainSessionBindings !== next.repositoryMainSessionBindings) return false;
  if (prev.claudeProcessFingerprint !== next.claudeProcessFingerprint) return false;
  if (prev.claudeRegistryRunningFingerprint !== next.claudeRegistryRunningFingerprint) {
    return false;
  }
  return projectRepositoryListPropsEqual(prev, next);
}

export function buildClaudeProcessFingerprint(
  processes: ReadonlyArray<ClaudeHostProcess>,
): string {
  if (!processes.length) return "";
  return processes.map((item) => `${item.pid}:${item.sessionId ?? ""}`).join("|");
}

export function buildClaudeRegistryRunningFingerprint(
  ids: ReadonlySet<string> | undefined,
): string {
  if (!ids?.size) return "";
  return [...ids].sort().join("|");
}
