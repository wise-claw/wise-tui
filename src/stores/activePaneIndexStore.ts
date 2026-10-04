/**
 * 多屏下最近聚焦的 pane 索引（pane 0 = primary，extra pane = paneIdx + 1）。
 *
 * 为什么用模块级单例而非 React state：文件树是全局的（绑定 primary 仓库，不绑定某屏），
 * 文件树点击路由文件时需要「用户最近聚焦的 pane」作为目标——「我在哪屏操作就在哪屏打开」。
 * 路由直接读取最新值；Git 文件选中态等局部 UI 可订阅焦点变化，
 * 避免为了同步活动屏而让整个 layout 重渲。
 *
 * 写入：每个 pane 容器 onMouseDownCapture → markPaneActive(paneIndex)（用 capture 阶段，
 * 避免被 bubble 阶段子元素 stopPropagation 拦截导致 pane 焦点不更新）。
 * 读取：`openRepositoryFileWithPreference`（文件树点击路径）路由时 getActivePaneIndex()，
 * 命中则路由到该 pane；为 null（未聚焦 / 单屏）时 fallback primary。
 * 重置：paneCount 变化时 `resetActivePaneIndex()`，避免切换屏数后残留旧 pane 索引导致
 * 文件路由到已不存在 / 非预期的 pane（默认回 primary）。
 */
let activePaneIndex: number | null = null;
const listeners = new Set<() => void>();

/** 仅在焦点屏变化时通知需要跟随活动屏的局部 UI。 */
export function subscribeActivePaneIndex(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function getActivePaneIndex(): number | null {
  return activePaneIndex;
}

export function markPaneActive(paneIndex: number): void {
  if (activePaneIndex === paneIndex) return;
  activePaneIndex = paneIndex;
  for (const listener of listeners) listener();
}

export function resetActivePaneIndex(): void {
  if (activePaneIndex === null) return;
  activePaneIndex = null;
  for (const listener of listeners) listener();
}
