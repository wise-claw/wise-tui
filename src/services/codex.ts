import { invoke } from "@tauri-apps/api/core";
import type { ClaudeProjectSkill } from "../types";

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

/** 枚举 Codex 用户级全局技能（`~/.codex/skills`、`~/.agents/skills`、`$CODEX_HOME/skills`）。 */
export async function listCodexUserSkills(): Promise<ClaudeProjectSkill[]> {
  return invoke<ClaudeProjectSkill[]>("list_codex_user_skills");
}

export async function executeCodexRpcCode(
  repositoryPath: string,
  prompt: string,
  model?: string,
  invocationKey?: string,
  tabSessionId?: string,
  codexResumeSessionId?: string,
  effort?: string,
): Promise<void> {
  const normalizedResumeId = codexResumeSessionId?.trim() || null;
  const normalizedEffort = effort?.trim() || undefined;
  return invoke("execute_codex_rpc", {
    params: {
      projectPath: repositoryPath,
      prompt,
      model,
      effort: normalizedEffort,
      invocationKey,
      tabSessionId,
      codexResumeSessionId: normalizedResumeId,
    },
  });
}

/** Codex 运行态/配置来源的模型选项（后端 `codex_list_models`）。 */
export interface CodexModelListItem {
  id: string;
  displayName: string;
  /** `model_providers.<id>` 或配置来源标识；可为空。 */
  provider?: string | null;
}

/** 从 Codex 运行态获取模型列表（`codex debug models` + `~/.codex/config.toml`）。 */
export async function listCodexModels(): Promise<CodexModelListItem[]> {
  try {
    return await invoke<CodexModelListItem[]>("codex_list_models");
  } catch {
    return [];
  }
}
