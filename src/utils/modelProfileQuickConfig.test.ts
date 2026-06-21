import { describe, expect, test } from "bun:test";
import {
  extractClaudeQuickConfig,
  extractCodexQuickConfig,
  extractOpencodeQuickConfig,
  isModelProfileQuickConfigDirty,
  isSameModelProfileQuickConfig,
  mergeClaudeQuickConfig,
  mergeCodexQuickConfig,
  mergeOpencodeQuickConfig,
  tryMergeClaudeQuickConfig,
  tryMergeOpencodeQuickConfig,
} from "./modelProfileQuickConfig";

describe("modelProfileQuickConfig", () => {
  test("extracts and merges Claude Code env fields", () => {
    const raw = JSON.stringify(
      {
        availableModels: ["old-model"],
        env: {
          ANTHROPIC_AUTH_TOKEN: "token-old",
          ANTHROPIC_BASE_URL: "https://old.example.com",
          ANTHROPIC_MODEL: "old-model",
          ANTHROPIC_DEFAULT_SONNET_MODEL: "old-model",
        },
      },
      null,
      2,
    );

    expect(extractClaudeQuickConfig(raw)).toEqual({
      url: "https://old.example.com",
      auth: "token-old",
      model: "old-model",
    });

    const merged = mergeClaudeQuickConfig(raw, {
      url: "https://ark.example.com/api/coding",
      auth: "token-new",
      model: "glm-5.1",
    });
    const parsed = JSON.parse(merged) as {
      env: Record<string, string>;
      model: string;
      availableModels: string[];
    };
    expect(parsed.env.ANTHROPIC_BASE_URL).toBe("https://ark.example.com/api/coding");
    expect(parsed.env.ANTHROPIC_AUTH_TOKEN).toBe("token-new");
    expect(parsed.env.ANTHROPIC_MODEL).toBe("glm-5.1");
    expect(parsed.env.ANTHROPIC_DEFAULT_SONNET_MODEL).toBe("glm-5.1");
    expect(parsed.model).toBe("glm-5.1");
    expect(parsed.availableModels).toContain("glm-5.1");
  });

  test("extracts and merges Codex auth and config", () => {
    const authJson = JSON.stringify({ OPENAI_API_KEY: "sk-old", auth_mode: "apikey" }, null, 2);
    const configToml = 'model = "gpt-5.4"\nmodel_reasoning_effort = "medium"\n';

    expect(extractCodexQuickConfig(authJson, configToml)).toEqual({
      url: "",
      auth: "sk-old",
      model: "gpt-5.4",
    });

    const merged = mergeCodexQuickConfig(authJson, configToml, {
      url: "https://api.example.com/v1",
      auth: "sk-new",
      model: "gpt-5.5",
    });
    expect(JSON.parse(merged.authJson)).toEqual({
      OPENAI_API_KEY: "sk-new",
      auth_mode: "apikey",
      OPENAI_BASE_URL: "https://api.example.com/v1",
    });
    expect(merged.configToml).toContain('model = "gpt-5.5"');
    expect(merged.configToml).toContain('model_reasoning_effort = "medium"');
  });

  test("patches active model_provider base_url section", () => {
    const authJson = "{}";
    const configToml = `model_provider = "wise-opencode"
[model_providers.wise-opencode]
base_url = "https://old.example.com/v1"
env_key = "OPENAI_API_KEY"

[model_providers.custom]
base_url = "https://other.example.com/v1"
model = "gpt-5.4"
`;

    expect(extractCodexQuickConfig(authJson, configToml).url).toBe("https://old.example.com/v1");

    const merged = mergeCodexQuickConfig(authJson, configToml, {
      url: "https://new.example.com/v1",
      auth: "",
      model: "",
    });
    expect(merged.configToml).toContain('base_url = "https://new.example.com/v1"');
    expect(merged.configToml).toContain('base_url = "https://other.example.com/v1"');
  });

  test("detects quick config dirty state", () => {
    const source = { url: "https://a.example", auth: "token", model: "m1" };
    expect(isSameModelProfileQuickConfig(source, { ...source })).toBe(true);
    expect(isModelProfileQuickConfigDirty({ ...source, model: "m2" }, source)).toBe(true);
  });

  test("tryMergeClaudeQuickConfig reports invalid json", () => {
    const result = tryMergeClaudeQuickConfig("{", { url: "https://x", auth: "", model: "" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("JSON");
    }
  });

  test("extracts opencode provider/model options", () => {
    const raw = JSON.stringify(
      {
        provider: {
          minimax: {
            name: "MiniMax",
            npm: "@ai-sdk/openai-compatible",
            options: { baseURL: "https://api.minimax.example/v1", apiKey: "token-minimax" },
            models: { "MiniMax-M2.7": { name: "MiniMax-M2.7" } },
          },
        },
        model: "minimax/MiniMax-M2.7",
        mcp: { codegraph: { enabled: false } },
      },
      null,
      2,
    );
    expect(extractOpencodeQuickConfig(raw)).toEqual({
      url: "https://api.minimax.example/v1",
      auth: "token-minimax",
      model: "minimax/MiniMax-M2.7",
    });
  });

  test("extracts opencode snake_case field variants", () => {
    const raw = JSON.stringify(
      {
        provider: {
          custom: {
            options: { api_base_url: "https://custom.example", api_key: "k-custom" },
          },
        },
        model: "custom/glm-5.1",
      },
      null,
      2,
    );
    expect(extractOpencodeQuickConfig(raw)).toEqual({
      url: "https://custom.example",
      auth: "k-custom",
      model: "custom/glm-5.1",
    });
  });

  test("extracts opencode with model slash but provider absent", () => {
    const raw = JSON.stringify({ model: "foo/bar" }, null, 2);
    expect(extractOpencodeQuickConfig(raw)).toEqual({ url: "", auth: "", model: "foo/bar" });
  });

  test("extracts opencode bare model leaves url/auth empty", () => {
    const raw = JSON.stringify({ model: "claude-sonnet-4-5" }, null, 2);
    expect(extractOpencodeQuickConfig(raw)).toEqual({
      url: "",
      auth: "",
      model: "claude-sonnet-4-5",
    });
  });

  test("extracts opencode invalid json returns empty", () => {
    expect(extractOpencodeQuickConfig("{")).toEqual({
      url: "",
      auth: "",
      model: "",
    });
  });

  test("merges opencode creating provider block from empty", () => {
    const merged = mergeOpencodeQuickConfig("{}", {
      url: "https://ark.example/v1",
      auth: "token-ark",
      model: "minimax/MiniMax-M2.7",
    });
    const parsed = JSON.parse(merged) as {
      model: string;
      provider: Record<
        string,
        { name: string; npm: string; options: Record<string, string>; models: Record<string, unknown> }
      >;
    };
    expect(parsed.model).toBe("minimax/MiniMax-M2.7");
    const entry = parsed.provider.minimax;
    expect(entry.name).toBe("minimax");
    expect(entry.npm).toBe("@ai-sdk/openai-compatible");
    expect(entry.options.baseURL).toBe("https://ark.example/v1");
    expect(entry.options.apiKey).toBe("token-ark");
    expect(entry.models["MiniMax-M2.7"]).toBeDefined();
  });

  test("merges opencode preserves mcp plugin schema and other providers", () => {
    const raw = JSON.stringify(
      {
        $schema: "https://opencode.ai/schema.json",
        mcp: { codegraph: { enabled: true } },
        plugin: ["oh-my-openagent@latest"],
        provider: { old: { name: "Old", options: { baseURL: "https://old" } } },
        small_model: "old/old-small",
      },
      null,
      2,
    );
    const merged = mergeOpencodeQuickConfig(raw, {
      url: "https://new.example",
      auth: "k-new",
      model: "new/glm-5.1",
    });
    const parsed = JSON.parse(merged) as Record<string, unknown> & {
      provider: Record<string, unknown>;
    };
    expect(parsed.$schema).toBe("https://opencode.ai/schema.json");
    expect((parsed.mcp as { codegraph: { enabled: boolean } }).codegraph.enabled).toBe(true);
    expect((parsed.plugin as string[])[0]).toBe("oh-my-openagent@latest");
    expect(parsed.small_model).toBe("old/old-small");
    // 旧 provider 保留，新 provider 新增。
    expect(parsed.provider.old).toBeDefined();
    expect(parsed.provider.new).toBeDefined();
    expect(parsed.model).toBe("new/glm-5.1");
  });

  test("merges opencode only model without provider block", () => {
    // 仅填 provider/model 格式 model、不填 url/auth：不创建 provider 块（避免 shadow 内置 provider）。
    const merged = mergeOpencodeQuickConfig("{}", { url: "", auth: "", model: "anthropic/claude-sonnet-4-5" });
    const parsed = JSON.parse(merged) as { model: string; provider?: Record<string, unknown> };
    expect(parsed.model).toBe("anthropic/claude-sonnet-4-5");
    expect(parsed.provider).toBeUndefined();
  });

  test("merges opencode bare model with url/auth rewrites to wise", () => {
    const merged = mergeOpencodeQuickConfig("{}", {
      url: "https://ark.example",
      auth: "k-ark",
      model: "glm-5.1",
    });
    const parsed = JSON.parse(merged) as {
      model: string;
      provider: Record<string, { options: Record<string, string>; models: Record<string, unknown> }>;
    };
    expect(parsed.model).toBe("wise/glm-5.1");
    expect(parsed.provider.wise.options.baseURL).toBe("https://ark.example");
    expect(parsed.provider.wise.options.apiKey).toBe("k-ark");
    expect(parsed.provider.wise.models["glm-5.1"]).toBeDefined();
  });

  test("merges opencode normalizes variant fields on existing entry", () => {
    const raw = JSON.stringify(
      {
        provider: {
          custom: { options: { api_base_url: "https://old", api_key: "k-old" } },
        },
        model: "custom/glm-5.1",
      },
      null,
      2,
    );
    const merged = mergeOpencodeQuickConfig(raw, {
      url: "https://new",
      auth: "k-new",
      model: "custom/glm-5.1",
    });
    const parsed = JSON.parse(merged) as {
      provider: { custom: { options: Record<string, string> } };
    };
    expect(parsed.provider.custom.options.baseURL).toBe("https://new");
    expect(parsed.provider.custom.options.apiKey).toBe("k-new");
  });

  test("merges opencode empty patch keeps model untouched", () => {
    const raw = JSON.stringify({ model: "anthropic/claude-sonnet-4-5", mcp: {} }, null, 2);
    const merged = mergeOpencodeQuickConfig(raw, { url: "", auth: "", model: "" });
    const parsed = JSON.parse(merged) as { model: string; mcp: Record<string, unknown> };
    expect(parsed.model).toBe("anthropic/claude-sonnet-4-5");
    expect(parsed.mcp).toEqual({});
  });

  test("tryMergeOpencodeQuickConfig reports invalid json", () => {
    const result = tryMergeOpencodeQuickConfig("{", { url: "https://x", auth: "", model: "" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("JSON");
    }
  });
});
