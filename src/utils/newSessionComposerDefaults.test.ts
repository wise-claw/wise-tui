import { beforeEach, describe, expect, mock, test } from "bun:test";

const getAppSetting = mock(async () => null as string | null);
const setAppSetting = mock(async () => undefined);
const getCachedDefaultExecutionEngine = mock(() => "claude" as const);

mock.module("../services/appSettingsStore", () => ({ getAppSetting, setAppSetting }));
mock.module("../services/wiseDefaultConfigStore", () => ({
  getCachedDefaultExecutionEngine,
  saveDefaultExecutionEngineToStore: mock(async () => undefined),
}));

import { CURSOR_SDK_DEFAULT_MODEL } from "../constants/cursorSdk";
import {
  resetExecutionEngineModelDefaultsForTests,
  saveExecutionEngineDefaultModel,
} from "../services/executionEngineModelDefaults";
import {
  resetExecutionEngineReasoningDefaultsForTests,
  saveExecutionEngineDefaultReasoning,
} from "../services/executionEngineReasoningDefaults";
import {
  resolveNewSessionComposerDefaults,
  resolveNewSessionComposerModel,
} from "./newSessionComposerDefaults";

describe("resolveNewSessionComposerModel", () => {
  beforeEach(() => {
    resetExecutionEngineModelDefaultsForTests();
    resetExecutionEngineReasoningDefaultsForTests();
    getAppSetting.mockReset();
    setAppSetting.mockReset();
    setAppSetting.mockImplementation(async () => undefined);
    getCachedDefaultExecutionEngine.mockReset();
    getCachedDefaultExecutionEngine.mockImplementation(() => "claude");
  });

  test("uses the saved Cursor model instead of Auto", async () => {
    await saveExecutionEngineDefaultModel("cursor", "grok-4.6");
    expect(resolveNewSessionComposerModel("cursor", "auto")).toBe("grok-4.6");
  });

  test("inherits the current session model when nothing is saved", () => {
    expect(resolveNewSessionComposerModel("cursor", "grok-4.6-fast")).toBe("grok-4.6-fast");
  });

  test("falls back to Cursor Auto when neither saved nor inherited", () => {
    expect(resolveNewSessionComposerModel("cursor")).toBe(CURSOR_SDK_DEFAULT_MODEL);
  });
});

describe("resolveNewSessionComposerDefaults", () => {
  beforeEach(() => {
    resetExecutionEngineModelDefaultsForTests();
    resetExecutionEngineReasoningDefaultsForTests();
    getAppSetting.mockReset();
    setAppSetting.mockReset();
    setAppSetting.mockImplementation(async () => undefined);
    getCachedDefaultExecutionEngine.mockReset();
    getCachedDefaultExecutionEngine.mockImplementation(() => "claude");
  });

  test("reuses the current session engine, model, and reasoning", async () => {
    await saveExecutionEngineDefaultModel("codex-rpc", "gpt-5.6-luna");
    await saveExecutionEngineDefaultReasoning("codex-rpc", "high");
    expect(
      resolveNewSessionComposerDefaults({
        repoEngine: "claude",
        prior: {
          executionEngine: "codex-rpc",
          model: "gpt-5.6-luna",
          codexReasoningEffort: "high",
        },
      }),
    ).toEqual({
      executionEngine: "codex-rpc",
      model: "gpt-5.6-luna",
      codexReasoningEffort: "high",
    });
  });

  test("falls back to repo engine when the current session has no override", () => {
    expect(
      resolveNewSessionComposerDefaults({
        repoEngine: "cursor",
        prior: { model: "grok-4.6-fast" },
      }),
    ).toEqual({
      executionEngine: "cursor",
      model: "grok-4.6-fast",
    });
  });

  test("does not inherit engine when inheritEngine is false", () => {
    expect(
      resolveNewSessionComposerDefaults({
        repoEngine: "claude",
        inheritEngine: false,
        prior: {
          executionEngine: "codex-rpc",
          model: "gpt-5.6-luna",
          codexReasoningEffort: "high",
        },
      }),
    ).toEqual({
      executionEngine: "claude",
      model: "sonnet",
      claudeReasoningEffort: "high",
    });
  });

  test("uses saved Claude reasoning when creating a Claude session", async () => {
    await saveExecutionEngineDefaultReasoning("claude", "xhigh");
    expect(
      resolveNewSessionComposerDefaults({
        repoEngine: "claude",
        prior: { executionEngine: "claude" },
      }),
    ).toEqual({
      executionEngine: "claude",
      model: "sonnet",
      claudeReasoningEffort: "xhigh",
    });
  });
});
