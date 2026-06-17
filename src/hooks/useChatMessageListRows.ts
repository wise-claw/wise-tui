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
    // 状态/思考提示变化时不能走 patch 快路径：fast path 直接复用 prevRows，
    // 会把 running→completed 之后该消失的 thinking-hint 与最后一条消息的
    // streamingThisBubble 残留下来，造成「正在思考」会话执行完成后仍然显示。
    if (
      cached &&
      cached.status === session.status &&
      cached.showListEndThinkingHint === showListEndThinkingHint
    ) {
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
