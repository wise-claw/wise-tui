import { describe, expect, test } from "bun:test";
import {
  estimateFileEditorTabContentLength,
  FILE_EDITOR_KEEP_ALIVE_LIMIT_DEFAULT,
  FILE_EDITOR_KEEP_ALIVE_LIMIT_HUGE,
  FILE_EDITOR_KEEP_ALIVE_LIMIT_LARGE,
  isMonacoHugeFileContent,
  isMonacoLargeFileContent,
  maxMonacoContentLength,
  MONACO_HUGE_FILE_CHAR_THRESHOLD,
  MONACO_LARGE_FILE_CHAR_THRESHOLD,
  MONACO_MEDIUM_FILE_CHAR_THRESHOLD,
  monacoEditorOptionsBucket,
  EDITOR_FILE_MAX_BYTES,
  isEditorFileContentTooLarge,
  resolveFileEditorKeepAliveLimit,
  resolveMonacoEditorLanguage,
  resolveWiseMonacoEditorOptions,
  shouldDeferMonacoEditorMount,
  shouldEnableMonacoGitLineDecorations,
  shouldInjectMonacoContentAfterMount,
  resolveDiffEditorContentStrategy,
  resolveDiffEditorMountContent,
  shouldDebounceMonacoEditorContentChange,
  shouldRenderDiffSideBySide,
  shouldSkipMonacoTypeScriptModelSync,
  shouldSyncMonacoTypeScriptDependencies,
  shouldUseMonacoDefaultValuePath,
} from "./monacoLargeFile";
import {
  shouldEnableMonacoSemanticHighlighting,
  WISE_MONACO_EDITOR_OPTIONS,
} from "./wiseMonacoEditorOptions";

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
    expect(large.links).toBe(false);
    expect(large.quickSuggestions).toBe(false);
    expect(large.hover).toEqual({ enabled: false });
    expect(large.smoothScrolling).toBe(false);
    expect(large.renderLineHighlight).toBe("none");
  });

  test("applies stricter limits for huge files", () => {
    const huge = resolveWiseMonacoEditorOptions("x".repeat(MONACO_HUGE_FILE_CHAR_THRESHOLD));
    expect(huge.folding).toBe(false);
    expect(huge.stopRenderingLineAfter).toBe(5000);
    expect(huge.renderWhitespace).toBe("none");
  });

  test("resolveFileEditorKeepAliveLimit scales with content size", () => {
    expect(resolveFileEditorKeepAliveLimit(0)).toBe(FILE_EDITOR_KEEP_ALIVE_LIMIT_DEFAULT);
    expect(resolveFileEditorKeepAliveLimit(MONACO_LARGE_FILE_CHAR_THRESHOLD - 1)).toBe(
      FILE_EDITOR_KEEP_ALIVE_LIMIT_DEFAULT,
    );
    expect(resolveFileEditorKeepAliveLimit(MONACO_LARGE_FILE_CHAR_THRESHOLD)).toBe(
      FILE_EDITOR_KEEP_ALIVE_LIMIT_LARGE,
    );
    expect(resolveFileEditorKeepAliveLimit(MONACO_HUGE_FILE_CHAR_THRESHOLD)).toBe(
      FILE_EDITOR_KEEP_ALIVE_LIMIT_HUGE,
    );
  });

  test("disables git gutter decorations for medium+ files", () => {
    expect(shouldEnableMonacoGitLineDecorations(MONACO_MEDIUM_FILE_CHAR_THRESHOLD - 1)).toBe(true);
    expect(shouldEnableMonacoGitLineDecorations(MONACO_MEDIUM_FILE_CHAR_THRESHOLD)).toBe(false);
    expect(shouldEnableMonacoGitLineDecorations(MONACO_LARGE_FILE_CHAR_THRESHOLD)).toBe(false);
  });

  test("estimateFileEditorTabContentLength falls back to diskStat after content release", () => {
    expect(
      estimateFileEditorTabContentLength({
        content: "",
        diskStat: { byteLen: MONACO_HUGE_FILE_CHAR_THRESHOLD },
      }),
    ).toBe(MONACO_HUGE_FILE_CHAR_THRESHOLD);
    expect(
      estimateFileEditorTabContentLength({
        content: "abc",
        diffOriginal: "x".repeat(100),
        diskStat: { byteLen: 10 },
      }),
    ).toBe(100);
  });

  test("isEditorFileContentTooLarge matches 4MiB product gate", () => {
    expect(isEditorFileContentTooLarge("a".repeat(EDITOR_FILE_MAX_BYTES))).toBe(false);
    expect(isEditorFileContentTooLarge("a".repeat(EDITOR_FILE_MAX_BYTES + 1))).toBe(true);
  });

  test("resolveMonacoEditorLanguage forces plaintext for huge files", () => {
    expect(resolveMonacoEditorLanguage("typescript", MONACO_HUGE_FILE_CHAR_THRESHOLD - 1)).toBe(
      "typescript",
    );
    expect(resolveMonacoEditorLanguage("typescript", MONACO_HUGE_FILE_CHAR_THRESHOLD)).toBe(
      "plaintext",
    );
    expect(resolveMonacoEditorLanguage("json", MONACO_LARGE_FILE_CHAR_THRESHOLD)).toBe("json");
  });

  test("turns off highlight features for medium files", () => {
    const medium = resolveWiseMonacoEditorOptions("x".repeat(MONACO_MEDIUM_FILE_CHAR_THRESHOLD));
    // 中等文件保留正常编辑体验，仅关闭出现/选区高亮。
    expect(medium.occurrencesHighlight).toBe("off");
    expect(medium.selectionHighlight).toBe(false);
    expect(medium.wordWrap).toBe("on");
    expect(medium.largeFileOptimizations).toBeUndefined();
  });

  test("maxMonacoContentLength picks the largest body", () => {
    expect(maxMonacoContentLength("abc", "abcdef")).toBe(6);
  });

  test("resolveDiffEditorMountContent / strategy covers controlled·frozen·inject", () => {
    expect(resolveDiffEditorContentStrategy(0)).toBe("controlled");
    expect(resolveDiffEditorContentStrategy(MONACO_MEDIUM_FILE_CHAR_THRESHOLD)).toBe("frozen");
    expect(resolveDiffEditorContentStrategy(MONACO_LARGE_FILE_CHAR_THRESHOLD)).toBe("frozen");
    expect(resolveDiffEditorContentStrategy(MONACO_HUGE_FILE_CHAR_THRESHOLD)).toBe("inject");

    expect(shouldUseMonacoDefaultValuePath(MONACO_MEDIUM_FILE_CHAR_THRESHOLD - 1)).toBe(false);
    expect(shouldUseMonacoDefaultValuePath(MONACO_MEDIUM_FILE_CHAR_THRESHOLD)).toBe(true);
    expect(shouldDebounceMonacoEditorContentChange(MONACO_MEDIUM_FILE_CHAR_THRESHOLD)).toBe(true);
    expect(shouldRenderDiffSideBySide(MONACO_LARGE_FILE_CHAR_THRESHOLD - 1)).toBe(true);
    expect(shouldRenderDiffSideBySide(MONACO_LARGE_FILE_CHAR_THRESHOLD)).toBe(false);

    const left = "L".repeat(MONACO_HUGE_FILE_CHAR_THRESHOLD);
    const right = "R".repeat(100);
    const huge = resolveDiffEditorMountContent({
      original: left,
      modified: right,
      contentLength: maxMonacoContentLength(left, right),
    });
    expect(huge).toEqual({
      original: "",
      modified: "",
      strategy: "inject",
      injectAfterMount: true,
    });

    const largeBody = "x".repeat(MONACO_LARGE_FILE_CHAR_THRESHOLD);
    const large = resolveDiffEditorMountContent({
      original: largeBody,
      modified: "y",
      contentLength: largeBody.length,
    });
    expect(large.strategy).toBe("frozen");
    expect(large.injectAfterMount).toBe(false);
    expect(large.original).toBe(largeBody);

    const small = resolveDiffEditorMountContent({
      original: "a",
      modified: "b",
      contentLength: 1,
    });
    expect(small).toEqual({
      original: "a",
      modified: "b",
      strategy: "controlled",
      injectAfterMount: false,
    });
  });

  test("tsx/jsx 文件开启语义高亮以支持 JSX 标签着色", () => {
    // Monaco typescript Monarch tokenizer 不含 JSX 规则，JSX 标签着色依赖 semantic tokens。
    const tsxOptions = resolveWiseMonacoEditorOptions("export const X = () => <div />;", "src/App.tsx");
    expect(tsxOptions.semanticHighlighting).toEqual({ enabled: true });

    const jsxOptions = resolveWiseMonacoEditorOptions("const X = () => <div />;", "src/Foo.jsx");
    expect(jsxOptions.semanticHighlighting).toEqual({ enabled: true });
  });

  test("非 tsx/jsx 文件保持语义高亮关闭", () => {
    // 避免 TS worker 依赖图不全时的标识符着色异常。
    const tsOptions = resolveWiseMonacoEditorOptions("const a = 1;", "src/lib.ts");
    expect(tsOptions.semanticHighlighting).toEqual({ enabled: false });

    const noPathOptions = resolveWiseMonacoEditorOptions("const a = 1;");
    expect(noPathOptions.semanticHighlighting).toEqual({ enabled: false });
  });

  test("large/huge tsx 文件不开启语义高亮（性能）", () => {
    const largeTsx = resolveWiseMonacoEditorOptions(
      "x".repeat(MONACO_LARGE_FILE_CHAR_THRESHOLD),
      "src/Huge.tsx",
    );
    expect(largeTsx.semanticHighlighting).toEqual({ enabled: false });
  });

  test("中等 tsx 文件仍开启语义高亮", () => {
    const mediumTsx = resolveWiseMonacoEditorOptions(
      "x".repeat(MONACO_MEDIUM_FILE_CHAR_THRESHOLD),
      "src/Mid.tsx",
    );
    expect(mediumTsx.semanticHighlighting).toEqual({ enabled: true });
    // 中等文件特性不受影响。
    expect(mediumTsx.occurrencesHighlight).toBe("off");
  });

  test("defers mount and skips model sync for large content", () => {
    expect(shouldDeferMonacoEditorMount(MONACO_LARGE_FILE_CHAR_THRESHOLD)).toBe(true);
    expect(shouldSkipMonacoTypeScriptModelSync(MONACO_LARGE_FILE_CHAR_THRESHOLD)).toBe(true);
    expect(shouldInjectMonacoContentAfterMount(MONACO_HUGE_FILE_CHAR_THRESHOLD)).toBe(true);
    expect(monacoEditorOptionsBucket(MONACO_MEDIUM_FILE_CHAR_THRESHOLD - 1)).toBe("small");
    expect(monacoEditorOptionsBucket(MONACO_MEDIUM_FILE_CHAR_THRESHOLD)).toBe("medium");
    expect(monacoEditorOptionsBucket(MONACO_LARGE_FILE_CHAR_THRESHOLD - 1)).toBe("medium");
    expect(monacoEditorOptionsBucket(MONACO_LARGE_FILE_CHAR_THRESHOLD)).toBe("large");
    expect(monacoEditorOptionsBucket(MONACO_HUGE_FILE_CHAR_THRESHOLD)).toBe("huge");
  });
});

describe("shouldEnableMonacoSemanticHighlighting", () => {
  test("tsx/jsx 扩展名（含大小写、Windows 路径）判定为开启", () => {
    expect(shouldEnableMonacoSemanticHighlighting("src/App.tsx")).toBe(true);
    expect(shouldEnableMonacoSemanticHighlighting("src/Foo.jsx")).toBe(true);
    expect(shouldEnableMonacoSemanticHighlighting("src/Foo.TSX")).toBe(true);
    expect(shouldEnableMonacoSemanticHighlighting("src\\sub\\Foo.jsx")).toBe(true);
  });

  test("非 JSX 扩展名或空路径判定为关闭", () => {
    expect(shouldEnableMonacoSemanticHighlighting("src/lib.ts")).toBe(false);
    expect(shouldEnableMonacoSemanticHighlighting("src/lib.js")).toBe(false);
    expect(shouldEnableMonacoSemanticHighlighting("README.md")).toBe(false);
    expect(shouldEnableMonacoSemanticHighlighting("")).toBe(false);
    expect(shouldEnableMonacoSemanticHighlighting(null)).toBe(false);
    expect(shouldEnableMonacoSemanticHighlighting(undefined)).toBe(false);
  });
});
