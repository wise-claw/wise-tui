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
import { OPENCODE_DEFAULT_MODEL } from "./opencodeModel";
import { QODER_DEFAULT_MODEL } from "./qoderModel";
import {
  resolveEngineSwitchComposerModel,
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

  test("reuses the saved OpenCode / Qoder model for new sessions", async () => {
    await saveExecutionEngineDefaultModel("opencode", "anthropic/claude-sonnet-4-5");
    await saveExecutionEngineDefaultModel("qoder", "efficient");
    expect(resolveNewSessionComposerModel("opencode")).toBe("anthropic/claude-sonnet-4-5");
    expect(resolveNewSessionComposerModel("qoder")).toBe("efficient");
  });

  test("falls back to each engine's own default instead of sonnet", () => {
    expect(resolveNewSessionComposerModel("opencode")).toBe(OPENCODE_DEFAULT_MODEL);
    expect(resolveNewSessionComposerModel("qoder")).toBe(QODER_DEFAULT_MODEL);
  });
});

describe("resolveEngineSwitchComposerModel", () => {
  beforeEach(() => {
    resetExecutionEngineModelDefaultsForTests();
    getAppSetting.mockReset();
    setAppSetting.mockReset();
    setAppSetting.mockImplementation(async () => undefined);
  });

  test("uses the saved model of the engine being switched to", async () => {
    await saveExecutionEngineDefaultModel("opencode", "anthropic/claude-sonnet-4-5");
    expect(resolveEngineSwitchComposerModel("opencode", "sonnet", "claude")).toBe(
      "anthropic/claude-sonnet-4-5",
    );
  });

  test("uses the saved Codex model instead of the previous engine's Auto", async () => {
    await saveExecutionEngineDefaultModel("codex-rpc", "gpt-5.6-sol");
    expect(resolveEngineSwitchComposerModel("codex-rpc", "auto", "cursor")).toBe("gpt-5.6-sol");
  });

  test("never carries another engine's model across model domains", () => {
    expect(resolveEngineSwitchComposerModel("opencode", "sonnet", "claude")).toBe(
      OPENCODE_DEFAULT_MODEL,
    );
    expect(resolveEngineSwitchComposerModel("qoder", "sonnet", "claude")).toBe(QODER_DEFAULT_MODEL);
    expect(resolveEngineSwitchComposerModel("cursor", "sonnet", "claude")).toBe(
      CURSOR_SDK_DEFAULT_MODEL,
    );
    // Cursor / OpenCode 的 auto 不得带进 Codex：Codex 缺省为空表示交给 config.toml 决定。
    expect(resolveEngineSwitchComposerModel("codex-rpc", "auto", "cursor")).toBe("");
    expect(resolveEngineSwitchComposerModel("claude", "auto", "opencode")).toBe("sonnet");
  });

  test("keeps the current model inside the same model domain (codex ↔ codex-rpc)", () => {
    expect(resolveEngineSwitchComposerModel("codex-rpc", "gpt-5.6-luna", "codex")).toBe(
      "gpt-5.6-luna",
    );
    expect(resolveEngineSwitchComposerModel("codex", "deepseek-v4-flash", "codex-rpc")).toBe(
      "deepseek-v4-flash",
    );
  });

  test("without a previous engine nothing is inherited", () => {
    expect(resolveEngineSwitchComposerModel("claude", "opus")).toBe("sonnet");
    expect(resolveEngineSwitchComposerModel("codex-rpc", "gpt-5.6-luna")).toBe("");
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
