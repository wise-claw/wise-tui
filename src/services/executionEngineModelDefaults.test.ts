import { beforeEach, describe, expect, mock, test } from "bun:test";

const getAppSetting = mock(async () => null as string | null);
const setAppSetting = mock(async () => undefined);

mock.module("./appSettingsStore", () => ({ getAppSetting, setAppSetting }));

import {
  getCachedExecutionEngineDefaultModel,
  loadExecutionEngineModelDefaults,
  resetExecutionEngineModelDefaultsForTests,
  saveExecutionEngineDefaultModel,
  WISE_EXECUTION_ENGINE_MODEL_DEFAULTS_KEY,
} from "./executionEngineModelDefaults";

describe("executionEngineModelDefaults", () => {
  beforeEach(() => {
    resetExecutionEngineModelDefaultsForTests();
    getAppSetting.mockReset();
    setAppSetting.mockReset();
    setAppSetting.mockImplementation(async () => undefined);
  });

  test("loads the per-engine default and persists a Composer selection", async () => {
    getAppSetting.mockImplementation(async () =>
      JSON.stringify({ opencode: "deepseek-v4-flash-free", unknown: "must-not-leak" }),
    );

    await loadExecutionEngineModelDefaults();
    expect(getCachedExecutionEngineDefaultModel("opencode")).toBe("deepseek-v4-flash-free");
    expect(getCachedExecutionEngineDefaultModel("claude")).toBeNull();

    await saveExecutionEngineDefaultModel("opencode", "deepseek-v4-flash");
    expect(getCachedExecutionEngineDefaultModel("opencode")).toBe("deepseek-v4-flash");
    expect(setAppSetting).toHaveBeenCalledWith(
      WISE_EXECUTION_ENGINE_MODEL_DEFAULTS_KEY,
      JSON.stringify({ opencode: "deepseek-v4-flash" }),
    );
  });

  test("Codex RPC can reuse a Codex CLI saved model", async () => {
    await saveExecutionEngineDefaultModel("codex", "gpt-5.6-luna");
    expect(getCachedExecutionEngineDefaultModel("codex-rpc")).toBe("gpt-5.6-luna");
  });

  test("in-flight load does not clobber a newer Composer save", async () => {
    let resolveRead: (value: string | null) => void = () => undefined;
    getAppSetting.mockImplementation(
      () =>
        new Promise<string | null>((resolve) => {
          resolveRead = resolve;
        }),
    );

    const pendingLoad = loadExecutionEngineModelDefaults();
    await saveExecutionEngineDefaultModel("cursor", "grok-4.6");
    resolveRead(null);
    await pendingLoad;

    expect(getCachedExecutionEngineDefaultModel("cursor")).toBe("grok-4.6");
  });
});
