import type { ClaudeSession } from "../types";
import { extractLatestAssistantPlainText } from "./claudeSessionState";
import { stripAssistantStreamNoiseForDingTalkExport } from "../utils/dingTalkOutboundAssistantText";

/**
 * 钉钉自动化回发正文：**仅**依据会话里**最后一条 assistant 气泡**的合并可见正文（不按 tool 分段截断）。
 * - 全文经 `stripAssistantStreamNoiseForDingTalkExport` 去噪后直接返回；
 * - 仅当会话尚无助手气泡时，才退回 `assistantPreviewRaw`（流式缓冲兜底）。
 */
export function resolveDingTalkAutomationAssistantBody(
  session: ClaudeSession | undefined,
  assistantPreviewRaw: string,
): string {
  const plain = extractLatestAssistantPlainText(session).trim();
  if (plain.length > 0) {
    return stripAssistantStreamNoiseForDingTalkExport(plain).trim();
  }

  const raw = assistantPreviewRaw.trim();
  if (!raw) {
    return "";
  }
  return stripAssistantStreamNoiseForDingTalkExport(raw).trim();
}
