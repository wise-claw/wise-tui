import { invoke } from "@tauri-apps/api/core";
import type { CursorMcpServerConfig } from "./cursorMcpConfig";
import type { CursorSdkAttachment } from "./cursorComposerPrompt";

export async function executeCursorCode(
  repositoryPath: string,
  prompt: string,
  model?: string,
  invocationKey?: string,
  tabSessionId?: string,
  cursorAgentId?: string,
  trellisContextId?: string,
  mcpServers?: Record<string, CursorMcpServerConfig>,
  cursorAttachments?: CursorSdkAttachment[],
): Promise<void> {
  const normalizedTrellisContextId = trellisContextId?.trim() || null;
  const normalizedCursorAgentId = cursorAgentId?.trim() || null;
  const normalizedMcpServers =
    mcpServers && Object.keys(mcpServers).length > 0 ? mcpServers : null;
  const normalizedAttachments =
    cursorAttachments && cursorAttachments.length > 0 ? cursorAttachments : null;
  return invoke("execute_cursor_code", {
    projectPath: repositoryPath,
    prompt,
    model,
    mcpServers: normalizedMcpServers,
    cursorAttachments: normalizedAttachments,
    invocationKey,
    tabSessionId,
    cursorAgentId: normalizedCursorAgentId,
    trellisContextId: normalizedTrellisContextId,
  });
}
