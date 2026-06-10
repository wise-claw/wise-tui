import { prefetchModule } from "../../utils/prefetchModule";

const claudeChatSurfaceChunk = import("./ClaudeSessionChatWithDock");

/** 新建会话相关懒加载 chunk：悬停/点击前预热，缩短首屏等待。 */
export function prefetchNewSessionSurface(): void {
  prefetchModule(() => claudeChatSurfaceChunk, "ClaudeSessionChatWithDock");
  prefetchModule(() => import("./ClaudeChatComposerTray"), "ClaudeChatComposerTray");
  prefetchModule(() => import("../ClaudeChatInput/composer-region"), "composer-region");
}
