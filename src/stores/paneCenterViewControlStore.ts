/**
 * 中栏「消息/文件」视图（CenterView）的 per-pane 控制通道。
 *
 * 背景：`useCenterView`（claudeChatHelpers）的 effect 仅在「下方面板有无」布尔翻转时
 * 自动切视图；同为挂载态时 ReactNode identity 变化不会打断用户当前的「消息」视图。
 * 因此「编辑器已挂载、用户从消息视图再次打开/切换文件」时不会自动切回「文件」——
 * 这是「消息/文件 tab 同显时点文件树/git 打开文件不切到文件 tab」的根因。
 *
 * 三态语义：
 * - "messages"：消息列表占中栏（默认；无 editor 也无 terminal 时唯一选项）。
 * - "files"：editor 占中栏；`panelBelowMessages` 有节点时可选。
 * - "terminal"：内置终端占中栏；`panelBelowTerminal` 有节点时可选。
 *
 * editor 与 terminal 是两个独立 slot（`panelBelowMessages` / `panelBelowTerminal`），
 * DOM 中并存、由 `is-hidden` 互斥显示——避免「打开终端时把文件 tab 挤掉」的回归。
 *
 * 本 store 提供跨层命令通道：持有 `requestCenterView` 的 pane 组件（单屏
 * `AppWorkspaceLayout` / 多屏 `ClaudeMultiPaneGrid` 各 pane cell）mount 时注册
 * setter；`useRepositoryFileEditor.openRepositoryFile` 在打开编辑器内容时按 `paneIndex`
 * 请求切到「文件」视图；`openTerminalCenterPanel` 请求切到「终端」视图。用模块级
 * 单例（参考 `activePaneIndexStore`），绕开 `PaneEditorHost` 运行在
 * `CenterViewControlContext.Provider` 外、无法经 context 拿到 setter 的限制。
 *
 * 注册的必须是 `requestCenterView`（非顶栏 `setCenterView`）：后者会置位 userChosen
 * 闩；若 editor 尚未挂载，fallback 会把视图打回 messages 且再也无法自动跟随。
 *
 * 安全性：「切到 files 但编辑器未挂载」/「切到 terminal 但终端未挂载」均无害——
 * ClaudeChat 渲染守卫在对应 panel 为空时仍显示消息视图，不会空白。
 *
 * 单/多屏切换：单屏由 `AppWorkspaceLayout` 注册 pane 0（门控 paneCount<=1）；多屏由
 * `MultiPanePrimaryCell`（pane 0）/ `MultiPaneExtraPaneCell`（pane>=1）注册。多屏下
 * `AppWorkspaceLayout` 的 `useCenterView` 是「死 setter」（其 Provider 被 pane cell 内
 * Provider 遮蔽、Topbar 不渲染），故必须门控跳过，否则会抢占 pane 0。
 */
export type CenterView = "messages" | "files" | "terminal";

type CenterViewSetter = (view: CenterView) => void;

const setters = new Map<number, CenterViewSetter>();
/** 各 pane 最近一次已知的 centerView（request / sync），供终端快捷键判断「已在终端则收起」。 */
const currentViews = new Map<number, CenterView>();

function normalizePaneIndex(paneIndex: number): number {
  if (!Number.isFinite(paneIndex) || paneIndex < 0) return 0;
  return Math.floor(paneIndex);
}

/**
 * 注册某 pane 的 centerView setter。setter 为 null 时注销（pane 卸载或单/多屏切换）。
 * 后注册者覆盖同 paneIndex 的旧 setter；React passive effect 保证切换时 cleanup 先于
 * setup 执行，不会出现死 setter 残留。
 */
export function registerPaneCenterViewSetter(paneIndex: number, setter: CenterViewSetter | null): void {
  const index = normalizePaneIndex(paneIndex);
  if (setter) {
    setters.set(index, setter);
  } else {
    setters.delete(index);
    currentViews.delete(index);
  }
}

/** 同步 pane 当前 centerView（顶栏 Segmented / effect 回退时调用）。 */
export function syncPaneCenterView(paneIndex: number, view: CenterView): void {
  currentViews.set(normalizePaneIndex(paneIndex), view);
}

export function getPaneCenterView(paneIndex: number): CenterView | null {
  return currentViews.get(normalizePaneIndex(paneIndex)) ?? null;
}

/**
 * 请求某 pane 切到指定视图。目标 pane 未注册 setter 时 no-op（如 host 还在 mount 的
 * 时序窗口期）；此时文件加载完成后 `editorVisible` 翻转，`useCenterView` 的 effect
 * 会自动切到「文件」，故无需重试。
 */
export function requestPaneCenterView(paneIndex: number, view: CenterView): void {
  const index = normalizePaneIndex(paneIndex);
  currentViews.set(index, view);
  setters.get(index)?.(view);
}
