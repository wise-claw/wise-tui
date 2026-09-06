import { describe, expect, test } from "bun:test";
import type { ClaudeModelProfileStoreView } from "../types/claudeModelProfile";
import { resolveCodexComposerModelDisplay } from "./codexComposerModelDisplay";

const store: ClaudeModelProfileStoreView = {
  profiles: [{
    id: "openai", engine: "codex", company: "openAI", name: "default",
    modelId: "gpt-5.6-terra", settingsJson: "{}", createdAtMs: 0, updatedAtMs: 0,
  }],
  activeProfileId: null,
  activeCodexProfileId: "openai",
  activeOpencodeProfileId: null,
  effectiveModel: null,
  effectiveCodexModel: "gpt-5.6-terra",
  effectiveOpencodeModel: null,
};
const catalog = [{ id: "gpt-5.6-terra", displayName: "GPT-5.6-Terra" }];

describe("Codex Composer model display", () => {
  test("shows Terra after applying the OpenAI default provider profile", () => {
    expect(resolveCodexComposerModelDisplay("gpt-5.6-terra", catalog, store)).toEqual({
      company: "", modelName: "GPT-5.6-Terra",
    });
  });

  test("a refreshed Composer without an explicit pick still displays the selected model", () => {
    expect(resolveCodexComposerModelDisplay("gpt-5.6-terra", structuredClone(catalog), structuredClone(store)).modelName)
      .toBe("GPT-5.6-Terra");
  });

  test("a still-loading or stale catalog shows the actual id instead of default", () => {
    for (const models of [null, [], [{ id: "gpt-old", displayName: "Old GPT" }]]) {
      expect(resolveCodexComposerModelDisplay("gpt-5.6-terra", models, store).modelName)
        .toBe("gpt-5.6-terra");
    }
  });

  test("a stale active profile does not override a different selected model", () => {
    expect(resolveCodexComposerModelDisplay("gpt-5.6-luna", [
      { id: "gpt-5.6-luna", displayName: "GPT-5.6-Luna" },
    ], store).modelName).toBe("GPT-5.6-Luna");
  });

  test("uses the configured model when the session delegates to Codex config", () => {
    expect(resolveCodexComposerModelDisplay("", catalog, store).modelName).toBe("GPT-5.6-Terra");
    expect(resolveCodexComposerModelDisplay("", null, null).modelName).toBe("默认");
  });

  test("retains the matching custom provider label when no catalog entry is available", () => {
    const custom = { ...store, profiles: [{
      ...store.profiles[0], id: "deepseek", company: "deepseek", name: "v4-flash", modelId: "deepseek-v4-flash",
    }] };
    expect(resolveCodexComposerModelDisplay("deepseek-v4-flash", null, custom)).toEqual({
      company: "deepseek", modelName: "v4-flash",
    });
  });
});
