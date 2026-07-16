import { invoke } from "@tauri-apps/api/core";

export interface OpencodeModelListItem {
  id: string;
  displayName: string;
}

export async function listOpencodeModels(): Promise<OpencodeModelListItem[]> {
  try {
    return await invoke<OpencodeModelListItem[]>("opencode_list_models");
  } catch {
    return [];
  }
}

export async function executeOpencodeCode(
  repositoryPath: string,
  prompt: string,
  model?: string,
  invocationKey?: string,
  tabSessionId?: string,
  trellisContextId?: string,
  opencodeResumeSessionId?: string,
  forceNewSession?: boolean,
): Promise<void> {
  const normalizedTrellisContextId = trellisContextId?.trim() || null;
  const normalizedResumeId = opencodeResumeSessionId?.trim() || null;
  return invoke("execute_opencode_code", {
    projectPath: repositoryPath,
    prompt,
    model,
    invocationKey,
    tabSessionId,
    trellisContextId: normalizedTrellisContextId,
    opencodeResumeSessionId: normalizedResumeId,
    forceNewSession: forceNewSession === true,
  });
}
