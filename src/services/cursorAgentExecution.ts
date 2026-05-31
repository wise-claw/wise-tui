import { invoke } from "@tauri-apps/api/core";
import type { CursorMcpServerConfig } from "./cursorMcpConfig";

export async function executeCursorCode(
  repositoryPath: string,
  prompt: string,
  model?: string,
  invocationKey?: string,
  tabSessionId?: string,
  cursorAgentId?: string,
  trellisContextId?: string,
  mcpServers?: Record<string, CursorMcpServerConfig>,
): Promise<void> {
  const normalizedTrellisContextId = trellisContextId?.trim() || null;
  const normalizedCursorAgentId = cursorAgentId?.trim() || null;
  const normalizedMcpServers =
    mcpServers && Object.keys(mcpServers).length > 0 ? mcpServers : null;
  return invoke("execute_cursor_code", {
    projectPath: repositoryPath,
    prompt,
    model,
    mcpServers: normalizedMcpServers,
    invocationKey,
    tabSessionId,
    cursorAgentId: normalizedCursorAgentId,
    trellisContextId: normalizedTrellisContextId,
  });
}
