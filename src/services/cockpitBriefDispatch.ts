import type { RunAssistantBriefDetail } from "../constants/workflowUiEvents";
import { gitStatus } from "./git";
import {
  patchCockpitConversation,
  recordCockpitConversation,
  runningCockpitConversations,
  cockpitRunStatusFromSessionStatus,
} from "./cockpitConversationStore";
import {
  cockpitConversationTitle,
  cockpitPromptPreview,
  collectGitChangedPaths,
} from "../utils/cockpitConversation";
import type { ClaudeSession } from "../types";

export interface CockpitBriefDispatchDeps {
  createSession: (
    repositoryPath: string,
    repositoryName: string,
    opts?: { skipActivate?: boolean; connectionKind?: "oneshot" | "streaming" },
  ) => Promise<string>;
  executeSession: (sessionId: string, prompt: string) => boolean;
  closeSession: (sessionId: string) => void | Promise<void>;
  readGitStatus?: typeof gitStatus;
}

export type CockpitBriefDispatchInput = RunAssistantBriefDetail & {
  repositoryPath?: string | null;
  repositoryName?: string | null;
  projectName?: string | null;
};

export function buildCockpitBriefSessionName(repositoryName: string, assistantName: string): string {
  const repo = repositoryName.trim() || "仓库";
  const assistant = assistantName.trim() || "助手";
  const stamp = new Date().toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  return `${repo}/助手:${assistant}·${stamp}`;
}

export async function dispatchCockpitAssistantBrief(
  deps: CockpitBriefDispatchDeps,
  input: CockpitBriefDispatchInput,
): Promise<{ ok: boolean; reason?: string; conversationId?: string; sessionId?: string }> {
  const prompt = input.prompt.trim();
  if (!prompt) return { ok: false, reason: "empty_prompt" };
  const repositoryPath = input.repositoryPath?.trim() ?? "";
  if (!repositoryPath) return { ok: false, reason: "no_repository" };

  const repositoryName = input.repositoryName?.trim() || repositoryPath;
  const record = await recordCockpitConversation({
    assistantId: input.assistantId.trim(),
    assistantName: input.assistantName.trim() || input.assistantId.trim(),
    sessionId: null,
    repositoryPath,
    repositoryName,
    projectId: input.projectId?.trim() || null,
    projectName: input.projectName?.trim() || null,
    title: cockpitConversationTitle(prompt),
    promptPreview: cockpitPromptPreview(prompt),
    status: "running",
    artifactPaths: [],
  });

  let sessionId: string | null = null;
  try {
    sessionId = await deps.createSession(
      repositoryPath,
      buildCockpitBriefSessionName(repositoryName, input.assistantName),
      { skipActivate: true, connectionKind: "streaming" },
    );
    const started = deps.executeSession(sessionId, prompt);
    if (started === false) {
      void deps.closeSession(sessionId);
      await patchCockpitConversation(record.id, { status: "failed", sessionId: null });
      return { ok: false, reason: "busy", conversationId: record.id };
    }
    await patchCockpitConversation(record.id, { sessionId });
    return { ok: true, conversationId: record.id, sessionId };
  } catch (error) {
    if (sessionId) void deps.closeSession(sessionId);
    await patchCockpitConversation(record.id, { status: "failed", sessionId });
    return {
      ok: false,
      reason: error instanceof Error ? error.message : String(error),
      conversationId: record.id,
    };
  }
}

export async function finalizeCockpitRunsFromSessions(
  sessions: readonly Pick<ClaudeSession, "id" | "status" | "repositoryPath">[],
  readGitStatus: typeof gitStatus = gitStatus,
): Promise<void> {
  const running = runningCockpitConversations();
  if (running.length === 0) return;
  const byId = new Map(sessions.map((session) => [session.id, session]));
  for (const record of running) {
    const session = record.sessionId ? byId.get(record.sessionId) : undefined;
    if (!session) continue;
    const nextStatus = cockpitRunStatusFromSessionStatus(session.status);
    if (nextStatus === "running") continue;
    let artifactPaths = record.artifactPaths;
    try {
      const status = await readGitStatus(record.repositoryPath || session.repositoryPath);
      artifactPaths = collectGitChangedPaths(status);
    } catch {
      /* git 不可用时仍结束运行状态 */
    }
    await patchCockpitConversation(record.id, { status: nextStatus, artifactPaths });
  }
}
