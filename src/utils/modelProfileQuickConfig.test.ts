import { describe, expect, test } from "bun:test";
import {
  extractClaudeQuickConfig,
  extractCodexQuickConfig,
  isModelProfileQuickConfigDirty,
  isSameModelProfileQuickConfig,
  mergeClaudeQuickConfig,
  mergeCodexQuickConfig,
  tryMergeClaudeQuickConfig,
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
});
