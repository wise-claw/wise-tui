import { invoke } from "@tauri-apps/api/core";
import { executeDeepseekAcp } from "./deepseekAcp";

export interface DeepSeekModelListItem {
  id: string;
  displayName: string;
  description?: string | null;
}

export async function listDeepSeekModels(): Promise<DeepSeekModelListItem[]> {
  try {
    return await invoke<DeepSeekModelListItem[]>("deepseek_list_models");
  } catch {
    return [];
  }
}

/**
 * DeepSeek Harness 主会话回合：走 `dsh --profile acp` 的长驻 ACP 进程，
 * 与 OpenCode / Cursor 共用 claude-* invocation 流事件。
 */
export async function executeDeepseekCode(
  repositoryPath: string,
  prompt: string,
  model?: string,
  invocationKey?: string,
  tabSessionId?: string,
  deepseekResumeSessionId?: string,
): Promise<void> {
  const normalizedResumeId = deepseekResumeSessionId?.trim() || null;
  await executeDeepseekAcp({
    projectPath: repositoryPath,
    prompt,
    model,
    invocationKey,
    tabSessionId,
    deepseekSessionId: normalizedResumeId,
    autoApprovePermissions: true,
  });
}
