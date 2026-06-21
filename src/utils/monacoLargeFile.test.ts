import { describe, expect, test } from "bun:test";
import {
  isMonacoHugeFileContent,
  isMonacoLargeFileContent,
  maxMonacoContentLength,
  MONACO_HUGE_FILE_CHAR_THRESHOLD,
  MONACO_LARGE_FILE_CHAR_THRESHOLD,
  MONACO_MEDIUM_FILE_CHAR_THRESHOLD,
  monacoEditorOptionsBucket,
  resolveWiseMonacoEditorOptions,
  shouldDeferMonacoEditorMount,
  shouldInjectMonacoContentAfterMount,
  shouldSkipMonacoTypeScriptModelSync,
  shouldSyncMonacoTypeScriptDependencies,
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
  });

  test("applies stricter limits for huge files", () => {
    const huge = resolveWiseMonacoEditorOptions("x".repeat(MONACO_HUGE_FILE_CHAR_THRESHOLD));
    expect(huge.folding).toBe(false);
    expect(huge.stopRenderingLineAfter).toBe(10000);
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
