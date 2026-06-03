import { lazy } from "react";

/** 模块求值时即开始拉取工作区壳 chunk，与 AppImpl 首帧渲染并行。 */
const appWorkspaceLayoutModule = import("./AppWorkspaceLayout");

/** 与壳 chunk 并行预拉取首屏侧栏与会话区（不阻塞 AppImpl 主包解析）。 */
void import("./LeftSidebar");
const claudeSessionsEntry = import("./ClaudeSessions");
void claudeSessionsEntry;
/** 会话壳就绪后常用聊天主体，提前拉取缩短二次等待。 */
void import("./ClaudeSessions/ClaudeSessionChatWithDock");

export const LazyAppWorkspaceLayout = lazy(() =>
  appWorkspaceLayoutModule.then((module) => ({ default: module.AppWorkspaceLayout })),
);

export type { AppWorkspaceLayoutProps } from "./AppWorkspaceLayout";
