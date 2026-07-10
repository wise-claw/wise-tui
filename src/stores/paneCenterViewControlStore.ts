/**
 * 中栏「消息/文件」视图（CenterView）的 per-pane 控制通道。
 *
 * 背景：`useCenterView`（claudeChatHelpers）的 effect 仅在 `panelBelowMessages`
 * identity 变化时切换视图；而 `panelBelowMessages` 是稳定的 `PaneEditorPanelBridge`
 * 元素（只随 editorVisible / dark / paneIndex 变化，见 AppWorkspaceLayout 的 bridge
 * effect）。因此「编辑器已挂载、用户从消息视图再次打开/切换文件」时 identity 不变，
 * effect 不触发，视图不会切回「文件」——这是「消息/文件 tab 同显时点文件树/git 打开
 * 文件不切到文件 tab」的根因。
 *
 * 本 store 提供跨层命令通道：持有 `setCenterView` 的 pane 组件（单屏
 * `AppWorkspaceLayout` / 多屏 `ClaudeMultiPaneGrid` 各 pane cell）mount 时注册
 * setter；`useRepositoryFileEditor.openRepositoryFile` 在打开编辑器内容时按 `paneIndex`
 * 请求切到「文件」视图。用模块级单例（参考 `activePaneIndexStore`），绕开
 * `PaneEditorHost` 运行在 `CenterViewControlContext.Provider` 外、无法经 context 拿到
 * setter 的限制。
 *
 * 安全性：「切到 files 但编辑器未挂载」无害——ClaudeChat 渲染守卫在
 * `panelBelowMessages` 为空时仍显示消息视图，不会空白。
 *
 * 单/多屏切换：单屏由 `AppWorkspaceLayout` 注册 pane 0（门控 paneCount<=1）；多屏由
 * `MultiPanePrimaryCell`（pane 0）/ `MultiPaneExtraPaneCell`（pane>=1）注册。多屏下
 * `AppWorkspaceLayout` 的 `useCenterView` 是「死 setter」（其 Provider 被 pane cell 内
 * Provider 遮蔽、Topbar 不渲染），故必须门控跳过，否则会抢占 pane 0。
 */
export type CenterView = "messages" | "files";

type CenterViewSetter = (view: CenterView) => void;

const setters = new Map<number, CenterViewSetter>();

/**
 * 注册某 pane 的 centerView setter。setter 为 null 时注销（pane 卸载或单/多屏切换）。
 * 后注册者覆盖同 paneIndex 的旧 setter；React passive effect 保证切换时 cleanup 先于
 * setup 执行，不会出现死 setter 残留。
 */
export function registerPaneCenterViewSetter(paneIndex: number, setter: CenterViewSetter | null): void {
  if (setter) {
    setters.set(paneIndex, setter);
  } else {
    setters.delete(paneIndex);
  }
}

/**
 * 请求某 pane 切到指定视图。目标 pane 未注册 setter 时 no-op（如 host 还在 mount 的
 * 时序窗口期）；此时文件加载完成后 `editorVisible` 翻转，`useCenterView` 的 effect
 * 会自动切到「文件」，故无需重试。
 */
export function requestPaneCenterView(paneIndex: number, view: CenterView): void {
  setters.get(paneIndex)?.(view);
}
