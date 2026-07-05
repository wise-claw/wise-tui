import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";

// 用真实 service + 真实 wiseDefaultConfigStore，只 mock 底层 appSettingsStore（与既有
// repositoryRunCommandRowActionPreference / wiseDefaultConfigStore 测试同模式）。这样不会
// 跨文件替换 service 模块，避免污染 service 测试。atMentionShortcutChord 也用真实实现，
// reserved chord 用例直接传真实保留键 "mod+i"（normalizeChord → "Mod+KeyI"）。
const stored = new Map<string, string>();
const getAppSetting = mock(async (key: string) => stored.get(key) ?? null);
const setAppSetting = mock(async (key: string, value: string) => {
  stored.set(key, value);
});
const setAppSettingJson = mock(async (key: string, value: unknown) => {
  stored.set(key, JSON.stringify(value));
});
const deleteAppSetting = mock(async (key: string) => {
  stored.delete(key);
});

mock.module("../services/appSettingsStore", () => ({
  getAppSetting,
  setAppSetting,
  setAppSettingJson,
  deleteAppSetting,
  getAppSettingJson: async (key: string) => {
    const raw = stored.get(key);
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  },
  getAppSettingsBatch: async (keys: string[]) =>
    Object.fromEntries(keys.map((k) => [k, stored.get(k) ?? null])),
  WISE_CLAUDE_DEFAULT_SETTINGS_KEY: "wise.claudeDefaultSettings.v1",
  WISE_CODEX_DEFAULT_SETTINGS_KEY: "wise.codexDefaultSettings.v1",
  WISE_OPENCODE_DEFAULT_SETTINGS_KEY: "wise.opencodeDefaultSettings.v1",
}));

mock.module("antd", () => ({
  message: {
    warning: () => undefined,
    error: () => undefined,
  },
}));

import type { ComposerCommonPhrase } from "../constants/composerCommonPhrase";
import {
  getComposerCommonPhrasesStore,
  resetComposerCommonPhrasesStoreForTests,
} from "./composerCommonPhrasesStore";

function phrase(id: string, text: string, chord?: string): ComposerCommonPhrase {
  const base = { id, title: text, text, action: "send" as const };
  return chord ? { ...base, chord } : base;
}

describe("composerCommonPhrasesStore", () => {
  beforeEach(() => {
    resetComposerCommonPhrasesStoreForTests();
    stored.clear();
    getAppSetting.mockReset();
    setAppSetting.mockReset();
    setAppSettingJson.mockReset();
    deleteAppSetting.mockReset();
    getAppSetting.mockImplementation(async (key: string) => stored.get(key) ?? null);
    setAppSetting.mockImplementation(async (key: string, value: string) => {
      stored.set(key, value);
    });
    setAppSettingJson.mockImplementation(async (key: string, value: unknown) => {
      stored.set(key, JSON.stringify(value));
    });
    deleteAppSetting.mockImplementation(async (key: string) => {
      stored.delete(key);
    });
  });

  afterEach(() => {
    if (typeof globalThis.window !== "undefined") {
      Reflect.deleteProperty(globalThis, "window");
    }
  });

  test("same scope returns cached api; global/null/falsy id collapse to global", () => {
    const a1 = getComposerCommonPhrasesStore({ repositoryId: 7 });
    const a2 = getComposerCommonPhrasesStore({ repositoryId: 7 });
    expect(a1).toBe(a2);
    expect(a1.scopeKey).toBe("repo:7");
    expect(a1.repositoryId).toBe(7);

    const b = getComposerCommonPhrasesStore({ repositoryId: 9 });
    expect(b).not.toBe(a1);
    expect(b.scopeKey).toBe("repo:9");

    const g1 = getComposerCommonPhrasesStore({});
    const g2 = getComposerCommonPhrasesStore({ repositoryId: null });
    const g3 = getComposerCommonPhrasesStore({ repositoryId: 0 });
    expect(g1).toBe(g2);
    expect(g1).toBe(g3);
    expect(g1.scopeKey).toBe("global");
    expect(g1.repositoryId).toBeNull();
  });

  test("repo scope loads from per-repo service", async () => {
    stored.set(
      "wise.composer.commonPhrasesByRepo.v1",
      JSON.stringify({ 7: [phrase("a", "hello")] }),
    );
    const api = getComposerCommonPhrasesStore({ repositoryId: 7 });
    await api.ensureLoaded();
    expect(api.getPhrases().map((p) => p.text)).toEqual(["hello"]);
  });

  test("persist writes through per-repo service and updates snapshot", async () => {
    const api = getComposerCommonPhrasesStore({ repositoryId: 7 });
    await api.persist([phrase("x", "new")]);
    expect(setAppSetting).toHaveBeenCalledWith(
      "wise.composer.commonPhrasesByRepo.v1",
      expect.any(String),
    );
    expect(api.getPhrases().map((p) => p.text)).toEqual(["new"]);
  });

  test("persisting one repo does not contaminate another repo scope", async () => {
    const repoA = getComposerCommonPhrasesStore({ repositoryId: 7 });
    await repoA.persist([phrase("a", "alpha")]);
    const repoB = getComposerCommonPhrasesStore({ repositoryId: 9 });
    await repoB.persist([phrase("b", "beta")]);
    expect(repoA.getPhrases().map((p) => p.text)).toEqual(["alpha"]);
    expect(repoB.getPhrases().map((p) => p.text)).toEqual(["beta"]);
    // 持久化 map 同时含两个 repo
    const raw = stored.get("wise.composer.commonPhrasesByRepo.v1");
    expect(raw).toContain('"7"');
    expect(raw).toContain('"9"');
  });

  test("reserved chord aborts persist without saving", async () => {
    const api = getComposerCommonPhrasesStore({ repositoryId: 7 });
    // "mod+keyi" 经 normalizeChord 规整为 "Mod+KeyI"，命中内置保留键（⌘I 附加文件）
    await expect(api.persist([phrase("x", "bad", "mod+keyi")])).rejects.toThrow(
      "reserved-chord",
    );
    expect(setAppSetting).not.toHaveBeenCalled();
  });
});
