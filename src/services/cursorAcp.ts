import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { CursorSdkAttachment } from "./cursorComposerPrompt";

export interface CursorAcpPermissionRequestPayload {
  sessionId: string;
  requestId: string;
  toolName: string;
  description: string;
  options?: unknown;
  raw?: unknown;
}

export interface CursorAcpAskQuestionPayload {
  sessionId: string;
  requestId: string;
  title?: string | null;
  questions?: Array<{
    id: string;
    prompt: string;
    options: Array<{ id: string; label: string }>;
    allowMultiple?: boolean;
  }>;
  toolCallId?: string | null;
  raw?: unknown;
}

export interface CursorAcpCreatePlanPayload {
  sessionId: string;
  requestId: string;
  name?: string | null;
  overview?: string | null;
  plan?: string | null;
  todos?: unknown;
  raw?: unknown;
}

export async function executeCursorAcp(input: {
  projectPath: string;
  prompt: string;
  model?: string;
  invocationKey?: string;
  tabSessionId?: string;
  cursorAgentId?: string;
  mode?: string;
  /** Defaults to true on the Rust side (legacy --force parity). */
  autoApprovePermissions?: boolean;
  cursorAttachments?: CursorSdkAttachment[];
}): Promise<void> {
  // Tauri 2 matches invoke keys to Rust arg names: `params: ExecuteCursorAcpParams`.
  await invoke("execute_cursor_acp", {
    params: {
      prompt: input.prompt,
      projectPath: input.projectPath,
      model: input.model,
      invocationKey: input.invocationKey,
      tabSessionId: input.tabSessionId,
      cursorAgentId: input.cursorAgentId?.trim() || null,
      mode: input.mode,
      autoApprovePermissions: input.autoApprovePermissions,
      cursorAttachments: input.cursorAttachments,
    },
  });
}

export async function interruptCursorAcp(sessionId: string): Promise<void> {
  await invoke("interrupt_cursor_acp", {
    params: { sessionId },
  });
}

export async function shutdownCursorAcp(sessionId: string): Promise<void> {
  await invoke("shutdown_cursor_acp", {
    params: { sessionId },
  });
}

export async function respondCursorAcpPermission(
  sessionId: string,
  requestId: string,
  decision: "allow-once" | "allow-always" | "reject-once" | "cancelled" | string,
): Promise<void> {
  await invoke("respond_cursor_acp_permission", {
    params: {
      sessionId,
      requestId,
      decision,
    },
  });
}

export async function respondCursorAcpQuestion(
  sessionId: string,
  requestId: string,
  outcome: unknown,
): Promise<void> {
  await invoke("respond_cursor_acp_question", {
    params: {
      sessionId,
      requestId,
      outcome,
    },
  });
}

export async function respondCursorAcpPlan(
  sessionId: string,
  requestId: string,
  outcome: unknown,
): Promise<void> {
  await invoke("respond_cursor_acp_plan", {
    params: {
      sessionId,
      requestId,
      outcome,
    },
  });
}

export function onCursorAcpPermissionRequest(
  callback: (payload: CursorAcpPermissionRequestPayload) => void,
): Promise<UnlistenFn> {
  return listen<CursorAcpPermissionRequestPayload>("cursor-acp:permission-request", (event) => {
    callback(event.payload);
  });
}

export function onCursorAcpAskQuestion(
  callback: (payload: CursorAcpAskQuestionPayload) => void,
): Promise<UnlistenFn> {
  return listen<CursorAcpAskQuestionPayload>("cursor-acp:ask-question", (event) => {
    callback(event.payload);
  });
}

export function onCursorAcpCreatePlan(
  callback: (payload: CursorAcpCreatePlanPayload) => void,
): Promise<UnlistenFn> {
  return listen<CursorAcpCreatePlanPayload>("cursor-acp:create-plan", (event) => {
    callback(event.payload);
  });
}
