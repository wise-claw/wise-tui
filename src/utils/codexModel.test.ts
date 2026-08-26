import { describe, expect, test } from "bun:test";
import type { ClaudeModelProfileStoreView } from "../types/claudeModelProfile";
import {
  buildCodexModelPickerOptions,
  formatCodexModelLabel,
  isCodexModelId,
  matchesCodexModelPickerFilter,
  resolveCodexContextExecutionEngine,
  resolveCodexComposerModel,
  resolveCodexExecModelId,
  resolveCodexOpenAiDefaultProfileId,
  resolveCodexProfileModelFromStore,
  looksLikeOpenAiCatalogModel,
} from "./codexModel";

const store = (partial: Partial<ClaudeModelProfileStoreView>): ClaudeModelProfileStoreView =>
  ({
    profiles: [],
    activeProfileId: null,
    activeCodexProfileId: "codex-1",
    activeOpencodeProfileId: null,
    effectiveModel: "Qwen3.7",
    effectiveCodexModel: "Qwen3.5-codex",
    effectiveOpencodeModel: null,
    ...partial,
  }) as ClaudeModelProfileStoreView;

describe("resolveCodexProfileModelFromStore", () => {
  test("prefers effectiveCodexModel", () => {
    expect(resolveCodexProfileModelFromStore(store({}))).toBe("Qwen3.5-codex");
  });

  test("falls back to active codex profile modelId", () => {
    expect(
      resolveCodexProfileModelFromStore(
        store({
          effectiveCodexModel: null,
          profiles: [
            {
              id: "codex-1",
              company: "Bailian",
              name: "Qwen3.7",
              modelId: "Qwen3.7",
              settingsJson: "{}",
              engine: "codex",
              createdAtMs: 0,
              updatedAtMs: 0,
            },
          ],
        }),
      ),
    ).toBe("Qwen3.7");
  });
});

describe("resolveCodexExecModelId", () => {
  test("uses codex profile when context is claude", () => {
    expect(
      resolveCodexExecModelId({
        sessionModel: "Qwen3.7",
        contextExecutionEngine: "claude",
        store: store({ effectiveCodexModel: "Qwen3.5-codex" }),
      }),
    ).toBe("Qwen3.5-codex");
  });

  test("does not use session model under claude context without codex profile", () => {
    expect(
      resolveCodexExecModelId({
        sessionModel: "glm-5.1",
        contextExecutionEngine: "claude",
        store: store({ effectiveCodexModel: null, profiles: [] }),
      }),
    ).toBeUndefined();
  });

  test("falls back to session model only when context is codex", () => {
    expect(
      resolveCodexExecModelId({
        sessionModel: "custom-codex-model",
        contextExecutionEngine: "codex",
        store: store({ effectiveCodexModel: null, profiles: [] }),
      }),
    ).toBe("custom-codex-model");
  });
});

describe("resolveCodexContextExecutionEngine", () => {
  const sessions = [
    { id: "main", repositoryPath: "/r", repositoryName: "demo" },
    { id: "worker", repositoryPath: "/r", repositoryName: "demo/员工:codex" },
  ];

  test("terminal dispatch uses main session engine", () => {
    expect(
      resolveCodexContextExecutionEngine({
        tabSessionId: "worker",
        terminalFreshTurn: true,
        activeSessionId: "main",
        sessions,
        resolveEngine: (session) => (session.id === "main" ? "claude" : "codex"),
      }),
    ).toBe("claude");
  });

  test("direct worker execute uses worker engine", () => {
    expect(
      resolveCodexContextExecutionEngine({
        tabSessionId: "worker",
        sessions,
        resolveEngine: (session) => (session.id === "main" ? "claude" : "codex"),
      }),
    ).toBe("codex");
  });
});

describe("buildCodexModelPickerOptions", () => {
  const profile = (partial: Partial<import("../types/claudeModelProfile").ClaudeModelProfile>) =>
    ({
      id: "p1",
      company: "Volc Ark",
      name: "火山 Coding",
      modelId: "deepseek-v4-flash",
      settingsJson: "{}",
      engine: "codex",
      createdAtMs: 0,
      updatedAtMs: 0,
      ...partial,
    }) as import("../types/claudeModelProfile").ClaudeModelProfile;

  test("merges runtime models with configured codex profiles", () => {
    const opts = buildCodexModelPickerOptions(
      [
        { id: "gpt-5.4", displayName: "GPT-5.4" },
        { id: "deepseek-v4-flash", displayName: "deepseek-v4-flash", provider: "volc-ark-coding" },
      ],
      [profile({})],
    );
    expect(opts).toEqual([
      {
        value: "deepseek-v4-flash",
        label: "火山 Coding",
        providerId: "Volc Ark",
        profileId: "p1",
      },
      {
        value: "gpt-5.4",
        label: "GPT-5.4",
      },
    ]);
  });

  test("skips claude profiles and dedupes runtime ids", () => {
    const opts = buildCodexModelPickerOptions(
      [
        { id: "a", displayName: "A" },
        { id: "a", displayName: "A-dup" },
      ],
      [
        profile({ id: "c1", engine: "claude", modelId: "a" }),
        profile({ id: "c2", engine: "codex", modelId: "b", name: "B 档案" }),
      ],
    );
    expect(opts.map((o) => o.value)).toEqual(["b", "a"]);
    expect(opts.find((o) => o.value === "b")?.label).toBe("B 档案");
  });
});

