import type { ClaudeSession } from "../../types";
import { sessionChatChromeStructureKey } from "../../utils/sessionConversationTasks";
import { arePropsEqualSkipping } from "../../utils/reactPropsEqual";

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
  return arePropsEqualSkipping(prev, next, {
    skipKeys: ["session"],
    skipFunctions: true,
  });
}
