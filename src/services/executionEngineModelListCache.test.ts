import { beforeEach, describe, expect, mock, test } from "bun:test";

const getAppSetting = mock(async () => null as string | null);
const setAppSetting = mock(async () => undefined);

mock.module("./appSettingsStore", () => ({ getAppSetting, setAppSetting }));

import {
  executionEngineModelListKind,
  getCachedClaudeModelPickerOptions,
  getCachedCursorModels,
  getCachedCodexModels,
  saveCachedCodexModels,
  loadExecutionEngineModelLists,
  resetExecutionEngineModelListsForTests,
  saveCachedClaudeModelPickerOptions,
  saveCachedCursorModels,
  WISE_EXECUTION_ENGINE_MODEL_LISTS_KEY,
} from "./executionEngineModelListCache";

describe("executionEngineModelListCache", () => {
  beforeEach(() => {
    resetExecutionEngineModelListsForTests();
    getAppSetting.mockReset();
    setAppSetting.mockReset();
    setAppSetting.mockImplementation(async () => undefined);
  });

  test("maps engines that share a CLI list onto the same cache kind", () => {
    expect(executionEngineModelListKind("cursor")).toBe("cursor");
    expect(executionEngineModelListKind("codex-rpc")).toBe("codex");
    expect(executionEngineModelListKind("gemini")).toBeNull();
  });

  test("loads a persisted engine list and ignores empty replacements", async () => {
    getAppSetting.mockImplementation(async () =>
      JSON.stringify({
        cursor: [
          { id: "grok-4.6-fast", displayName: "Grok 4.6 Fast", aliases: ["fast"] },
          { id: "" },
        ],
      }),
    );

    await loadExecutionEngineModelLists();
    expect(getCachedCursorModels()).toEqual([
      { id: "grok-4.6-fast", displayName: "Grok 4.6 Fast", aliases: ["fast"] },
    ]);

    await saveCachedCursorModels([]);
    expect(getCachedCursorModels()?.[0]?.id).toBe("grok-4.6-fast");
    expect(setAppSetting).not.toHaveBeenCalled();

    await saveCachedCursorModels([
      { id: "composer-2.5", displayName: "Composer 2.5" },
      { id: "grok-4.6-fast", displayName: "Grok 4.6 Fast" },
    ]);
    expect(getCachedCursorModels()?.map((item) => item.id)).toEqual([
      "composer-2.5",
      "grok-4.6-fast",
    ]);
    expect(setAppSetting).toHaveBeenCalledWith(
      WISE_EXECUTION_ENGINE_MODEL_LISTS_KEY,
      expect.stringContaining("composer-2.5"),
    );
  });

  test("in-flight load does not clobber a newer list save", async () => {
    let resolveRead: (value: string | null) => void = () => undefined;
    getAppSetting.mockImplementation(
      () =>
        new Promise<string | null>((resolve) => {
          resolveRead = resolve;
        }),
    );

    const pendingLoad = loadExecutionEngineModelLists();
    const pendingSave = saveCachedCursorModels([{ id: "grok-4.6-fast", displayName: "Grok 4.6 Fast" }]);
    resolveRead(JSON.stringify({ cursor: [{ id: "auto", displayName: "Auto" }] }));
    await pendingLoad;
    await pendingSave;

    expect(getCachedCursorModels()?.[0]?.id).toBe("grok-4.6-fast");
  });

  test("persists Claude picker options without wiping on empty fetch", async () => {
    await saveCachedClaudeModelPickerOptions({
      defaultModel: "sonnet",
      availableModels: ["sonnet", "opus"],
    });
    expect(getCachedClaudeModelPickerOptions()).toEqual({
      defaultModel: "sonnet",
      availableModels: ["sonnet", "opus"],
    });

    await saveCachedClaudeModelPickerOptions({ defaultModel: null, availableModels: [] });
    expect(getCachedClaudeModelPickerOptions()?.availableModels).toEqual(["sonnet", "opus"]);
  });
  test("unchanged lists do not write; changes only replace the matching engine", async () => {
    getAppSetting.mockImplementation(async () => null);
    const cursor = [{ id: "composer-2.5", displayName: "Composer 2.5", aliases: ["fast"] }];
    const codex = [{ id: "gpt-test", displayName: "GPT Test", provider: "openai" }];
    await saveCachedCursorModels(cursor);
    await saveCachedCodexModels(codex);
    setAppSetting.mockClear();
    await saveCachedCursorModels(structuredClone(cursor));
    await saveCachedCodexModels(structuredClone(codex));
    expect(setAppSetting).not.toHaveBeenCalled();

    await saveCachedCodexModels([{ ...codex[0], displayName: "Updated GPT" }]);
    expect(setAppSetting).toHaveBeenCalledTimes(1);
    expect(getCachedCodexModels()?.[0].displayName).toBe("Updated GPT");
    expect(getCachedCursorModels()).toEqual(cursor);
  });

});
