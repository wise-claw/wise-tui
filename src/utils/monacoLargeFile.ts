import type { editor } from "monaco-editor";
import {
  applyMonacoSemanticHighlightingForPath,
  WISE_MONACO_EDITOR_OPTIONS,
} from "./wiseMonacoEditorOptions";

/** 超过此字符数视为中等文件，关闭出现高亮/选区高亮等较重的实时特性。 */
export const MONACO_MEDIUM_FILE_CHAR_THRESHOLD = 50 * 1024;

/** 超过此字符数视为大文件，关闭部分 Monaco 特性并延后 TS 依赖同步。 */
export const MONACO_LARGE_FILE_CHAR_THRESHOLD = 128 * 1024;

/** 超过此字符数视为超大文件，延后注入正文并收紧渲染限制。 */
export const MONACO_HUGE_FILE_CHAR_THRESHOLD = 512 * 1024;

/** 超大文件 onChange 合并写入 React 状态的间隔（毫秒）。 */
export const MONACO_LARGE_FILE_CHANGE_DEBOUNCE_MS = 180;

export type MonacoEditorOptionsBucket = "small" | "medium" | "large" | "huge";

export function monacoEditorOptionsBucket(length: number): MonacoEditorOptionsBucket {
  if (length >= MONACO_HUGE_FILE_CHAR_THRESHOLD) return "huge";
  if (length >= MONACO_LARGE_FILE_CHAR_THRESHOLD) return "large";
  if (length >= MONACO_MEDIUM_FILE_CHAR_THRESHOLD) return "medium";
  return "small";
}

export function isMonacoLargeFileContent(content: string): boolean {
  return content.length >= MONACO_LARGE_FILE_CHAR_THRESHOLD;
}

export function isMonacoHugeFileContent(content: string): boolean {
  return content.length >= MONACO_HUGE_FILE_CHAR_THRESHOLD;
}

export function shouldSyncMonacoTypeScriptDependencies(content: string): boolean {
  return content.length < MONACO_LARGE_FILE_CHAR_THRESHOLD;
}

export function shouldSkipMonacoTypeScriptModelSync(contentLength: number): boolean {
  return contentLength >= MONACO_LARGE_FILE_CHAR_THRESHOLD;
}

export function shouldDeferMonacoEditorMount(contentLength: number): boolean {
  return contentLength >= MONACO_LARGE_FILE_CHAR_THRESHOLD;
}

export function shouldInjectMonacoContentAfterMount(contentLength: number): boolean {
  return contentLength >= MONACO_HUGE_FILE_CHAR_THRESHOLD;
}

export function resolveWiseMonacoEditorOptions(
  content: string,
  relativePath?: string,
): editor.IStandaloneEditorConstructionOptions {
  return resolveWiseMonacoEditorOptionsFromLength(content.length, relativePath);
}

export function resolveWiseMonacoEditorOptionsFromLength(
  length: number,
  relativePath?: string,
): editor.IStandaloneEditorConstructionOptions {
  // 仅小/中文件为 tsx/jsx 开启语义高亮（JSX 标签着色所必需）。
  // large/huge 文件本就跳过 TS model 同步、关闭诊断渲染，开启语义高亮无 TS worker
  // 支撑且徒增开销，故保持关闭。
  if (length < MONACO_MEDIUM_FILE_CHAR_THRESHOLD) {
    return applyMonacoSemanticHighlightingForPath(WISE_MONACO_EDITOR_OPTIONS, relativePath);
  }

  // 中等文件（50KB-128KB）：仅关闭出现高亮/选区高亮等实时渲染开销大的特性，
  // 保留折行、折叠、校验等正常编辑体验。
  if (length < MONACO_LARGE_FILE_CHAR_THRESHOLD) {
    return applyMonacoSemanticHighlightingForPath(
      {
        ...WISE_MONACO_EDITOR_OPTIONS,
        occurrencesHighlight: "off",
        selectionHighlight: false,
      },
      relativePath,
    );
  }

  const huge = length >= MONACO_HUGE_FILE_CHAR_THRESHOLD;
  return {
    ...WISE_MONACO_EDITOR_OPTIONS,
    wordWrap: "off",
    occurrencesHighlight: "off",
    selectionHighlight: false,
    codeLens: false,
    colorDecorators: false,
    renderValidationDecorations: "off",
    largeFileOptimizations: true,
    ...(huge
      ? {
          folding: false,
          stopRenderingLineAfter: 10000,
        }
      : {
          folding: true,
        }),
  };
}

export function maxMonacoContentLength(...contents: string[]): number {
  let max = 0;
  for (const content of contents) {
    if (content.length > max) {
      max = content.length;
    }
  }
  return max;
}
