import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export interface DeepseekAcpPermissionRequestPayload {
  sessionId: string;
  requestId: string;
  toolName: string;
  description: string;
  options?: unknown;
  raw?: unknown;
}

export async function executeDeepseekAcp(input: {
  projectPath: string;
  prompt: string;
  model?: string;
  invocationKey?: string;
  tabSessionId?: string;
  deepseekSessionId?: string | null;
  /** Defaults to true on the Rust side. */
  autoApprovePermissions?: boolean;
}): Promise<void> {
  // Tauri 2 matches invoke keys to Rust arg names: `params: ExecuteDeepseekAcpParams`.
  await invoke("execute_deepseek_acp", {
    params: {
      prompt: input.prompt,
      projectPath: input.projectPath,
      model: input.model,
      invocationKey: input.invocationKey,
      tabSessionId: input.tabSessionId,
      deepseekSessionId: input.deepseekSessionId?.trim() || null,
      autoApprovePermissions: input.autoApprovePermissions,
    },
  });
}

export async function interruptDeepseekAcp(sessionId: string): Promise<void> {
  await invoke("interrupt_deepseek_acp", {
    params: { sessionId },
  });
}

export async function shutdownDeepseekAcp(sessionId: string): Promise<void> {
  await invoke("shutdown_deepseek_acp", {
    params: { sessionId },
  });
}

export async function respondDeepseekAcpPermission(
  sessionId: string,
  requestId: string,
  decision: "allow-once" | "allow-always" | "reject-once" | "cancelled" | string,
): Promise<void> {
  await invoke("respond_deepseek_acp_permission", {
    params: {
      sessionId,
      requestId,
      decision,
    },
  });
}

export function onDeepseekAcpPermissionRequest(
  callback: (payload: DeepseekAcpPermissionRequestPayload) => void,
): Promise<UnlistenFn> {
  return listen<DeepseekAcpPermissionRequestPayload>(
    "deepseek-acp:permission-request",
    (event) => {
      callback(event.payload);
    },
  );
}
