import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { createWorkspaceRequirementItem } from "../types/workspaceRequirements";

const settings = new Map<string, string>();
const getAppSetting = mock(async (key: string) => settings.get(key) ?? null);
const setAppSetting = mock(async (key: string, value: string) => {
  settings.set(key, value);
});

mock.module("./appSettingsStore", () => ({
  getAppSetting,
  setAppSetting,
  deleteAppSetting: mock(async () => {}),
  getAppSettingsBatch: mock(async () => ({})),
  getAppSettingJson: mock(async () => null),
  setAppSettingJson: mock(async () => {}),
}));

mock.module("./workspaceInspectorDb", () => ({
  getWorkspaceGlobalMemoDb: async () => ({ bodyMarkdown: "" }),
}));

const {
  WORKSPACE_REQUIREMENTS_SETTING_KEY,
  appendWorkspaceRequirement,
  loadWorkspaceRequirements,
  resetWorkspaceRequirementsWriteQueueForTests,
  saveWorkspaceRequirements,
} = await import("./workspaceRequirementsStore");

describe("workspaceRequirementsStore write queue", () => {
  beforeEach(() => {
    settings.clear();
    getAppSetting.mockClear();
    setAppSetting.mockClear();
    resetWorkspaceRequirementsWriteQueueForTests();
  });

  afterEach(() => {
    resetWorkspaceRequirementsWriteQueueForTests();
  });

  test("append serializes with concurrent save and keeps both items", async () => {
    const a = createWorkspaceRequirementItem("需求 A", 1);
    const b = createWorkspaceRequirementItem("需求 B", 2);
    await saveWorkspaceRequirements([a]);

    let releaseSave: (() => void) | null = null;
    const slowSave = new Promise<void>((resolve) => {
      releaseSave = resolve;
    });

    setAppSetting.mockImplementation(async (key: string, value: string) => {
      if (key === WORKSPACE_REQUIREMENTS_SETTING_KEY) {
        await slowSave;
      }
      settings.set(key, value);
    });

    const savePromise = saveWorkspaceRequirements([{ ...a, title: "需求 A'" }]);
    const appendPromise = appendWorkspaceRequirement(b);
    releaseSave?.();
    const [saved, appended] = await Promise.all([savePromise, appendPromise]);

    // 队列串行后，最终盘上应同时保留编辑后的 A 与追加的 B（取决于排队顺序）。
    // append 在 save 之后：读到 A' 再追加 B → [A', B]
    // 若 save 在 append 之后：会覆盖成仅 [A'] — 所以 append 应排在 save 之后才稳。
    // 本测试保证二者都 settle 且最终 load 含 B 或至少队列不抛错；下面断言最终盘含两者。
    void saved;
    void appended;
    const final = await loadWorkspaceRequirements();
    const ids = new Set(final.items.map((item) => item.id));
    expect(ids.has(a.id)).toBe(true);
    expect(ids.has(b.id)).toBe(true);
  });

  test("append reads latest under write lock", async () => {
    const a = createWorkspaceRequirementItem("A", 1);
    const b = createWorkspaceRequirementItem("B", 2);
    await saveWorkspaceRequirements([a]);
    const next = await appendWorkspaceRequirement(b);
    expect(next.items.map((item) => item.id)).toEqual([a.id, b.id]);
  });
});
