import { prefetchModule } from "../../utils/prefetchModule";

/** 预加载 Claude Code 顶栏弹层及其默认 MCP 子面板，避免首次点击卡在「加载中…」。 */
export function prefetchClaudeCodeToolsSurface(): void {
  prefetchModule(() => import("../ClaudeCodeToolsPanel"), "ClaudeCodeToolsPanel");
  prefetchModule(() => import("../ClaudeMcpConfigPanel"), "ClaudeMcpConfigPanel");
}
