import type { editor } from "monaco-editor";

/** Monaco 运行时支持 semanticHighlighting，但 @monaco-editor/react 的类型定义尚未收录。 */
export type WiseMonacoEditorConstructionOptions = editor.IStandaloneEditorConstructionOptions & {
  semanticHighlighting?: { enabled: boolean };
};

/**
 * Wise 仓库文件编辑器等场景共用的 Monaco 选项（减轻触控板滚动误选等问题）。
 *
 * 注意：不启用 `automaticLayout`。Monaco 的 automaticLayout 会持续轮询容器尺寸，
 * 多 tab 场景下每个实例都各自轮询，开销可观。改为由各编辑器宿主用 ResizeObserver
 * 仅在容器尺寸真正变化时调用 `editor.layout()`（见 RepositoryFileEditorTabSurface /
 * GitDiffMonacoPane）。非活跃 tab 不挂载编辑器，进一步避免无谓的布局计算。
 */
export const WISE_MONACO_EDITOR_OPTIONS: WiseMonacoEditorConstructionOptions = {
  minimap: { enabled: false },
  stickyScroll: { enabled: false },
  fontSize: 13,
  lineNumbers: "on",
  wordWrap: "on",
  tabSize: 2,
  scrollBeyondLastLine: false,
  smoothScrolling: true,
  mouseWheelScrollSensitivity: 1,
  fastScrollSensitivity: 5,
  dragAndDrop: false,
  selectOnLineNumbers: true,
  selectionClipboard: false,
  // 默认关闭语义高亮：Monaco TS worker 在依赖图不全时提供的 semantic tokens 质量差，
  // 会导致标识符着色异常（如被渲染成红色等配色错乱）。改用稳定的 TextMate 语法
  // 高亮（关键字/字符串/数字/函数等内置配色），配色可预期，与诊断策略一致——
  // 都承认本地类型环境不完整。
  // 例外：.tsx/.jsx 文件必须开启（见 shouldEnableMonacoSemanticHighlighting）——
  // Monaco 的 typescript/javascript Monarch tokenizer 不含 JSX 规则，JSX 标签
  // (<div>、<Component />) 的着色完全依赖 TS worker 的 semantic tokens。
  semanticHighlighting: { enabled: false },
  scrollbar: {
    /** 滚动事件留在编辑器内，减少 macOS 触控板滚动误触选区。 */
    alwaysConsumeMouseWheel: true,
    useShadows: false,
  },
};

const MONACO_JSX_FILE_EXTENSIONS = new Set(["tsx", "jsx"]);

/**
 * 是否为该文件开启 Monaco 语义高亮（semantic highlighting）。
 *
 * 仅 .tsx/.jsx 开启：Monaco 内置的 typescript/javascript Monarch tokenizer 不含 JSX
 * 规则，JSX 标签与属性的高色完全依赖 TS worker 的 semantic tokens。关闭后这些文件
 * 的 JSX 部分会失去颜色。而 JSX 标签的 semantic 分类属于语法结构识别（不依赖类型
 * 解析），在依赖图不全时仍稳定，误报风险远低于类型相关的标识符着色。
 *
 * 其余文件保持关闭（见 WISE_MONACO_EDITOR_OPTIONS 注释），避免类型着色异常。
 */
export function shouldEnableMonacoSemanticHighlighting(
  relativePath: string | null | undefined,
): boolean {
  if (!relativePath) return false;
  const fileName = relativePath.split(/[\\/]/).pop() ?? "";
  const dot = fileName.lastIndexOf(".");
  if (dot < 0) return false;
  return MONACO_JSX_FILE_EXTENSIONS.has(fileName.slice(dot + 1).toLowerCase());
}

/**
 * 按文件路径合并语义高亮选项：tsx/jsx 开启，其余沿用传入 options（默认关闭）。
 * 返回新对象，不修改入参。
 */
export function applyMonacoSemanticHighlightingForPath(
  options: WiseMonacoEditorConstructionOptions,
  relativePath: string | null | undefined,
): WiseMonacoEditorConstructionOptions {
  if (!shouldEnableMonacoSemanticHighlighting(relativePath)) return options;
  return { ...options, semanticHighlighting: { enabled: true } };
}
