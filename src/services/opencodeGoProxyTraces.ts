import { invoke } from "@tauri-apps/api/core";
import type { OpencodeGoProxyTraceEntry } from "../types/opencodeGoProxyTrace";

export interface OpencodeGoProxyValidation {
  ok: boolean;
  apiKeyValid: boolean;
  modelCount: number;
  defaultModelAvailable: boolean;
  messages: string[];
}

export interface ListOpencodeGoProxyTracesInput {
  limit?: number;
  sinceMs?: number;
}

export async function listOpencodeGoProxyTraces(
  input: ListOpencodeGoProxyTracesInput = {},
): Promise<OpencodeGoProxyTraceEntry[]> {
  const { limit = 200, sinceMs } = input;
  return invoke<OpencodeGoProxyTraceEntry[]>("list_opencode_go_proxy_traces", {
    limit,
    sinceMs,
  });
}

export async function clearOpencodeGoProxyTraces(): Promise<number> {
  return invoke<number>("clear_opencode_go_proxy_traces");
}

export async function validateOpencodeGoProxyConfig(): Promise<OpencodeGoProxyValidation> {
  return invoke<OpencodeGoProxyValidation>("validate_opencode_go_proxy_config");
}
