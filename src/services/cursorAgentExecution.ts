import { invoke } from "@tauri-apps/api/core";

export async function executeCursorCode(
  repositoryPath: string,
  prompt: string,
  model?: string,
  invocationKey?: string,
  tabSessionId?: string,
  cursorAgentId?: string,
  trellisContextId?: string,
): Promise<void> {
  const normalizedTrellisContextId = trellisContextId?.trim() || null;
  const normalizedCursorAgentId = cursorAgentId?.trim() || null;
  return invoke("execute_cursor_code", {
    projectPath: repositoryPath,
    prompt,
    model,
    invocationKey,
    tabSessionId,
    cursorAgentId: normalizedCursorAgentId,
    trellisContextId: normalizedTrellisContextId,
  });
}
