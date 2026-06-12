import { describe, expect, test } from "bun:test";
import {
  isMonacoHugeFileContent,
  isMonacoLargeFileContent,
  maxMonacoContentLength,
  MONACO_HUGE_FILE_CHAR_THRESHOLD,
  MONACO_LARGE_FILE_CHAR_THRESHOLD,
  monacoEditorOptionsBucket,
  resolveWiseMonacoEditorOptions,
  shouldDeferMonacoEditorMount,
  shouldInjectMonacoContentAfterMount,
  shouldSkipMonacoTypeScriptModelSync,
  shouldSyncMonacoTypeScriptDependencies,
} from "./monacoLargeFile";
import { WISE_MONACO_EDITOR_OPTIONS } from "./wiseMonacoEditorOptions";

describe("monacoLargeFile", () => {
  test("classifies content by thresholds", () => {
    const small = "a".repeat(MONACO_LARGE_FILE_CHAR_THRESHOLD - 1);
    const large = "a".repeat(MONACO_LARGE_FILE_CHAR_THRESHOLD);
    const huge = "a".repeat(MONACO_HUGE_FILE_CHAR_THRESHOLD);

    expect(isMonacoLargeFileContent(small)).toBe(false);
    expect(isMonacoLargeFileContent(large)).toBe(true);
    expect(isMonacoHugeFileContent(large)).toBe(false);
    expect(isMonacoHugeFileContent(huge)).toBe(true);
    expect(shouldSyncMonacoTypeScriptDependencies(small)).toBe(true);
    expect(shouldSyncMonacoTypeScriptDependencies(large)).toBe(false);
  });

  test("returns base options for small files", () => {
    expect(resolveWiseMonacoEditorOptions("hello")).toEqual(WISE_MONACO_EDITOR_OPTIONS);
  });

  test("relaxes expensive editor features for large files", () => {
    const large = resolveWiseMonacoEditorOptions("x".repeat(MONACO_LARGE_FILE_CHAR_THRESHOLD));
    expect(large.wordWrap).toBe("off");
    expect(large.largeFileOptimizations).toBe(true);
    expect(large.occurrencesHighlight).toBe("off");
  });

  test("applies stricter limits for huge files", () => {
    const huge = resolveWiseMonacoEditorOptions("x".repeat(MONACO_HUGE_FILE_CHAR_THRESHOLD));
    expect(huge.folding).toBe(false);
    expect(huge.stopRenderingLineAfter).toBe(10000);
  });

  test("maxMonacoContentLength picks the largest body", () => {
    expect(maxMonacoContentLength("abc", "abcdef")).toBe(6);
  });

  test("defers mount and skips model sync for large content", () => {
    expect(shouldDeferMonacoEditorMount(MONACO_LARGE_FILE_CHAR_THRESHOLD)).toBe(true);
    expect(shouldSkipMonacoTypeScriptModelSync(MONACO_LARGE_FILE_CHAR_THRESHOLD)).toBe(true);
    expect(shouldInjectMonacoContentAfterMount(MONACO_HUGE_FILE_CHAR_THRESHOLD)).toBe(true);
    expect(monacoEditorOptionsBucket(MONACO_LARGE_FILE_CHAR_THRESHOLD - 1)).toBe("small");
    expect(monacoEditorOptionsBucket(MONACO_LARGE_FILE_CHAR_THRESHOLD)).toBe("large");
    expect(monacoEditorOptionsBucket(MONACO_HUGE_FILE_CHAR_THRESHOLD)).toBe("huge");
  });
});
