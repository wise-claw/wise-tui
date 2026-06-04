import { lazy } from "react";
import { runWhenIdle } from "../utils/deferIdle";

/** 模块求值时即开始拉取工作区壳 chunk，与 AppImpl 首帧渲染并行。 */
const appWorkspaceLayoutModule = import("./AppWorkspaceLayout");

/** 首屏：侧栏 + 顶栏（与工作区壳同屏出现）。 */
void import("./LeftSidebar");
void import("./ClaudeSessions/Topbar");

/** 空闲后再预拉会话区与聊天主体，避免与 AppImpl / 大型 vendor 争抢首包带宽。 */
runWhenIdle(
  () => {
    void import("./ClaudeSessions");
    void import("./ClaudeSessions/ClaudeSessionChatWithDock");
  },
  { timeoutMs: 4000 },
);

export const LazyAppWorkspaceLayout = lazy(() =>
  appWorkspaceLayoutModule.then((module) => ({ default: module.AppWorkspaceLayout })),
);

export type { AppWorkspaceLayoutProps } from "./AppWorkspaceLayout";
