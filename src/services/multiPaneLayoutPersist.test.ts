import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";

const setAppSetting = mock(async () => {});

mock.module("./appSettingsStore", () => ({
  WISE_CLAUDE_DEFAULT_SETTINGS_KEY: "wise.claudeDefaultSettings.v1",
  WISE_CODEX_DEFAULT_SETTINGS_KEY: "wise.codexDefaultSettings.v1",
  WISE_OPENCODE_DEFAULT_SETTINGS_KEY: "wise.opencodeDefaultSettings.v1",
  getAppSetting: mock(async () => null),
  setAppSetting,
  deleteAppSetting: mock(async () => {}),
  getAppSettingsBatch: mock(async () => ({})),
  getAppSettingJson: mock(async () => null),
  setAppSettingJson: mock(async () => {}),
}));

const {
  getMultiPaneLayoutPersistStatsForTests,
  persistMultiPaneLayoutState,
  resetMultiPaneLayoutPersistForTests,
} = await import("./multiPaneLayoutPersist");

describe("multiPaneLayoutPersist", () => {
  beforeEach(() => {
    resetMultiPaneLayoutPersistForTests();
    setAppSetting.mockReset();
  });

  afterEach(() => {
    resetMultiPaneLayoutPersistForTests();
  });

  test("coalesces concurrent writes for the same storage key", async () => {
    const writes: string[] = [];
    setAppSetting.mockImplementation(async (_key: string, value: string) => {
      writes.push(value);
      await new Promise((resolve) => setTimeout(resolve, 5));
    });

    const key = "wise.mainLayout.multiPaneState.v1:main";
    const p1 = persistMultiPaneLayoutState(key, JSON.stringify({ version: 1, paneCount: 1 }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    const p2 = persistMultiPaneLayoutState(key, JSON.stringify({ version: 1, paneCount: 3 }));
    expect(getMultiPaneLayoutPersistStatsForTests(key).generation).toBe(2);

    await Promise.all([p1, p2]);
    expect(writes.length).toBeGreaterThanOrEqual(1);
    expect(JSON.parse(writes.at(-1)!).paneCount).toBe(3);
  });
});
