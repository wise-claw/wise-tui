import type { ClaudeSession, Repository } from "../../types";
import { sessionsReactiveStructureKey } from "../../utils/sessionConversationTasks";
import { arePropsEqualSkipping } from "../../utils/reactPropsEqual";
import { claudeChatSessionPropsEqual } from "./claudeChatPropsEqual";
import type { ClaudeSessionsChatHostProps } from "./ClaudeSessionsChatHost";

function repositoryScopeFingerprint(repo: Repository | undefined): string {
  if (!repo) return "";
  return `${repo.id}|${repo.path}|${repo.name ?? ""}`;
}

function activeSessionStructureEqual(
  prev: ClaudeSession | null,
  next: ClaudeSession | null,
): boolean {
  if (prev === next) return true;
  if (!prev || !next) return !prev && !next;
  return claudeChatSessionPropsEqual(prev, next);
}

/** ChatHost memo：结构级 props 变化才重挂载多屏/单屏聊天区。 */
export function claudeSessionsChatHostPropsEqual(
  prev: ClaudeSessionsChatHostProps,
  next: ClaudeSessionsChatHostProps,
): boolean {
  if (
    sessionsReactiveStructureKey(prev.incomingSessions) !==
    sessionsReactiveStructureKey(next.incomingSessions)
  ) {
    return false;
  }
  if (sessionsReactiveStructureKey(prev.sessions) !== sessionsReactiveStructureKey(next.sessions)) {
    return false;
  }
  if (!activeSessionStructureEqual(prev.activeSession, next.activeSession)) return false;
  if (prev.activeSessionId !== next.activeSessionId) return false;
  if (repositoryScopeFingerprint(prev.activeRepository) !== repositoryScopeFingerprint(next.activeRepository)) {
    return false;
  }
  if (prev.repositories !== next.repositories) return false;
  if (prev.activeRepositoryId !== next.activeRepositoryId) return false;
  if (prev.workspaceMode !== next.workspaceMode) return false;
  if (prev.activeProject !== next.activeProject) return false;
  if (prev.projects !== next.projects) return false;
  if (prev.activeWorkspaceFocus !== next.activeWorkspaceFocus) return false;
  if (prev.paneCount !== next.paneCount) return false;
  if (prev.extraPanes !== next.extraPanes) return false;
  if (prev.primaryPaneRuntimeOverride !== next.primaryPaneRuntimeOverride) return false;
  if (prev.paneRepoTreeData !== next.paneRepoTreeData) return false;
  if (prev.projectsById !== next.projectsById) return false;
  if (!activeSessionStructureEqual(prev.mainSessionForDataLink, next.mainSessionForDataLink)) {
    return false;
  }
  if (repositoryScopeFingerprint(prev.chatContextRepository) !== repositoryScopeFingerprint(next.chatContextRepository)) {
    return false;
  }
  if (prev.hideMessages !== next.hideMessages) return false;
  if (prev.hideSessionTools !== next.hideSessionTools) return false;
  if (prev.panelBelowMessages !== next.panelBelowMessages) return false;
  if (prev.centerAuxPanelsNodeByPaneVersion !== next.centerAuxPanelsNodeByPaneVersion) return false;
  if (prev.omcBatchPipelineActive !== next.omcBatchPipelineActive) return false;
  if (prev.composerHideEmployeesInAtMode !== next.composerHideEmployeesInAtMode) return false;
  if (prev.workflowTasks !== next.workflowTasks) return false;
  if (prev.taskPendingEmployeesByTaskId !== next.taskPendingEmployeesByTaskId) return false;
  if (prev.workflowTemplates !== next.workflowTemplates) return false;
  if (prev.workflowGraphsByWorkflowId !== next.workflowGraphsByWorkflowId) return false;
  if (prev.workflowGraphStatusByWorkflowId !== next.workflowGraphStatusByWorkflowId) return false;
  if (prev.employees !== next.employees) return false;
  if (prev.mentionEmployees !== next.mentionEmployees) return false;
  if (prev.composerProjectRoleTagOptions !== next.composerProjectRoleTagOptions) return false;
  if (prev.composerProjectRepositoryMentionOptions !== next.composerProjectRepositoryMentionOptions) {
    return false;
  }
  return arePropsEqualSkipping(prev, next, {
    skipKeys: [
      "incomingSessions",
      "sessions",
      "activeSession",
      "mainSessionForDataLink",
      "activeRepository",
      "chatContextRepository",
      "paneRepoTreeData",
      "projectsById",
      "panelBelowMessages",
    ],
    skipFunctions: true,
  });
}
