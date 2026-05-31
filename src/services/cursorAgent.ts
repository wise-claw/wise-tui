import { invoke } from "@tauri-apps/api/core";

export const CURSOR_API_KEY_SETTING = "cursor_sdk.api_key";

export interface CursorAgentStatus {
  available: boolean;
  bunAvailable: boolean;
  bridgeAvailable: boolean;
  sdkAvailable: boolean;
  apiKeyConfigured: boolean;
  apiKeyValid?: boolean;
  failureReason?: string;
}

export async function getCursorAgentStatus(): Promise<CursorAgentStatus> {
  return invoke<CursorAgentStatus>("cursor_agent_get_status");
}

export async function probeCursorAgent(): Promise<CursorAgentStatus> {
  return invoke<CursorAgentStatus>("cursor_agent_probe");
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
    return "Cursor SDK 已就绪（Local Agent）";
  }
  if (!status.bunAvailable) {
    return "需要 Bun 才能运行 Cursor SDK bridge";
  }
  if (!status.bridgeAvailable) {
    return "未找到 cursor-sdk-bridge.ts";
  }
  if (!status.sdkAvailable) {
    return "项目未安装 @cursor/sdk";
  }
  if (!status.apiKeyConfigured) {
    return "请在设置中配置 Cursor API Key";
  }
  if (status.apiKeyValid === false) {
    return status.failureReason ?? "Cursor API Key 校验失败";
  }
  return status.failureReason ?? "Cursor SDK 暂不可用";
}
