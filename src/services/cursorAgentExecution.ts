import type { CursorMcpServerConfig } from "./cursorMcpConfig";
import type { CursorSdkAttachment } from "./cursorComposerPrompt";
import { executeCursorAcp } from "./cursorAcp";

/**
 * Cursor execution entry used by session engines.
 * Hard-cut to ACP (`execute_cursor_acp`); legacy `agent -p` is no longer used here.
 */
export async function executeCursorCode(
  repositoryPath: string,
  prompt: string,
  model?: string,
  invocationKey?: string,
  tabSessionId?: string,
  cursorAgentId?: string,
  _mcpServers?: Record<string, CursorMcpServerConfig>,
  cursorAttachments?: CursorSdkAttachment[],
  options?: {
    mode?: string;
    /** When omitted, Rust defaults to true (legacy --force parity). */
    autoApprovePermissions?: boolean;
  },
): Promise<void> {
  const normalizedCursorAgentId = cursorAgentId?.trim() || undefined;
  await executeCursorAcp({
    projectPath: repositoryPath,
    prompt,
    model,
    invocationKey,
    tabSessionId,
    cursorAgentId: normalizedCursorAgentId,
    mode: options?.mode,
    autoApprovePermissions: options?.autoApprovePermissions,
    cursorAttachments,
  });
}
