import { beforeEach, describe, expect, mock, test } from "bun:test";

const getAppSetting = mock(async () => null as string | null);
const setAppSetting = mock(async () => undefined);

mock.module("./appSettingsStore", () => ({ getAppSetting, setAppSetting }));

import {
  getCachedExecutionEngineDefaultModel,
  loadExecutionEngineModelDefaults,
  saveExecutionEngineDefaultModel,
  WISE_EXECUTION_ENGINE_MODEL_DEFAULTS_KEY,
} from "./executionEngineModelDefaults";

describe("executionEngineModelDefaults", () => {
  beforeEach(() => {
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
});
