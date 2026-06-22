/** OpenCode 配置预设模板：为新增配置提供一键填充的 provider 块骨架。 */

export interface OpencodeProfileTemplate {
  id: string;
  label: string;
  description: string;
  /** @returns 序列化的 settingsJson（opencode.json 片段）。 */
  generate: () => string;
}

// ── 工具 ────────────────────────────────────────────────────────────────────

function json(v: unknown): string {
  return `${JSON.stringify(v, null, 2)}\n`;
}

// ── 模板定义 ─────────────────────────────────────────────────────────────────

const WISE_PROXY_DEFAULT_URL = "http://localhost:9876/v1";

/**
 * Wise 内置 OpenCode Go Proxy provider。
 * 用户只需填写 API Key，URL 默认指向 localhost:9876。
 */
export const OPENCODE_TEMPLATE_WISE_PROXY: OpencodeProfileTemplate = {
  id: "wise-proxy",
  label: "OpenCode Go Proxy",
  description: "Wise 内置 OpenCode Go 代理（localhost:9876），需填写 API Key",
  generate: () =>
    json({
      provider: {
        wise: {
          name: "Wise Proxy",
          npm: "@ai-sdk/openai-compatible",
          options: {
            baseURL: WISE_PROXY_DEFAULT_URL,
            apiKey: "",
          },
        },
      },
      model: "",
    }),
};

/**
 * 通用 OpenAI 兼容 API provider。
 * 适用于任何兼容 OpenAI / Chat Completions 接口的服务（如 Minimax、DeepSeek、百炼等）。
 */
export const OPENCODE_TEMPLATE_OPENAI_COMPATIBLE: OpencodeProfileTemplate = {
  id: "openai-compatible",
  label: "OpenAI 兼容 API",
  description: "通用 OpenAI 兼容接口，需填写 Base URL 与 API Key",
  generate: () =>
    json({
      provider: {
        openai: {
          name: "OpenAI Compatible",
          npm: "@ai-sdk/openai-compatible",
          options: {
            baseURL: "https://api.openai.com/v1",
            apiKey: "",
          },
        },
      },
      model: "",
    }),
};

/**
 * OpenCode Zen provider（opencode-zen npm 包）。
 */
export const OPENCODE_TEMPLATE_OPENCODE_ZEN: OpencodeProfileTemplate = {
  id: "opencode-zen",
  label: "OpenCode Zen",
  description: "sst/opencode-zen 原生 provider（支持 Claude 模型）",
  generate: () =>
    json({
      provider: {
        "opencode-zen": {
          name: "OpenCode Zen",
        },
      },
      model: "",
    }),
};

/** 所有内置模板。 */
export const OPENCODE_PROFILE_TEMPLATES: OpencodeProfileTemplate[] = [
  OPENCODE_TEMPLATE_WISE_PROXY,
  OPENCODE_TEMPLATE_OPENAI_COMPATIBLE,
  OPENCODE_TEMPLATE_OPENCODE_ZEN,
];

/** 按 id 查找模板。 */
export function findOpencodeProfileTemplate(
  id: string,
): OpencodeProfileTemplate | undefined {
  return OPENCODE_PROFILE_TEMPLATES.find((t) => t.id === id);
}
