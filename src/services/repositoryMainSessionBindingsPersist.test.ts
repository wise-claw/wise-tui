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
  getRepositoryMainSessionBindingsPersistStatsForTests,
  persistRepositoryMainSessionBindings,
  resetRepositoryMainSessionBindingsPersistForTests,
} = await import("./repositoryMainSessionBindingsPersist");

describe("repositoryMainSessionBindingsPersist", () => {
  beforeEach(() => {
    resetRepositoryMainSessionBindingsPersistForTests();
    setAppSetting.mockReset();
  });

  afterEach(() => {
    resetRepositoryMainSessionBindingsPersistForTests();
  });

  test("coalesces concurrent writes to the latest bindings snapshot", async () => {
    const writes: string[] = [];
    setAppSetting.mockImplementation(async (_key: string, value: string) => {
      writes.push(value);
      await new Promise((resolve) => setTimeout(resolve, 5));
    });

    const p1 = persistRepositoryMainSessionBindings({ "/a": "s1" });
    await new Promise((resolve) => setTimeout(resolve, 0));
    const p2 = persistRepositoryMainSessionBindings({ "/a": "s2", "/b": "s3" });
    expect(getRepositoryMainSessionBindingsPersistStatsForTests().generation).toBe(2);

    await Promise.all([p1, p2]);
    expect(writes.length).toBeGreaterThanOrEqual(1);
    expect(JSON.parse(writes.at(-1)!)).toEqual({ "/a": "s2", "/b": "s3" });
  });
});
