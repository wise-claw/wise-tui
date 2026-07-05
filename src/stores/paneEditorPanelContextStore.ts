/**
 * per-pane 文件编辑器面板 context 外部 store。
 *
 * 为什么不用 React state/context 直连：`AppWorkspaceLayout` 的 `panelContextValue`（含
 * fileEditorTabs / fileEditorActivePath / editorDirty / contentSync 派生）在打开一个文件
 * 过程中会变化十几次。若经 `centerAuxPanelsNodeByPaneVersion` 上抛，每次变化都会 bump →
 * 整个 `AppWorkspaceLayout` + `ConnectedClaudeSessions` + `MemoClaudeSessions` 重渲 →
 * 「第二屏开/关文件超级慢」。
 *
 * 解耦：`PaneEditorHost` 每次渲染把最新 `panelContextValue` 写入本 store；`PaneEditorPanelBridge`
 * 用 `useSyncExternalStore` 订阅本 store，变化时只局部重渲 bridge + panel，不触发 layout 重渲。
 * layout 的 `centerAuxPanelsNodeByPaneVersion` 只在 `editorVisible`（null↔bridge）变化时 bump。
 *
 * 值按引用比较：`panelContextValue` 是 `useMemo` 结果，依赖未变时引用稳定，store 的 `set`
 * 做 `prev === value` 短路，不会误触发订阅者。
 *
 * 为避免与 `AppWorkspaceLayout` 的类型循环依赖，store 持 `unknown`，由 bridge 侧断言回
 * `RepositoryFileEditorPanelContextValue | null`。
 */
type Listener = () => void;

const contextByPane = new Map<number, unknown>();
const listenersByPane = new Map<number, Set<Listener>>();

export function setPaneEditorPanelContext(paneIndex: number, value: unknown): void {
  const prev = contextByPane.get(paneIndex);
  if (prev === value) return;
  contextByPane.set(paneIndex, value);
  const listeners = listenersByPane.get(paneIndex);
  if (!listeners) return;
  for (const listener of listeners) {
    try {
      listener();
    } catch {
      /* 忽略订阅者异常，避免一个监听挂掉影响其余 */
    }
  }
}

/** PaneEditorHost 卸载时清理本 pane 的 context 值（订阅者可能仍挂载一帧，不删 listener 集合）。 */
export function clearPaneEditorPanelContext(paneIndex: number): void {
  if (!contextByPane.has(paneIndex)) return;
  contextByPane.delete(paneIndex);
  const listeners = listenersByPane.get(paneIndex);
  if (listeners) {
    for (const listener of listeners) {
      try {
        listener();
      } catch {
        /* ignore */
      }
    }
  }
}

export function subscribePaneEditorPanelContext(paneIndex: number, listener: Listener): () => void {
  let set = listenersByPane.get(paneIndex);
  if (!set) {
    set = new Set();
    listenersByPane.set(paneIndex, set);
  }
  set.add(listener);
  return () => {
    set?.delete(listener);
    if (set && set.size === 0) {
      listenersByPane.delete(paneIndex);
    }
  };
}

export function getPaneEditorPanelContextSnapshot(paneIndex: number): unknown {
  return contextByPane.get(paneIndex) ?? null;
}

/** @internal 测试辅助：清空 store。 */
export function resetPaneEditorPanelContextStoreForTests(): void {
  contextByPane.clear();
  listenersByPane.clear();
}
