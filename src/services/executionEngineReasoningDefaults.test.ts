import { beforeEach, describe, expect, mock, test } from "bun:test";

const getAppSetting = mock(async () => null as string | null);
const setAppSetting = mock(async () => undefined);

mock.module("./appSettingsStore", () => ({ getAppSetting, setAppSetting }));

import {
  getCachedExecutionEngineDefaultReasoning,
  loadExecutionEngineReasoningDefaults,
  resetExecutionEngineReasoningDefaultsForTests,
  saveExecutionEngineDefaultReasoning,
  WISE_EXECUTION_ENGINE_REASONING_DEFAULTS_KEY,
} from "./executionEngineReasoningDefaults";

describe("executionEngineReasoningDefaults", () => {
  beforeEach(() => {
    resetExecutionEngineReasoningDefaultsForTests();
    getAppSetting.mockReset();
    setAppSetting.mockReset();
    setAppSetting.mockImplementation(async () => undefined);
  });

  test("loads the per-engine default and persists a Composer selection", async () => {
    getAppSetting.mockImplementation(async () =>
      JSON.stringify({ "codex-rpc": "high", unknown: "must-not-leak" }),
    );

    await loadExecutionEngineReasoningDefaults();
    expect(getCachedExecutionEngineDefaultReasoning("codex-rpc")).toBe("high");
    expect(getCachedExecutionEngineDefaultReasoning("codex")).toBe("high");
    expect(getCachedExecutionEngineDefaultReasoning("claude")).toBeNull();

    await saveExecutionEngineDefaultReasoning("claude", "xhigh");
    expect(getCachedExecutionEngineDefaultReasoning("claude")).toBe("xhigh");
    expect(setAppSetting).toHaveBeenCalledWith(
      WISE_EXECUTION_ENGINE_REASONING_DEFAULTS_KEY,
      JSON.stringify({ "codex-rpc": "high", claude: "xhigh" }),
    );
  });

  test("rejects unknown effort values", async () => {
    await saveExecutionEngineDefaultReasoning("codex-rpc", "not-a-level");
    expect(getCachedExecutionEngineDefaultReasoning("codex-rpc")).toBeNull();
    expect(setAppSetting).toHaveBeenCalledWith(
      WISE_EXECUTION_ENGINE_REASONING_DEFAULTS_KEY,
      JSON.stringify({}),
    );
  });

  test("in-flight load does not clobber a newer Composer save", async () => {
    let resolveRead: (value: string | null) => void = () => undefined;
    getAppSetting.mockImplementation(
      () =>
        new Promise<string | null>((resolve) => {
          resolveRead = resolve;
        }),
    );

    const pendingLoad = loadExecutionEngineReasoningDefaults();
    await saveExecutionEngineDefaultReasoning("codex-rpc", "ultra");
    resolveRead(JSON.stringify({ "codex-rpc": "medium" }));
    await pendingLoad;

    expect(getCachedExecutionEngineDefaultReasoning("codex-rpc")).toBe("ultra");
  });
});
