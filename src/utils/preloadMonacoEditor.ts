/** Monaco 编辑器 chunk 预热（幂等）。 */

let monacoEditorPreloadStarted = false;

/**
 * 预取 `@monaco-editor/react` chunk，缩短首次打开仓库文件的冷启动。
 * 可在文件树可见 / 悬停时调用；重复调用无副作用。
 */
export function preloadMonacoEditor(): void {
  if (monacoEditorPreloadStarted) return;
  monacoEditorPreloadStarted = true;
  void import("@monaco-editor/react");
}

/** 测试用：重置预热状态。 */
export function resetMonacoEditorPreloadForTests(): void {
  monacoEditorPreloadStarted = false;
}
