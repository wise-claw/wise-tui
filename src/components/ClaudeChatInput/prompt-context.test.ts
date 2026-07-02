import { describe, expect, mock, test, beforeEach } from "bun:test";

// 内存版 appSettingsStore：验证草稿迁移/清空的持久化契约。
const store = new Map<string, string>();

mock.module("../../services/appSettingsStore", () => ({
  getAppSetting: async (key: string) => store.get(key) ?? null,
  setAppSetting: async (key: string, value: string) => {
    store.set(key, value);
  },
  deleteAppSetting: async (key: string) => {
    store.delete(key);
  },
}));

import {
  migratePromptContextSessionKey,
  clearPromptContextSessionKey,
} from "./prompt-context";

const PREFIX = "wise.prompt.context.v1:";

const draft = JSON.stringify({
  prompt: [{ type: "text", text: "你好", start: 0, end: 0 }],
  cursor: 2,
  contextItems: [],
});

beforeEach(() => store.clear());

describe("migratePromptContextSessionKey", () => {
  test("把旧会话草稿迁移到新 key 并删除旧 key（移动语义）", async () => {
    store.set(PREFIX + "from", draft);

    await migratePromptContextSessionKey("from", "to");

    expect(store.has(PREFIX + "from")).toBe(false);
    expect(store.get(PREFIX + "to")).toBe(draft);
  });

  test("源 key 无草稿时为 no-op：不写新 key 也不删旧 key", async () => {
    await migratePromptContextSessionKey("from", "to");

    expect(store.has(PREFIX + "from")).toBe(false);
    expect(store.has(PREFIX + "to")).toBe(false);
  });

  test("from === to 时直接返回，不删除草稿", async () => {
    store.set(PREFIX + "same", draft);

    await migratePromptContextSessionKey("same", "same");

    expect(store.get(PREFIX + "same")).toBe(draft);
  });

  test("空 id 时直接返回", async () => {
    store.set(PREFIX + "from", draft);

    await migratePromptContextSessionKey("", "to");
    await migratePromptContextSessionKey("from", "   ");

    expect(store.get(PREFIX + "from")).toBe(draft);
    expect(store.has(PREFIX + "to")).toBe(false);
  });
});

describe("clearPromptContextSessionKey", () => {
  test("删除指定会话的草稿 key", async () => {
    store.set(PREFIX + "s1", draft);

    await clearPromptContextSessionKey("s1");

    expect(store.has(PREFIX + "s1")).toBe(false);
  });

  test("空 id 时为 no-op", async () => {
    store.set(PREFIX + "keep", draft);

    await clearPromptContextSessionKey("   ");

    expect(store.get(PREFIX + "keep")).toBe(draft);
  });
});
