import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export interface OpencodeAcpPermissionRequestPayload {
  sessionId: string;
  requestId: string;
  toolName: string;
  description: string;
  options?: unknown;
  raw?: unknown;
}

export async function executeOpencodeAcp(input: {
  projectPath: string;
  prompt: string;
  model?: string;
  invocationKey?: string;
  tabSessionId?: string;
  opencodeSessionId?: string | null;
  /** Defaults to true on the Rust side. */
  autoApprovePermissions?: boolean;
}): Promise<void> {
  // Tauri 2 matches invoke keys to Rust arg names: `params: ExecuteOpencodeAcpParams`.
  await invoke("execute_opencode_acp", {
    params: {
      prompt: input.prompt,
      projectPath: input.projectPath,
      model: input.model,
      invocationKey: input.invocationKey,
      tabSessionId: input.tabSessionId,
      opencodeSessionId: input.opencodeSessionId?.trim() || null,
      autoApprovePermissions: input.autoApprovePermissions,
    },
  });
}

export async function interruptOpencodeAcp(sessionId: string): Promise<void> {
  await invoke("interrupt_opencode_acp", {
    params: { sessionId },
  });
}

export async function shutdownOpencodeAcp(sessionId: string): Promise<void> {
  await invoke("shutdown_opencode_acp", {
    params: { sessionId },
  });
}

export async function respondOpencodeAcpPermission(
  sessionId: string,
  requestId: string,
  decision: "allow-once" | "allow-always" | "reject-once" | "cancelled" | string,
): Promise<void> {
  await invoke("respond_opencode_acp_permission", {
    params: {
      sessionId,
      requestId,
      decision,
    },
  });
}

export function onOpencodeAcpPermissionRequest(
  callback: (payload: OpencodeAcpPermissionRequestPayload) => void,
): Promise<UnlistenFn> {
  return listen<OpencodeAcpPermissionRequestPayload>(
    "opencode-acp:permission-request",
    (event) => {
      callback(event.payload);
    },
  );
}
