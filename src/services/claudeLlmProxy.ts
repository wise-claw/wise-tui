import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export const CLAUDE_LLM_PROXY_RECORD_EVENT = "claude-llm-proxy-record";

export interface ClaudeLlmProxyRecord {
  id: string;
  timestampMs: number;
  method: string;
  path: string;
  /** 代理实际转发的完整 URL */
  upstreamUrl: string;
  statusCode: number | null;
  requestBodyPreview: string;
  responseBodyPreview: string;
  requestBytes: number;
  responseBytes: number;
  durationMs: number;
  /** 上游 RTT：至 HTTP 响应头返回（毫秒） */
  rttMs?: number | null;
  /** 上游响应 body 首字节（毫秒） */
  firstByteMs?: number | null;
  /** 流式首个 text/thinking token（毫秒） */
  ttftMs?: number | null;
  isStreaming: boolean;
  requestTruncated: boolean;
  responseTruncated: boolean;
  upstream: string;
}

export interface ClaudeLlmProxyStatus {
  listening: boolean;
  running: boolean;
  port: number | null;
  upstream: string;
  recordCount: number;
  localProxyUrl: string | null;
  suggestedUpstream: string;
}

export interface ClaudeLlmProxyConfigView extends ClaudeLlmProxyStatus {}

export interface SetClaudeLlmProxyConfigInput {
  listening: boolean;
  upstream?: string | null;
  projectPath?: string | null;
}

export async function listClaudeLlmProxyRecords(): Promise<ClaudeLlmProxyRecord[]> {
  return invoke<ClaudeLlmProxyRecord[]>("list_claude_llm_proxy_records");
}

export async function clearClaudeLlmProxyRecords(): Promise<void> {
  await invoke("clear_claude_llm_proxy_records");
}

export async function getClaudeLlmProxyStatus(
  projectPath?: string | null,
): Promise<ClaudeLlmProxyStatus> {
  return invoke<ClaudeLlmProxyStatus>("get_claude_llm_proxy_status", {
    projectPath: projectPath?.trim() || null,
  });
}

export async function getClaudeLlmProxyConfig(
  projectPath?: string | null,
): Promise<ClaudeLlmProxyConfigView> {
  return invoke<ClaudeLlmProxyConfigView>("get_claude_llm_proxy_config", {
    projectPath: projectPath?.trim() || null,
  });
}

export async function setClaudeLlmProxyConfig(
  input: SetClaudeLlmProxyConfigInput,
): Promise<ClaudeLlmProxyConfigView> {
  return invoke<ClaudeLlmProxyConfigView>("set_claude_llm_proxy_config", {
    input: {
      listening: input.listening,
      upstream: input.upstream?.trim() || null,
      projectPath: input.projectPath?.trim() || null,
    },
  });
}

export async function subscribeClaudeLlmProxyRecords(
  onRecord: (record: ClaudeLlmProxyRecord) => void,
): Promise<UnlistenFn> {
  return listen<ClaudeLlmProxyRecord>(CLAUDE_LLM_PROXY_RECORD_EVENT, (ev) => {
    if (ev.payload) onRecord(ev.payload);
  });
}