describe("codex picker helpers", () => {
  test("isCodexModelId accepts known and free-form ids", () => {
    expect(isCodexModelId("gpt-5.4", [{ id: "gpt-5.4" }])).toBe(true);
    expect(isCodexModelId("unknown", [{ id: "gpt-5.4" }])).toBe(false);
    expect(isCodexModelId("custom-model")).toBe(true);
    expect(isCodexModelId("  ")).toBe(false);
  });

  test("isCodexModelId matches catalog display names", () => {
    expect(
      isCodexModelId("GPT-5.6-Luna", [
        { id: "gpt-5.6", displayName: "GPT-5.6-Luna" },
      ]),
    ).toBe(true);
  });

  test("formatCodexModelLabel prefers display name", () => {
    expect(formatCodexModelLabel("gpt-5.4", "GPT-5.4")).toBe("GPT-5.4");
    expect(formatCodexModelLabel("gpt-5.4", "gpt-5.4")).toBe("gpt-5.4");
    expect(formatCodexModelLabel("deepseek-v4-flash")).toBe("deepseek-v4-flash");
  });

  test("matchesCodexModelPickerFilter covers id/label/provider", () => {
    const option = { value: "deepseek-v4-flash", label: "火山 Coding", providerId: "volc-ark" };
    expect(matchesCodexModelPickerFilter("deep", option)).toBe(true);
    expect(matchesCodexModelPickerFilter("火山", option)).toBe(true);
    expect(matchesCodexModelPickerFilter("volc", option)).toBe(true);
    expect(matchesCodexModelPickerFilter("glm", option)).toBe(false);
  });
});

describe("resolveCodexComposerModel", () => {
  const known = [
    { id: "gpt-5.6", displayName: "GPT-5.6-Luna" },
    { id: "deepseek-v4-flash", displayName: "deepseek-v4-flash" },
  ];

  test("keeps explicit picker selection while session still has the local profile", () => {
    expect(
      resolveCodexComposerModel({
        pickedModel: "gpt-5.6",
        sessionModel: "deepseek-v4-flash",
        profileModel: "deepseek-v4-flash",
        knownModels: known,
      }),
    ).toBe("gpt-5.6");
  });

  test("does not let a catalog list refresh overwrite a known session override", () => {
    expect(
      resolveCodexComposerModel({
        sessionModel: "gpt-5.6",
        profileModel: "deepseek-v4-flash",
        knownModels: known,
      }),
    ).toBe("gpt-5.6");
  });

  test("falls back to the local profile when session is not a known Codex model", () => {
    expect(
      resolveCodexComposerModel({
        sessionModel: "MiniMax-M3",
        profileModel: "deepseek-v4-flash",
        knownModels: known,
      }),
    ).toBe("deepseek-v4-flash");
  });
});

describe("resolveCodexExecModelId session override", () => {
  test("explicit session model wins over profile in codex context", () => {
    expect(
      resolveCodexExecModelId({
        sessionModel: "gpt-5.4",
        contextExecutionEngine: "codex",
        store: store({ effectiveCodexModel: "Qwen3.5-codex" }),
      }),
    ).toBe("gpt-5.4");
  });

  test("profile model still wins when session matches profile", () => {
    expect(
      resolveCodexExecModelId({
        sessionModel: "Qwen3.5-codex",
        contextExecutionEngine: "codex-rpc",
        store: store({ effectiveCodexModel: "Qwen3.5-codex" }),
      }),
    ).toBe("Qwen3.5-codex");
  });

  test("claude context keeps profile priority over session", () => {
    expect(
      resolveCodexExecModelId({
        sessionModel: "gpt-5.4",
        contextExecutionEngine: "claude",
        store: store({ effectiveCodexModel: "Qwen3.5-codex" }),
      }),
    ).toBe("Qwen3.5-codex");
  });
});

describe("openai catalog vs custom codex profiles", () => {
  const profile = (
    partial: Partial<import("../types/claudeModelProfile").ClaudeModelProfile>,
  ) =>
    ({
      id: "p1",
      company: "DeepSeek",
      name: "deepseek v4-flash",
      modelId: "deepseek-v4-flash",
      settingsJson: JSON.stringify({
        auth: { OPENAI_API_KEY: "k", auth_mode: "apikey" },
        config:
          'model = "deepseek-v4-flash"\nmodel_provider = "deepseek"\n\n[model_providers.deepseek]\nbase_url = "https://api.deepseek.com/v1"\n',
      }),
      engine: "codex",
      createdAtMs: 0,
      updatedAtMs: 0,
      ...partial,
    }) as import("../types/claudeModelProfile").ClaudeModelProfile;

  test("looksLikeOpenAiCatalogModel", () => {
    expect(looksLikeOpenAiCatalogModel("gpt-5.6")).toBe(true);
    expect(looksLikeOpenAiCatalogModel("GPT-5.6-Luna")).toBe(true);
    expect(looksLikeOpenAiCatalogModel("deepseek-v4-flash")).toBe(false);
  });

  test("resolves openai default profile over deepseek", () => {
    expect(
      resolveCodexOpenAiDefaultProfileId([
        profile({}),
        profile({
          id: "oa",
          company: "OpenAI",
          name: "openAI default",
          modelId: "gpt-5.4",
          settingsJson: JSON.stringify({
            auth: { OPENAI_API_KEY: "sk" },
            config: 'model = "gpt-5.4"\n',
          }),
        }),
      ]),
    ).toBe("oa");
  });
});
