/** 仓库文件编辑器首开相关 chunk / 配置预热（幂等）。 */

import { loadRepositoryTypeScriptProfile } from "../services/monacoRepositoryTypeScriptConfig";
import { preloadMonacoEditor } from "./preloadMonacoEditor";

let fileEditorPanelPreloadStarted = false;
const tsProfilePreloadStarted = new Set<string>();

/**
 * 预热 Monaco + 文件编辑器 Panel chunk。
 * 可在文件树可见 / 悬停时调用；重复调用无副作用。
 */
export function preloadFileEditorSurface(): void {
  preloadMonacoEditor();
  if (fileEditorPanelPreloadStarted) return;
  fileEditorPanelPreloadStarted = true;
  void import("../components/RepositoryFileEditorPanel");
}

/**
 * 预读仓库 tsconfig/jsconfig 配置缓存，缩短首次打开 TS/JS 时的 env 准备。
 * 不依赖 Monaco 实例；失败静默忽略。
 */
export function preloadRepositoryTypeScriptProfile(repositoryPath: string): void {
  const root = repositoryPath.trim();
  if (!root || tsProfilePreloadStarted.has(root)) return;
  tsProfilePreloadStarted.add(root);
  void loadRepositoryTypeScriptProfile(root).catch(() => undefined);
}

/** 测试用：重置预热状态。 */
export function resetFileEditorSurfacePreloadForTests(): void {
  fileEditorPanelPreloadStarted = false;
  tsProfilePreloadStarted.clear();
}
