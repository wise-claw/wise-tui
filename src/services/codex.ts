import { invoke } from "@tauri-apps/api/core";

export async function executeCodexCode(
  repositoryPath: string,
  prompt: string,
  model?: string,
  invocationKey?: string,
  tabSessionId?: string,
  codexResumeSessionId?: string,
  forceNewSession?: boolean,
): Promise<void> {
  const normalizedResumeId = codexResumeSessionId?.trim() || null;
  return invoke("execute_codex_code", {
    projectPath: repositoryPath,
    prompt,
    model,
    invocationKey,
    tabSessionId,
    codexResumeSessionId: normalizedResumeId,
    forceNewSession: forceNewSession === true,
  });
}

export async function executeCodexRpcCode(
  repositoryPath: string,
  prompt: string,
  model?: string,
  invocationKey?: string,
  tabSessionId?: string,
  codexResumeSessionId?: string,
): Promise<void> {
  const normalizedResumeId = codexResumeSessionId?.trim() || null;
  return invoke("execute_codex_rpc", {
    params: {
      projectPath: repositoryPath,
      prompt,
      model,
      invocationKey,
      tabSessionId,
      codexResumeSessionId: normalizedResumeId,
    },
  });
}
