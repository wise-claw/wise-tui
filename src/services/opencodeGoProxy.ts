import { invoke } from "@tauri-apps/api/core";

/** Claude 模型名 → 上游覆盖。 */
export interface OpencodeGoModelOverride {
  provider?: string;
  modelId: string;
}

/** Wise 内置 OpenCode Go 代理状态（参考 oc-go-cc）。 */
export interface OpencodeGoProxyStatus {
  enabled: boolean;
  running: boolean;
  port: number;
  proxyBaseUrl: string | null;
  defaultModel: string;
  upstreamUrl: string;
  customUpstreamUrl: string;
  defaultUpstreamUrl: string;
  provider: string;
  fallbackModels: string[];
  modelOverrides: Record<string, OpencodeGoModelOverride>;
  hasApiKey: boolean;
  claudeSettingsAligned: boolean;
  traceCount: number;
  debug: boolean;
}

export const OPENCODE_GO_PROXY_REF_URL =
  "https://github.com/samueltuyizere/oc-go-cc";

export const OPENCODE_GO_SIGNUP_URL = "https://opencode.ai/go";

/** OpenCode 控制台用量页（账号 workspace）。 */
export const OPENCODE_GO_USAGE_URL =
  "https://opencode.ai/workspace/wrk_01KSGRZ100T1Y1PQMHSMTGE649/usage";

export const OPENCODE_GO_PROXY_DEFAULT_PORT = 9876;

export async function getOpencodeGoProxyStatus(): Promise<OpencodeGoProxyStatus> {
  return invoke<OpencodeGoProxyStatus>("get_opencode_go_proxy_status");
}

export interface OpencodeGoProxyPrefsInput {
  apiKey?: string;
  port?: number;
  defaultModel?: string;
  upstreamUrl?: string;
  provider?: string;
  fallbackModels?: string[];
  modelOverrides?: Record<string, OpencodeGoModelOverride>;
  debug?: boolean;
}

export interface SetOpencodeGoProxyConfigInput extends OpencodeGoProxyPrefsInput {
  enabled: boolean;
}

export async function saveOpencodeGoProxyPrefs(
  input: OpencodeGoProxyPrefsInput,
): Promise<OpencodeGoProxyStatus> {
  return invoke<OpencodeGoProxyStatus>("save_opencode_go_proxy_prefs", { input });
}

export async function switchOpencodeGoProxyModel(
  model: string,
): Promise<OpencodeGoProxyStatus> {
  return invoke<OpencodeGoProxyStatus>("switch_opencode_go_proxy_model", { model });
}

export async function setOpencodeGoProxyConfig(
  input: SetOpencodeGoProxyConfigInput,
): Promise<OpencodeGoProxyStatus> {
  return invoke<OpencodeGoProxyStatus>("set_opencode_go_proxy_config", { input });
}

export async function applyOpencodeGoProxyClaudeSettings(): Promise<boolean> {
  return invoke<boolean>("apply_opencode_go_proxy_claude_settings");
}

export interface ListOpencodeGoProxyModelsInput {
  provider?: string;
  apiKey?: string;
}

export async function listOpencodeGoProxyModels(
  input: ListOpencodeGoProxyModelsInput = {},
): Promise<string[]> {
  return invoke<string[]>("list_opencode_go_proxy_models", { input });
}
