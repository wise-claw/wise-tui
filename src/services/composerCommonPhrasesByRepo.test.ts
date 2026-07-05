import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";

const getAppSetting = mock(async () => null as string | null);
const setAppSetting = mock(async () => undefined);

mock.module("./appSettingsStore", () => ({
  getAppSetting,
  setAppSetting,
}));

import {
  COMPOSER_COMMON_PHRASES_BY_REPO_KEY,
  WISE_COMPOSER_COMMON_PHRASES_BY_REPO_CHANGED,
  deleteComposerCommonPhrasesForRepo,
  loadComposerCommonPhrasesByRepoMap,
  loadComposerCommonPhrasesForRepo,
  saveComposerCommonPhrasesForRepo,
} from "./composerCommonPhrasesByRepo";
import type { ComposerCommonPhrase } from "../constants/composerCommonPhrase";

function installWindowStub() {
  const listeners = new Map<string, Set<EventListener>>();
  Object.defineProperty(globalThis, "window", {
    value: {
      dispatchEvent: (event: Event) => {
        listeners.get(event.type)?.forEach((handler) => handler(event));
        return true;
      },
      addEventListener: (type: string, handler: EventListener) => {
        const bucket = listeners.get(type) ?? new Set<EventListener>();
        bucket.add(handler);
        listeners.set(type, bucket);
      },
      removeEventListener: (type: string, handler: EventListener) => {
        listeners.get(type)?.delete(handler);
      },
    },
    configurable: true,
  });
}

function phrase(id: string, text: string, chord?: string): ComposerCommonPhrase {
  const base = { id, title: text, text, action: "send" as const };
  return chord ? { ...base, chord } : base;
}

describe("composerCommonPhrasesByRepo", () => {
  let storedJson: string | null = null;

  beforeEach(() => {
    installWindowStub();
    storedJson = null;
    getAppSetting.mockReset();
    getAppSetting.mockImplementation(async (key: string) => {
      if (key === COMPOSER_COMMON_PHRASES_BY_REPO_KEY) return storedJson;
      return null;
    });
    setAppSetting.mockReset();
    setAppSetting.mockImplementation(async (key: string, value: string) => {
      if (key === COMPOSER_COMMON_PHRASES_BY_REPO_KEY) storedJson = value;
    });
  });

  afterEach(() => {
    Reflect.deleteProperty(globalThis, "window");
  });

  test("loadMap returns empty when unset", async () => {
    const map = await loadComposerCommonPhrasesByRepoMap();
    expect(map).toEqual({});
  });

  test("save persists per-repo and isolates repositories", async () => {
    await saveComposerCommonPhrasesForRepo(7, [phrase("a1", "hello")]);
    await saveComposerCommonPhrasesForRepo(9, [phrase("b1", "world")]);

    const map = await loadComposerCommonPhrasesByRepoMap();
    expect(Object.keys(map).sort()).toEqual(["7", "9"]);
    expect((await loadComposerCommonPhrasesForRepo(7))[0].text).toBe("hello");
    expect((await loadComposerCommonPhrasesForRepo(9))[0].text).toBe("world");
    // 串改校验：写入 9 不应影响 7 的内容
    expect(storedJson).toContain('"7"');
    expect(storedJson).toContain('"9"');
  });

  test("save with empty list deletes the repo entry", async () => {
    await saveComposerCommonPhrasesForRepo(7, [phrase("a1", "hello")]);
    expect((await loadComposerCommonPhrasesForRepo(7)).length).toBe(1);

    await saveComposerCommonPhrasesForRepo(7, []);
    const map = await loadComposerCommonPhrasesByRepoMap();
    expect(map[7]).toBeUndefined();
    expect(storedJson).not.toContain('"7"');
  });

  test("save normalizes chord conflicts within a repo (duplicate chord stripped)", async () => {
    // 两条同 chord：normalize 会把 chord 规整为 "Mod+k" 并保留第一条，第二条的 chord 被剥离
    const result = await saveComposerCommonPhrasesForRepo(7, [
      phrase("a1", "hello", "ctrl+k"),
      phrase("a2", "world", "ctrl+k"),
    ]);
    expect(result.length).toBe(2);
    expect(result[0].chord).toBe("Mod+k");
    expect(result[1].chord).toBeUndefined();
  });

  test("save dispatches changed event with next map", async () => {
    const events: Array<Record<number, unknown>> = [];
    window.addEventListener(WISE_COMPOSER_COMMON_PHRASES_BY_REPO_CHANGED, (event) => {
      events.push((event as CustomEvent<{ map: Record<number, unknown> }>).detail.map);
    });

    await saveComposerCommonPhrasesForRepo(7, [phrase("a1", "hello")]);
    expect(events.at(-1)?.[7]).toBeTruthy();
  });

  test("delete is a no-op when repo has no entry (does not write)", async () => {
    await deleteComposerCommonPhrasesForRepo(42);
    expect(setAppSetting).not.toHaveBeenCalled();
  });

  test("delete removes an existing entry", async () => {
    await saveComposerCommonPhrasesForRepo(7, [phrase("a1", "hello")]);
    await deleteComposerCommonPhrasesForRepo(7);
    const map = await loadComposerCommonPhrasesByRepoMap();
    expect(map[7]).toBeUndefined();
  });

  test("parse tolerates malformed JSON", async () => {
    storedJson = "not-json";
    const map = await loadComposerCommonPhrasesByRepoMap();
    expect(map).toEqual({});
  });

  test("parse drops invalid repositoryId keys", async () => {
    storedJson = JSON.stringify({ "0": [{ id: "x", text: "t", title: "t", action: "send" }] });
    const map = await loadComposerCommonPhrasesByRepoMap();
    expect(map).toEqual({});
  });
});
