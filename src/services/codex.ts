import { invoke } from "@tauri-apps/api/core";
import type { ClaudeProjectSkill } from "../types";

export interface CodexAuthStatus {
  ready: boolean;
  mode: "missing" | "chatgpt" | "api_key" | "authenticated" | string;
  detail: string;
}

let cachedAuthStatus: { value: CodexAuthStatus; expiresAt: number } | null = null;

export async function getCodexAuthStatus(force = false): Promise<CodexAuthStatus> {
  if (!force && cachedAuthStatus && cachedAuthStatus.expiresAt > Date.now()) {
    return cachedAuthStatus.value;
  }
  const value = await invoke<CodexAuthStatus>("codex_auth_status");
  cachedAuthStatus = { value, expiresAt: Date.now() + 30_000 };
  return value;
}

export async function loginCodexWithChatGpt(): Promise<CodexAuthStatus> {
  const value = await invoke<CodexAuthStatus>("codex_login_chatgpt");
  cachedAuthStatus = { value, expiresAt: Date.now() + 30_000 };
  return value;
}

export async function loginCodexWithApiKey(apiKey: string): Promise<CodexAuthStatus> {
  const value = await invoke<CodexAuthStatus>("codex_login_api_key", { apiKey });
  cachedAuthStatus = { value, expiresAt: Date.now() + 30_000 };
  return value;
}

export async function executeCodexCode(
  repositoryPath: string,
  prompt: string,
  model?: string,
  invocationKey?: string,
  tabSessionId?: string,
  codexResumeSessionId?: string,
  forceNewSession?: boolean,
  /** 短任务可强制只读且禁用审批，避免生成文本时意外修改仓库或等待交互。 */
  readOnly?: boolean,
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
    readOnly: readOnly === true,
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
  /** 短任务可强制只读且禁用审批，避免生成文本时意外修改仓库或等待交互。 */
  readOnly?: boolean,
): Promise<void> {
  const normalizedResumeId = codexResumeSessionId?.trim() || null;
  const trimmedEffort = effort?.trim();
  // "default" is a UI preference, never an app-server reasoning effort.
  const normalizedEffort = trimmedEffort && trimmedEffort !== "default" ? trimmedEffort : undefined;
  return invoke("execute_codex_rpc", {
    params: {
      projectPath: repositoryPath,
      prompt,
      model,
      ...(normalizedEffort ? { effort: normalizedEffort } : {}),
      invocationKey,
      tabSessionId,
      codexResumeSessionId: normalizedResumeId,
      readOnly: readOnly === true,
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
