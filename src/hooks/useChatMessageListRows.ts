import { useMemo, useRef } from "react";
import type { ClaudeSession } from "../types";
import {
  buildChatMessageListRows,
  shouldShowListEndThinkingHint,
  tryPatchChatMessageListRowsTail,
  type ChatMessageListRow,
} from "../utils/claudeChatMessageListRows";

type RowsCache = {
  messages: ClaudeSession["messages"];
  status: ClaudeSession["status"];
  showListEndThinkingHint: boolean;
  rows: ChatMessageListRow[];
};

/** 构建消息列表行；流式时尽量 patch 尾部，减少主线程与 DOM 重渲染。 */
export function useChatMessageListRows(session: ClaudeSession): ChatMessageListRow[] {
  const cacheRef = useRef<RowsCache | null>(null);

  return useMemo(() => {
    const showListEndThinkingHint = shouldShowListEndThinkingHint(session.messages, session.status);
    const options = {
      sessionStatus: session.status,
      showListEndThinkingHint,
    };
    const cached = cacheRef.current;
    if (cached) {
      const patched = tryPatchChatMessageListRowsTail(
        cached.messages,
        session.messages,
        cached.rows,
        options,
      );
      if (patched) {
        cacheRef.current = {
          messages: session.messages,
          status: session.status,
          showListEndThinkingHint,
          rows: patched,
        };
        return patched;
      }
    }

    const rows = buildChatMessageListRows(session.messages, options);
    cacheRef.current = {
      messages: session.messages,
      status: session.status,
      showListEndThinkingHint,
      rows,
    };
    return rows;
  }, [session.messages, session.status]);
}
