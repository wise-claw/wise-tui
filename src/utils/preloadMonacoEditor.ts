/** Monaco 编辑器环境 + chunk 预热（幂等）。 */

let monacoEnvironmentPromise: Promise<void> | null = null;
let monacoEditorPreloadStarted = false;

/**
 * 确保本地 Monaco loader / worker 已注入（避免 @monaco-editor/react 走 CDN）。
 * 首次打开编辑器或主动预热时调用；不在应用启动时强制执行。
 */
export function ensureMonacoEnvironmentReady(): Promise<void> {
  if (!monacoEnvironmentPromise) {
    monacoEnvironmentPromise = import("../services/monacoEnvironment").then(() => undefined);
  }
  return monacoEnvironmentPromise;
}

/**
 * 预取 Monaco 环境与 `@monaco-editor/react` chunk，缩短首次打开仓库文件的冷启动。
 * 可在文件树可见 / 悬停时调用；重复调用无副作用。
 */
export function preloadMonacoEditor(): void {
  if (monacoEditorPreloadStarted) return;
  monacoEditorPreloadStarted = true;
  void ensureMonacoEnvironmentReady()
    .then(() => import("@monaco-editor/react"))
    .catch(() => {
      // 预热失败（如测试环境无 Vite worker）时允许下次再试，避免未处理 rejection。
      monacoEditorPreloadStarted = false;
      monacoEnvironmentPromise = null;
    });
}

/** 动态加载 `@monaco-editor/react`（先保证本地环境就绪）。 */
export async function loadMonacoEditorReact(): Promise<typeof import("@monaco-editor/react")> {
  await ensureMonacoEnvironmentReady();
  return import("@monaco-editor/react");
}

/** 测试用：重置预热状态。 */
export function resetMonacoEditorPreloadForTests(): void {
  monacoEditorPreloadStarted = false;
  monacoEnvironmentPromise = null;
}
