import { invoke } from "@tauri-apps/api/core";
import { executeOpencodeAcp } from "./opencodeAcp";

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

/**
 * OpenCode execution entry used by session engines.
 * Hard-cut to ACP (`execute_opencode_acp`); legacy `opencode run --format json`
 * CLI commands stay registered for backend parity but are no longer used here.
 */
export async function executeOpencodeCode(
  repositoryPath: string,
  prompt: string,
  model?: string,
  invocationKey?: string,
  tabSessionId?: string,
  opencodeResumeSessionId?: string,
  forceNewSession?: boolean,
): Promise<void> {
  const normalizedResumeId = opencodeResumeSessionId?.trim() || null;
  await executeOpencodeAcp({
    projectPath: repositoryPath,
    prompt,
    model,
    invocationKey,
    tabSessionId,
    opencodeSessionId: normalizedResumeId,
    // 与 legacy `--dangerously-skip-permissions` 对齐：默认自动批准权限。
    autoApprovePermissions: true,
  });
  void forceNewSession;
}
