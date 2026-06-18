import type { AuthorPane } from "../types/viewMode";

export type ClaudeCodeToolsTabKey = "mcp" | "skill" | "memory" | "hooks" | "subagents" | "plugins";

/** Claude Code 顶栏弹层 Tab → 工作台配置侧栏页 */
export function claudeCodeToolsTabToAuthorPane(tab: string): AuthorPane | null {
  switch (tab as ClaudeCodeToolsTabKey) {
    case "mcp":
      return "mcp";
    case "skill":
      return "skills";
    case "hooks":
      return "hooks";
    case "subagents":
      // 工作台暂无独立「子代理」页；与 Claude Code 扩展能力最接近的入口为「我的扩展」
      return "my-extensions";
    case "plugins":
      return "claude-plugins";
    default:
      return null;
  }
}
