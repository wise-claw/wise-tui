import type { ClaudeSession, NativeCliEngine } from "../types";

/** dsh ACP session ids are opaque; keep validation permissive like Qoder's. */
const DEEPSEEK_RESUME_SESSION_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,191}$/;

export function isLikelyDeepseekResumeId(id: string | null | undefined): boolean {
  const trimmed = id?.trim() ?? "";
  if (!trimmed) return false;
  return DEEPSEEK_RESUME_SESSION_RE.test(trimmed);
}

export function sessionHasPriorDeepseekTurn(
  messages: readonly ClaudeSession["messages"][number][],
): boolean {
  return messages.some(
    (message) =>
      message.role === "system" && message.content.includes("DeepSeek Harness 执行"),
  );
}

export function resolveDeepseekResumeSessionId(
  session: {
    claudeSessionId?: string | null;
    messages: ClaudeSession["messages"];
    /** 外部 CLI 原生会话索引来源：即使尚未 hydrate 也允许 `session/resume`。 */
    nativeCliSource?: NativeCliEngine | null;
  },
  tabSessionId: string,
  sessionIdMap?: ReadonlyMap<string, string>,
): string | null {
  if (!sessionHasPriorDeepseekTurn(session.messages) && session.nativeCliSource !== "deepseek") {
    return null;
  }
  const candidates = [session.claudeSessionId, sessionIdMap?.get(tabSessionId)];
  for (const raw of candidates) {
    if (isLikelyDeepseekResumeId(raw)) return raw!.trim();
  }
  return null;
}
