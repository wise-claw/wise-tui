import { describe, expect, test } from "bun:test";
import {
  buildComposerCommonPhraseTooltipTitle,
  filterComposerCommonPhrasesForQuickBar,
  MAX_COMPOSER_COMMON_PHRASES,
  mergeComposerCommonPhrases,
  normalizeComposerCommonPhrases,
  resolveComposerCommonPhraseShowInQuickBar,
  truncateComposerCommonPhraseText,
} from "./composerCommonPhrase";

describe("normalizeComposerCommonPhrases", () => {
  test("drops empty text and dedupes chords", () => {
    const items = normalizeComposerCommonPhrases([
      { id: "a", title: "问候", text: "你好", chord: "Mod+Shift+KeyA" },
      { id: "b", title: "重复键", text: "再见", chord: "mod+shift+keya" },
      { id: "c", title: "空", text: "   " },
    ]);
    expect(items).toHaveLength(2);
    expect(items[0]?.chord).toBe("Mod+Shift+KeyA");
    expect(items[1]?.chord).toBeUndefined();
  });

  test("truncateComposerCommonPhraseText collapses whitespace and caps length", () => {
    const long = `${"请填写要发送的正文".repeat(20)}`;
    const out = truncateComposerCommonPhraseText(`  ${long}  `, 40);
    expect(out.length).toBeLessThanOrEqual(41);
    expect(out.endsWith("…")).toBe(true);
    expect(out.includes("\n")).toBe(false);
  });

  test("buildComposerCommonPhraseTooltipTitle uses truncated body", () => {
    const title = buildComposerCommonPhraseTooltipTitle({
      action: "insert",
      text: "a".repeat(200),
      chord: "Mod+Shift+KeyA",
    });
    expect(title.startsWith("填入输入框：")).toBe(true);
    expect(title.includes("…")).toBe(true);
    expect(title.includes("（")).toBe(true);
  });

  test("showInQuickBar defaults true and filters quick bar list", () => {
    const items = normalizeComposerCommonPhrases([
      { id: "a", title: "显示", text: "a" },
      { id: "b", title: "隐藏", text: "b", showInQuickBar: false },
    ]);
    expect(resolveComposerCommonPhraseShowInQuickBar(items[0]!)).toBe(true);
    expect(resolveComposerCommonPhraseShowInQuickBar(items[1]!)).toBe(false);
    expect(filterComposerCommonPhrasesForQuickBar(items).map((p) => p.id)).toEqual(["a"]);
  });

  test("normalizes action with send default", () => {
    const items = normalizeComposerCommonPhrases([
      { id: "a", title: "发", text: "go", action: "send" },
      { id: "b", title: "填", text: "fill", action: "insert" },
      { id: "c", title: "旧", text: "legacy" },
    ]);
    expect(items[0]?.action).toBe("send");
    expect(items[1]?.action).toBe("insert");
    expect(items[2]?.action).toBe("send");
  });
});

describe("mergeComposerCommonPhrases", () => {
  test("both empty returns empty", () => {
    expect(mergeComposerCommonPhrases([], [])).toEqual([]);
  });

  test("global only / repo only pass through", () => {
    const g = [{ id: "g1", title: "g", text: "gt", action: "send" as const }];
    const r = [{ id: "r1", title: "r", text: "rt", action: "send" as const }];
    expect(mergeComposerCommonPhrases(g, []).map((p) => p.id)).toEqual(["g1"]);
    expect(mergeComposerCommonPhrases([], r).map((p) => p.id)).toEqual(["r1"]);
  });

  test("global first then repo", () => {
    const g = [{ id: "g1", title: "g", text: "gt", action: "send" as const }];
    const r = [{ id: "r1", title: "r", text: "rt", action: "send" as const }];
    expect(mergeComposerCommonPhrases(g, r).map((p) => p.id)).toEqual(["g1", "r1"]);
  });

  test("repo chord wins; global same chord stripped (item kept)", () => {
    const g = [
      { id: "g1", title: "g", text: "gt", action: "send" as const, chord: "Mod+KeyK" },
    ];
    const r = [
      { id: "r1", title: "r", text: "rt", action: "send" as const, chord: "Mod+KeyK" },
    ];
    const merged = mergeComposerCommonPhrases(g, r);
    expect(merged.map((p) => p.id)).toEqual(["g1", "r1"]);
    expect(merged[0]?.chord).toBeUndefined();
    expect(merged[1]?.chord).toBe("Mod+KeyK");
  });

  test("non-conflicting chords both kept", () => {
    const g = [
      { id: "g1", title: "g", text: "gt", action: "send" as const, chord: "Mod+KeyA" },
    ];
    const r = [
      { id: "r1", title: "r", text: "rt", action: "send" as const, chord: "Mod+KeyB" },
    ];
    const merged = mergeComposerCommonPhrases(g, r);
    expect(merged[0]?.chord).toBe("Mod+KeyA");
    expect(merged[1]?.chord).toBe("Mod+KeyB");
  });

  test("truncates to MAX, keeping all global first", () => {
    const g = Array.from({ length: MAX_COMPOSER_COMMON_PHRASES }, (_, i) => ({
      id: `g${i}`,
      title: "g",
      text: "gt",
      action: "send" as const,
    }));
    const r = [{ id: "r1", title: "r", text: "rt", action: "send" as const }];
    const merged = mergeComposerCommonPhrases(g, r);
    expect(merged).toHaveLength(MAX_COMPOSER_COMMON_PHRASES);
    expect(merged.every((p) => p.id.startsWith("g"))).toBe(true);
  });
});
