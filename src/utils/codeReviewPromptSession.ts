import type { ClaudeSession } from "../types";

/**
 * 代码审查 harness prompt 的识别签名，由 buildCodeReviewPrompt 拼进首行。
 * 保持足够短，使其能存活于磁盘索引 preview 的 80 字符截断。
 */
export const CODE_REVIEW_PROMPT_SIGNATURE = "你是 Wise 内置的代码审查引擎";

/** 工具会话在列表里的人类可读标题，替代原始 harness prompt。 */
export const CODE_REVIEW_SESSION_LABEL = "代码审查";

function isCodeReviewPromptText(raw: string | null | undefined): boolean {
  return (raw ?? "").trimStart().startsWith(CODE_REVIEW_PROMPT_SIGNATURE);
}

/**
 * 代码审查会话属于工具会话：结论由 CodeReviewPanel 呈现，
 * 原始 prompt 不应占据侧栏历史列表。
 * 注意「修复此发现」会话是用户真实意图，不在此列。
 */
export function isCodeReviewPromptHistorySession(
  session: Pick<ClaudeSession, "messages" | "diskPreview">,
): boolean {
  const firstUser = session.messages.find((message) => message.role === "user");
  if (isCodeReviewPromptText(firstUser?.content)) return true;
  return isCodeReviewPromptText(session.diskPreview);
}
