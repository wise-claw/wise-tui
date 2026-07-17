import { invoke } from "@tauri-apps/api/core";

export interface QoderModelListItem {
  id: string;
  displayName: string;
}

export async function listQoderModels(): Promise<QoderModelListItem[]> {
  try {
    return await invoke<QoderModelListItem[]>("qoder_list_models");
  } catch {
    return [];
  }
}

export async function executeQoderCode(
  repositoryPath: string,
  prompt: string,
  model?: string,
  invocationKey?: string,
  tabSessionId?: string,
  trellisContextId?: string,
  qoderResumeSessionId?: string,
  forceNewSession?: boolean,
): Promise<void> {
  const normalizedTrellisContextId = trellisContextId?.trim() || null;
  const normalizedResumeId = qoderResumeSessionId?.trim() || null;
  return invoke("execute_qoder_code", {
    projectPath: repositoryPath,
    prompt,
    model,
    invocationKey,
    tabSessionId,
    trellisContextId: normalizedTrellisContextId,
    qoderResumeSessionId: normalizedResumeId,
    forceNewSession: forceNewSession === true,
  });
}
