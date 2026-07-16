import { invoke } from "@tauri-apps/api/core";

export const CURSOR_API_KEY_SETTING = "cursor_sdk.api_key";

export interface CursorAgentStatus {
  available: boolean;
  cliAvailable: boolean;
  apiKeyConfigured: boolean;
  authenticated?: boolean;
  cliVersion?: string;
  cliPath?: string;
  failureReason?: string;
}

export interface CursorModelListItem {
  id: string;
  displayName: string;
  description?: string | null;
  aliases?: string[];
}

export async function listCursorModels(): Promise<CursorModelListItem[]> {
  try {
    return await invoke<CursorModelListItem[]>("cursor_agent_list_models");
  } catch {
    return [];
  }
}

export async function getCursorAgentStatus(
  repositoryPath?: string | null,
): Promise<CursorAgentStatus> {
  const normalized = repositoryPath?.trim() || null;
  return invoke<CursorAgentStatus>("cursor_agent_get_status", {
    repositoryPath: normalized,
  });
}

export async function probeCursorAgent(
  repositoryPath?: string | null,
): Promise<CursorAgentStatus> {
  const normalized = repositoryPath?.trim() || null;
  return invoke<CursorAgentStatus>("cursor_agent_probe", {
    repositoryPath: normalized,
  });
}

export async function setCursorApiKey(apiKey: string): Promise<void> {
  const trimmed = apiKey.trim();
  if (!trimmed) {
    throw new Error("Cursor API Key 不能为空");
  }
  await invoke("cursor_agent_set_api_key", { apiKey: trimmed });
}

export async function clearCursorApiKey(): Promise<void> {
  await invoke("cursor_agent_clear_api_key");
}

export async function saveCursorApiKeySetting(apiKey: string): Promise<void> {
  await setCursorApiKey(apiKey);
}

export async function deleteCursorApiKeySetting(): Promise<void> {
  await clearCursorApiKey();
}

export function describeCursorAgentStatus(status: CursorAgentStatus): string {
  if (status.available) {
    return "Cursor CLI 已就绪";
  }
  if (!status.cliAvailable) {
    return status.failureReason ?? "未找到 Cursor Agent CLI（agent）";
  }
  if (status.authenticated === false) {
    return status.failureReason ?? "请运行 agent login，或在设置中配置 API Key";
  }
  if (!status.apiKeyConfigured && status.authenticated !== true) {
    return "请运行 agent login，或在设置中配置 Cursor API Key";
  }
  return status.failureReason ?? "Cursor CLI 暂不可用";
}
