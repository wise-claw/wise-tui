import { Suspense, lazy } from "react";

const LazyWorkspaceMemoPanel = lazy(() =>
  import("./WorkspaceMemoPanel").then((module) => ({ default: module.WorkspaceMemoPanel })),
);
const LazyWorkspaceQuickActionsCenterPanel = lazy(() =>
  import("./WorkspaceQuickActionsCenterPanel").then((module) => ({
    default: module.WorkspaceQuickActionsCenterPanel,
  })),
);

/**
 * 稳定节点：写入 `panelBelowMessages` 时 identity 不随 layout 重渲变化（下游按引用比较）。
 * 面板本体（含 react-markdown 等）按需加载，不进入工作区首屏 chunk。
 */
export const WORKSPACE_MEMO_PANEL_NODE = (
  <Suspense fallback={null}>
    <LazyWorkspaceMemoPanel />
  </Suspense>
);

export const WORKSPACE_QUICK_ACTIONS_PANEL_NODE = (
  <Suspense fallback={null}>
    <LazyWorkspaceQuickActionsCenterPanel />
  </Suspense>
);
