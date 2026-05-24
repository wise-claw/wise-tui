import { invoke } from "@tauri-apps/api/core";

export async function executeCodexCode(
  repositoryPath: string,
  prompt: string,
  model?: string,
  invocationKey?: string,
  tabSessionId?: string,
  trellisContextId?: string,
): Promise<void> {
  const normalizedTrellisContextId = trellisContextId?.trim() || null;
  return invoke("execute_codex_code", {
    projectPath: repositoryPath,
    prompt,
    model,
    invocationKey,
    tabSessionId,
    trellisContextId: normalizedTrellisContextId,
  });
}
