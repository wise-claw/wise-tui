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

/** 超大文件（≥512KB）onChange 合并间隔：渲染频次直降，编辑手感由 Monaco 本地承担。 */
export const MONACO_HUGE_FILE_CHANGE_DEBOUNCE_MS = 500;

/**
 * 编辑器可读/可写正文上限（字节，与 Tauri `MAX_EDITOR_FILE_BYTES` 对齐）。
 * 前端对已拿到的字符串用 `length` 作近似二次闸门（源码多为 ASCII，偏差可接受）。
 */
export const EDITOR_FILE_MAX_BYTES = 4 * 1024 * 1024;

/** 小/中文件 keep-alive 上限。 */
export const FILE_EDITOR_KEEP_ALIVE_LIMIT_DEFAULT = 8;
/** large 文件 keep-alive 上限。 */
export const FILE_EDITOR_KEEP_ALIVE_LIMIT_LARGE = 2;
/** huge 文件 keep-alive 上限（仅活跃实例）。 */
export const FILE_EDITOR_KEEP_ALIVE_LIMIT_HUGE = 1;

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

/** medium 及以上：走 defaultValue / 防抖写入，避免每键受控重渲。 */
export function shouldUseMonacoDefaultValuePath(contentLength: number): boolean {
  return contentLength >= MONACO_MEDIUM_FILE_CHAR_THRESHOLD;
}

/** medium 及以上：onChange 合并进 React 状态。 */
export function shouldDebounceMonacoEditorContentChange(contentLength: number): boolean {
  return contentLength >= MONACO_MEDIUM_FILE_CHAR_THRESHOLD;
}

/** medium+ onChange 合并间隔：huge 用 500ms 直降 React 渲染频次，medium/large 保持 180ms。 */
export function resolveMonacoChangeDebounceMs(contentLength: number): number {
  return contentLength >= MONACO_HUGE_FILE_CHAR_THRESHOLD
    ? MONACO_HUGE_FILE_CHANGE_DEBOUNCE_MS
    : MONACO_LARGE_FILE_CHANGE_DEBOUNCE_MS;
}

/** large/huge Diff 用 inline，避免双栏 diff 算法拖垮主线程。 */
export function shouldRenderDiffSideBySide(contentLength: number): boolean {
  return contentLength < MONACO_LARGE_FILE_CHAR_THRESHOLD;
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

/**
 * DiffEditor 正文同步策略：
 * - controlled：小文件，original/modified 随 props 受控更新
 * - frozen：large，挂载时快照后冻结 props，避免编辑/父级重渲触发反复 setValue
 * - inject：huge，空串挂载后再 idle 注入（对齐普通编辑器）
 */
export type DiffEditorContentStrategy = "controlled" | "frozen" | "inject";

export function resolveDiffEditorContentStrategy(
  contentLength: number,
): DiffEditorContentStrategy {
  if (contentLength >= MONACO_HUGE_FILE_CHAR_THRESHOLD) return "inject";
  // medium/large：冻结受控 props，避免编辑时反复 setValue。
  if (contentLength >= MONACO_MEDIUM_FILE_CHAR_THRESHOLD) return "frozen";
  return "controlled";
}

/**
 * DiffEditor 的 original/modified 为受控 props。
 * huge → 空串 + inject；large/small 仍返回实参，由调用方决定是否冻结。
 */
export function resolveDiffEditorMountContent(args: {
  original: string;
  modified: string;
  contentLength: number;
}): {
  original: string;
  modified: string;
  strategy: DiffEditorContentStrategy;
  injectAfterMount: boolean;
} {
  const strategy = resolveDiffEditorContentStrategy(args.contentLength);
  if (strategy === "inject") {
    return { original: "", modified: "", strategy, injectAfterMount: true };
  }
  return {
    original: args.original,
    modified: args.modified,
    strategy,
    injectAfterMount: false,
  };
}

/**
 * 按当前打开 tabs 中最大 content.length 决定 Monaco keep-alive 上限：
 * huge→1、large→2、其余→8。
 */
export function resolveFileEditorKeepAliveLimit(maxContentLength: number): number {
  if (maxContentLength >= MONACO_HUGE_FILE_CHAR_THRESHOLD) {
    return FILE_EDITOR_KEEP_ALIVE_LIMIT_HUGE;
  }
  if (maxContentLength >= MONACO_LARGE_FILE_CHAR_THRESHOLD) {
    return FILE_EDITOR_KEEP_ALIVE_LIMIT_LARGE;
  }
  return FILE_EDITOR_KEEP_ALIVE_LIMIT_DEFAULT;
}

/**
 * 估算 tab 正文规模，供 keep-alive 上限使用。
 * contentReleased 后 content 为空，需回退 diskStat.byteLen，避免上限从 huge 回弹到 8。
 * byteLen 为字节近似；多字节 UTF-8 略偏大，keep-alive 更紧，可接受。
 */
export function estimateFileEditorTabContentLength(tab: {
  content: string;
  diffOriginal?: string;
  diskStat?: { byteLen: number };
}): number {
  let max = tab.content.length;
  if (tab.diffOriginal !== undefined && tab.diffOriginal.length > max) {
    max = tab.diffOriginal.length;
  }
  const diskBytes = tab.diskStat?.byteLen;
  if (typeof diskBytes === "number" && diskBytes > max) {
    max = diskBytes;
  }
  return max;
}

/**
 * 是否启用 Git 行 gutter 装饰。
 * medium 及以上全量 `diffLines` + `getValue()` 会卡主线程，直接关闭。
 */
export function shouldEnableMonacoGitLineDecorations(contentLength: number): boolean {
  return contentLength < MONACO_MEDIUM_FILE_CHAR_THRESHOLD;
}

/** 已拿到的正文是否超过编辑器产品上限（近似用 string.length）。 */
export function isEditorFileContentTooLarge(content: string): boolean {
  return content.length > EDITOR_FILE_MAX_BYTES;
}

/**
 * 超大文件强制 plaintext，避免拉起 TS/JSON 等 language worker 拖慢首开。
 * large 及以下保留路径推断语言（语法着色仍有价值，且 large 已关 TS model sync）。
 */
export function resolveMonacoEditorLanguage(
  baseLanguage: string,
  contentLength: number,
): string {
  if (contentLength >= MONACO_HUGE_FILE_CHAR_THRESHOLD) return "plaintext";
  return baseLanguage;
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
    links: false,
    quickSuggestions: false,
    suggestOnTriggerCharacters: false,
    parameterHints: { enabled: false },
    hover: { enabled: false },
    renderLineHighlight: "none",
    matchBrackets: "never",
    bracketPairColorization: { enabled: false },
    unicodeHighlight: {
      ambiguousCharacters: false,
      invisibleCharacters: false,
      nonBasicASCII: false,
    },
    guides: {
      indentation: false,
      bracketPairs: false,
      bracketPairsHorizontal: false,
      highlightActiveIndentation: false,
      highlightActiveBracketPair: false,
    },
    smoothScrolling: false,
    ...(huge
      ? {
          folding: false,
          stopRenderingLineAfter: 5000,
          renderWhitespace: "none" as const,
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
