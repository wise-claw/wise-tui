import { beforeEach, describe, expect, mock, test } from "bun:test";

const getAppSetting = mock(async () => null as string | null);
const setAppSetting = mock(async () => undefined);

mock.module("../services/appSettingsStore", () => ({ getAppSetting, setAppSetting }));

import { CURSOR_SDK_DEFAULT_MODEL } from "../constants/cursorSdk";
import {
  resetExecutionEngineModelDefaultsForTests,
  saveExecutionEngineDefaultModel,
} from "../services/executionEngineModelDefaults";
import { resolveNewSessionComposerModel } from "./newSessionComposerDefaults";

describe("resolveNewSessionComposerModel", () => {
  beforeEach(() => {
    resetExecutionEngineModelDefaultsForTests();
    getAppSetting.mockReset();
    setAppSetting.mockReset();
    setAppSetting.mockImplementation(async () => undefined);
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
