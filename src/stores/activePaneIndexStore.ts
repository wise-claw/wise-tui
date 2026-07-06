/**
 * 多屏下最近聚焦的 pane 索引（pane 0 = primary，extra pane = paneIdx + 1）。
 *
 * 为什么用模块级单例而非 React state：文件树是全局的（绑定 primary 仓库，不绑定某屏），
 * 文件树点击路由文件时需要「用户最近聚焦的 pane」作为目标——「我在哪屏操作就在哪屏打开」。
 * 该值只供路由读取最新值，不需要驱动 React 重渲染（pane 焦点高亮由各 pane 自身的 active
 * 判断处理），故用模块级变量避免 props 链穿透与不必要的重渲。
 *
 * 写入：每个 pane 容器 onMouseDownCapture → markPaneActive(paneIndex)（用 capture 阶段，
 * 避免被 bubble 阶段子元素 stopPropagation 拦截导致 pane 焦点不更新）。
 * 读取：`openRepositoryFileWithPreference`（文件树点击路径）路由时 getActivePaneIndex()，
 * 命中则路由到该 pane；为 null（未聚焦 / 单屏）时 fallback primary。
 * 重置：paneCount 变化时 `resetActivePaneIndex()`，避免切换屏数后残留旧 pane 索引导致
 * 文件路由到已不存在 / 非预期的 pane（默认回 primary）。
 */
let activePaneIndex: number | null = null;

export function getActivePaneIndex(): number | null {
  return activePaneIndex;
}

export function markPaneActive(paneIndex: number): void {
  activePaneIndex = paneIndex;
}

export function resetActivePaneIndex(): void {
  activePaneIndex = null;
}
