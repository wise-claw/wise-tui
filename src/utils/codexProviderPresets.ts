/** Codex 第三方 API Provider 预设：快速配置兼容 OpenAI 接口的第三方模型服务。 */

export interface CodexProviderPreset {
  /** 唯一标识 */
  id: string;
  /** 显示名称 */
  label: string;
  /** 简要说明 */
  description: string;
  /** 默认 Base URL（用户可覆盖） */
  defaultBaseUrl: string;
  /** 推荐的默认模型 ID */
  defaultModel: string;
  /** 可选推荐模型列表（model id → 显示名） */
  knownModels?: Record<string, string>;
  /** auth.json 中的认证字段名（默认 OPENAI_API_KEY） */
  authKey?: string;
  /** auth.json 中的 auth_mode 值（默认 apikey） */
  authMode?: string;
  /** config.toml 中 [model_providers.<id>] 使用的 provider id（默认与 id 相同） */
  tomlProviderId?: string;
  /** 是否需要 config.toml 中 [model_providers] 段（纯 OpenAI 兼容且 baseURL 在 auth 中时不需） */
  needsTomlProviderSection?: boolean;
}

/**
 * 内置 Codex 第三方 Provider 预设。
 * 按常用度排列。
 */
export const CODEX_PROVIDER_PRESETS: CodexProviderPreset[] = [
  {
    id: "custom",
    label: "自定义",
    description: "自定义 OpenAI 兼容接口，手动填写 Base URL 与 API Key",
    defaultBaseUrl: "https://api.openai.com/v1",
    defaultModel: "",
    needsTomlProviderSection: false,
  },
  {
    id: "deepseek",
    label: "DeepSeek",
    description: "DeepSeek API（兼容 OpenAI），支持 deepseek-chat / deepseek-reasoner",
    defaultBaseUrl: "https://api.deepseek.com/v1",
    defaultModel: "deepseek-chat",
    knownModels: {
      "deepseek-chat": "DeepSeek V3 / R1",
      "deepseek-reasoner": "DeepSeek R1 (Reasoner)",
    },
    tomlProviderId: "deepseek",
  },
  {
    id: "minimax",
    label: "MiniMax",
    description: "MiniMax 大模型 API（兼容 OpenAI）",
    defaultBaseUrl: "https://api.minimax.chat/v1",
    defaultModel: "minimax-text-01",
    knownModels: {
      "minimax-text-01": "MiniMax Text-01",
      "minimax-m1-regular": "MiniMax M1 Regular",
    },
    tomlProviderId: "minimax",
  },
  {
    id: "bailian",
    label: "百炼（阿里云千问）",
    description: "阿里云百炼平台 Qwen 系列 API（兼容 OpenAI）",
    defaultBaseUrl: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
    defaultModel: "qwen-max",
    knownModels: {
      "qwen-max": "Qwen Max",
      "qwen-plus": "Qwen Plus",
      "qwen-turbo": "Qwen Turbo",
      "qwen2.5-72b-instruct": "Qwen 2.5 72B",
    },
    tomlProviderId: "bailian",
  },
  {
    id: "volc",
    label: "火山引擎（豆包）",
    description: "火山引擎方舟平台豆包系列 API（兼容 OpenAI）",
    defaultBaseUrl: "https://ark.cn-beijing.volces.com/api/v3",
    defaultModel: "ep-xxxxxxxx",
    knownModels: {
      "doubao-1.5-pro-256k": "豆包 1.5 Pro (256k)",
      "doubao-1.5-lite-32k": "豆包 1.5 Lite (32k)",
    },
    tomlProviderId: "volc",
  },
  {
    id: "moonshot",
    label: "Moonshot（Kimi）",
    description: "Moonshot Kimi API（兼容 OpenAI）",
    defaultBaseUrl: "https://api.moonshot.cn/v1",
    defaultModel: "moonshot-v1-8k",
    knownModels: {
      "moonshot-v1-8k": "Kimi 8K",
      "moonshot-v1-32k": "Kimi 32K",
      "moonshot-v1-128k": "Kimi 128K",
    },
    authMode: "apikey",
    tomlProviderId: "moonshot",
  },
  {
    id: "glm",
    label: "智谱（GLM）",
    description: "智谱 AI 开放平台 GLM 系列 API（兼容 OpenAI）",
    defaultBaseUrl: "https://open.bigmodel.cn/api/paas/v4",
    defaultModel: "glm-5",
    knownModels: {
      "glm-5": "GLM-5",
      "glm-5-flash": "GLM-5 Flash",
      "glm-4-plus": "GLM-4 Plus",
    },
    tomlProviderId: "glm",
  },
  {
    id: "groq",
    label: "Groq",
    description: "Groq Cloud API（兼容 OpenAI），极速推理",
    defaultBaseUrl: "https://api.groq.com/openai/v1",
    defaultModel: "llama-3.3-70b-versatile",
    knownModels: {
      "llama-3.3-70b-versatile": "Llama 3.3 70B",
      "llama-3.1-8b-instant": "Llama 3.1 8B",
      "mixtral-8x7b-32768": "Mixtral 8x7B",
    },
    tomlProviderId: "groq",
  },
  {
    id: "together",
    label: "Together AI",
    description: "Together AI API（兼容 OpenAI），多种开源模型",
    defaultBaseUrl: "https://api.together.xyz/v1",
    defaultModel: "meta-llama/Meta-Llama-3.1-70B-Instruct-Turbo",
    authMode: "apikey",
    tomlProviderId: "together",
  },
];

/** 按 id 查找预设。 */
export function findCodexProviderPreset(
  id: string,
): CodexProviderPreset | undefined {
  return CODEX_PROVIDER_PRESETS.find((p) => p.id === id);
}

/**
 * 生成 Codex 的 config.toml provider 段。
 * 当 baseURL 与默认不同、或需要显式 provider 定义时生成。
 */
export function renderCodexTomlProviderSection(
  preset: CodexProviderPreset,
  baseUrl: string,
): string {
  const providerId = preset.tomlProviderId || preset.id;
  const escapedBaseUrl = baseUrl.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  const envKey = preset.authKey || "OPENAI_API_KEY";

  return [
    "",
    `[model_providers.${providerId}]`,
    `name = "${preset.label}"`,
    `base_url = "${escapedBaseUrl}"`,
    `env_key = "${envKey}"`,
    "",
  ].join("\n");
}
