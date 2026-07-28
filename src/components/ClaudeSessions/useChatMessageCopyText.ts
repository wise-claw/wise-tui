import { useMemo } from "react";
import type { ClaudeMessage } from "../../types";
import {
  resolveChatMessageCopyText,
  type SessionDispatchLookup,
} from "../../utils/claudeChatMessageDisplay";

export function useChatMessageCopyText(
  msg: ClaudeMessage,
  sessionsForDispatchLookup?: SessionDispatchLookup,
): string {
  return useMemo(
    () => resolveChatMessageCopyText(msg, sessionsForDispatchLookup),
    [msg, sessionsForDispatchLookup],
  );
}
