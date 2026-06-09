import { lazy } from "react";
import { runWhenIdle } from "../utils/deferIdle";
import { prefetchModule } from "../utils/prefetchModule";

/** 模块求值时即开始拉取工作区壳 chunk，与 AppImpl 首帧渲染并行。 */
const appWorkspaceLayoutModule = import("./AppWorkspaceLayout");

/** 首屏：侧栏 + 顶栏（与工作区壳同屏出现）。 */
prefetchModule(() => import("./LeftSidebar"), "LeftSidebar");
prefetchModule(() => import("./ClaudeSessions/Topbar"), "ClaudeSessions/Topbar");

/** 空闲后再预拉会话区与聊天主体，避免与 AppImpl / 大型 vendor 争抢首包带宽。 */
runWhenIdle(
  () => {
    prefetchModule(() => import("./ClaudeSessions"), "ClaudeSessions");
    prefetchModule(() => import("./ClaudeSessions/ClaudeSessionChatWithDock"), "ClaudeSessionChatWithDock");
  },
  { timeoutMs: 4000 },
);

export const LazyAppWorkspaceLayout = lazy(() =>
  appWorkspaceLayoutModule.then((module) => ({ default: module.AppWorkspaceLayout })),
);

export type { AppWorkspaceLayoutProps } from "./AppWorkspaceLayout";
