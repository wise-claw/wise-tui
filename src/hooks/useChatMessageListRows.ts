import { useMemo, useRef } from "react";
import type { ClaudeMessage, ClaudeSession } from "../types";
import { IN_MEMORY_RECENT_SESSION_KEEP } from "../constants/claudeMessageListWindow";
import {
  buildChatMessageListRowsWithFolded,
  shouldShowListEndThinkingHint,
  tryPatchChatMessageListRowsTail,
  type ChatMessageListRow,
} from "../utils/claudeChatMessageListRows";

type RowsCache = {
  messages: ClaudeSession["messages"];
  status: ClaudeSession["status"];
  showListEndThinkingHint: boolean;
  rows: ChatMessageListRow[];
  /** 上次 fold 结果，供 tail-patch 增量复用，避免每 tick 全量 fold 历史工具消息。 */
  folded: ClaudeMessage[];
};

/** 构建消息列表行；流式时尽量 patch 尾部，减少主线程与 DOM 重渲染。 */
export function useChatMessageListRows(session: ClaudeSession): ChatMessageListRow[] {
  const cacheRef = useRef(new Map<string, RowsCache>());

  return useMemo(() => {
    const showListEndThinkingHint = shouldShowListEndThinkingHint(session.messages, session.status);
    const options = {
      sessionStatus: session.status,
      showListEndThinkingHint,
    };
    const cached = cacheRef.current.get(session.id);
    const remember = (entry: RowsCache) => {
      cacheRef.current.delete(session.id);
      cacheRef.current.set(session.id, entry);
      while (cacheRef.current.size > IN_MEMORY_RECENT_SESSION_KEEP) {
        const oldest = cacheRef.current.keys().next().value;
        if (oldest === undefined) break;
        cacheRef.current.delete(oldest);
      }
    };
    // 状态/思考提示变化时不能走 patch 快路径：fast path 直接复用 prevRows，
    // 会把 running→completed 之后该消失的 thinking-hint 与最后一条消息的
    // streamingThisBubble 残留下来，造成「正在思考」会话执行完成后仍然显示。
    if (
      cached &&
      cached.status === session.status &&
      cached.showListEndThinkingHint === showListEndThinkingHint
    ) {
      if (cached.messages === session.messages) {
        remember(cached);
        return cached.rows;
      }
      const patched = tryPatchChatMessageListRowsTail(
        cached.messages,
        session.messages,
        cached.rows,
        options,
        cached.folded,
      );
      if (patched) {
        remember({
          messages: session.messages,
          status: session.status,
          showListEndThinkingHint,
          rows: patched.rows,
          folded: patched.folded,
        });
        return patched.rows;
      }
    }

    const { rows, folded } = buildChatMessageListRowsWithFolded(session.messages, options);
    remember({
      messages: session.messages,
      status: session.status,
      showListEndThinkingHint,
      rows,
      folded,
    });
    return rows;
  }, [session.id, session.messages, session.status]);
}
