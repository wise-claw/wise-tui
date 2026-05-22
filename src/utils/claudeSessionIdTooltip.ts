import type { ClaudeSession } from "../types";

/** 侧栏/历史列表/会话标签 hover：展示 Claude Code 落盘会话 id。 */
export function buildClaudeSessionHoverTitle(
  session: Pick<ClaudeSession, "id" | "claudeSessionId">,
): string {
  const claudeId = session.claudeSessionId?.trim();
  if (claudeId) {
    return `Claude 会话 ID：${claudeId}`;
  }
  return `Claude 会话 ID：尚未绑定（Wise 标签：${session.id}）`;
}
