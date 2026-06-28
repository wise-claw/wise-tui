import { describe, expect, test } from "vitest";
import {
  CODEX_PROVIDER_PRESETS,
  findCodexProviderPreset,
  renderCodexTomlProviderSection,
} from "../utils/codexProviderPresets";

describe("CODEX_PROVIDER_PRESETS", () => {
  test("每个预设都有必需的字段", () => {
    for (const p of CODEX_PROVIDER_PRESETS) {
      expect(p.id).toBeTruthy();
      expect(p.label).toBeTruthy();
      expect(p.defaultBaseUrl).toBeTruthy();
      expect(p.defaultBaseUrl.startsWith("https://")).toBe(true);
    }
  });

  test("custom 预设的 defaultModel 为空字符串", () => {
    const custom = findCodexProviderPreset("custom")!;
    expect(custom.defaultModel).toBe("");
  });

  test("deepseek 预设的正确性", () => {
    const ds = findCodexProviderPreset("deepseek")!;
    expect(ds.label).toBe("DeepSeek");
    expect(ds.defaultBaseUrl).toBe("https://api.deepseek.com/v1");
    expect(ds.defaultModel).toBe("deepseek-chat");
    expect(ds.knownModels).toHaveProperty("deepseek-chat");
    expect(ds.knownModels).toHaveProperty("deepseek-reasoner");
    expect(ds.tomlProviderId).toBe("deepseek");
  });

  test("百炼预设的 knownModels 包含 qwen 系列", () => {
    const bailian = findCodexProviderPreset("bailian")!;
    expect(bailian.knownModels).toHaveProperty("qwen-max");
    expect(bailian.knownModels).toHaveProperty("qwen-plus");
  });

  test("火山引擎预设的 defaultModel 为占位符", () => {
    const volc = findCodexProviderPreset("volc")!;
    expect(volc.defaultModel).toBe("ep-xxxxxxxx");
  });

  test("所有 id 唯一", () => {
    const ids = CODEX_PROVIDER_PRESETS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("findCodexProviderPreset", () => {
  test("按 id 查找成功", () => {
    expect(findCodexProviderPreset("deepseek")!.id).toBe("deepseek");
    expect(findCodexProviderPreset("minimax")!.id).toBe("minimax");
  });

  test("不存在的 id 返回 undefined", () => {
    expect(findCodexProviderPreset("nonexistent")).toBeUndefined();
  });
});

describe("renderCodexTomlProviderSection", () => {
  test("生成 deepseek provider 段", () => {
    const ds = findCodexProviderPreset("deepseek")!;
    const section = renderCodexTomlProviderSection(ds, ds.defaultBaseUrl);
    expect(section).toContain("[model_providers.deepseek]");
    expect(section).toContain('name = "DeepSeek"');
    expect(section).toContain('base_url = "https://api.deepseek.com/v1"');
    expect(section).toContain('env_key = "OPENAI_API_KEY"');
  });

  test("空 baseUrl 生成正确 TOML", () => {
    const ds = findCodexProviderPreset("deepseek")!;
    const section = renderCodexTomlProviderSection(ds, "");
    expect(section).toContain('base_url = ""');
  });

  test("自定义 authKey 反映在 env_key", () => {
    // 模拟一个预设，使用非默认 authKey
    const customPreset = findCodexProviderPreset("deepseek")!;
    const customAuthKey = "CUSTOM_API_KEY";
    const customPresetWithAuthKey = { ...customPreset, authKey: customAuthKey };
    const section = renderCodexTomlProviderSection(customPresetWithAuthKey, "https://custom.example/v1");
    expect(section).toContain(`env_key = "CUSTOM_API_KEY"`);
  });
});
