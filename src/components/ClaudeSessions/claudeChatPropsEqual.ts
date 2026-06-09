import type { ClaudeSession } from "../../types";
import { sessionChatChromeStructureKey } from "../../utils/sessionConversationTasks";

export function claudeChatSessionPropsEqual(
  prevSession: ClaudeSession,
  nextSession: ClaudeSession,
): boolean {
  return sessionChatChromeStructureKey(prevSession) === sessionChatChromeStructureKey(nextSession);
}

export function claudeChatPropsEqual<T extends { session: ClaudeSession }>(
  prev: T,
  next: T,
): boolean {
  if (!claudeChatSessionPropsEqual(prev.session, next.session)) return false;
  for (const key of Object.keys(prev) as (keyof T)[]) {
    if (key === "session") continue;
    if (!Object.is(prev[key], next[key])) return false;
  }
  return true;
}
