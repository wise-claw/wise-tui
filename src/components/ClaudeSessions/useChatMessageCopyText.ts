import { useMemo } from "react";
import type { ClaudeMessage, ClaudeSession } from "../../types";
import { resolveChatMessageCopyText } from "../../utils/claudeChatMessageDisplay";

export function useChatMessageCopyText(
  msg: ClaudeMessage,
  sessionsForDispatchLookup?: readonly ClaudeSession[],
): string {
  return useMemo(
    () => resolveChatMessageCopyText(msg, sessionsForDispatchLookup),
    [msg, sessionsForDispatchLookup],
  );
}
