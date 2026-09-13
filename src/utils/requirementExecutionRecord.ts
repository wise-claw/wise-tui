import type { ClaudeSession } from "../types";
import type { RequirementExecutionRecord } from "../types/requirementExecutionRecord";

/** 以本轮用户消息建立稳定键，防止重复完成通知写入多条历史。 */
export function buildRequirementExecutionRecord(
  session: ClaudeSession,
  outcome: "processed" | "incomplete" | "failed" | "cancelled",
  summary: string,
  finishedAt: number,
): RequirementExecutionRecord | null {
  if (!session.requirementId) return null;
  let startIndex = -1;
  for (let i = session.messages.length - 1; i >= 0; i--) {
    const message = session.messages[i]!;
    if (message.role === "user" && !(message.parts.length > 0 && message.parts.every((part) => part.type === "tool_use"))) {
      startIndex = i;
      break;
    }
  }
  // 没有本轮输入时无法可靠识别轮次，不能将其它轮的消息伪装成本轮结果。
  if (startIndex < 0) return null;
  const user = session.messages[startIndex]!;
  const files = new Set<string>();
  for (const message of session.messages.slice(startIndex + 1)) {
    if (message.role !== "assistant") continue;
    for (const part of message.parts) {
      if (part.type !== "tool_use") continue;
      for (const path of [part.input.file_path, part.input.path, ...(part.locations ?? []).map((location) => location.path)]) {
        if (typeof path === "string" && path.trim() && files.size < 100) files.add(path.trim().slice(0, 1024));
      }
    }
  }
  return {
    id: `${session.id}:${user.id}:${user.timestamp}`,
    requirementId: session.requirementId,
    sessionId: session.id,
    kind: "execution", outcome,
    startedAt: Number.isFinite(user.timestamp) && user.timestamp > 0 && user.timestamp <= finishedAt ? user.timestamp : null,
    finishedAt, engine: session.executionEngine ?? "claude",
    summary: summary.slice(0, 4000), files: [...files],
  };
}
