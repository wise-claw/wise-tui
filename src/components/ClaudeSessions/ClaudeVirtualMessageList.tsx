import { forwardRef, type RefObject } from "react";
import type { ClaudeSession, SessionConversationTaskItem } from "../../types";
import type { DispatchRecordMeta } from "../../utils/claudeChatMessageDisplay";
import { useChatMessageListRows } from "../../hooks/useChatMessageListRows";
import {
  ChatMessageListVirtualBody,
  type ChatMessageListNavigationHandle,
} from "./ChatMessageListVirtualBody";

interface Props {
  session: ClaudeSession;
  showListEndThinkingHint: boolean;
  scrollContainerRef: RefObject<HTMLDivElement | null>;
  resolveExecutionEnvironmentDispatchTask?: (meta: DispatchRecordMeta) => SessionConversationTaskItem | null;
  onOpenTaskDetail?: (taskId: string) => void;
  onOpenHistorySessionInInspector?: (sessionId: string) => void;
  onOpenSessionConversationTaskDetail?: (task: SessionConversationTaskItem) => void;
  sessionsForDispatchLookup?: readonly ClaudeSession[];
  /** 主会话气泡 vs 监控/只读列（含时间戳头） */
  listVariant?: "chat" | "monitor";
  onNavigate?: () => void;
  /** 主窗格 vs 多屏伴生窗格 */
  messageListProfile?: "primary" | "companion";
  companionMessageListWindow?: { initialVisible: number; loadStep: number };
}

export const ClaudeVirtualMessageList = forwardRef<ChatMessageListNavigationHandle, Props>(
  function ClaudeVirtualMessageList(
    {
      session,
      showListEndThinkingHint: _showListEndThinkingHint,
      scrollContainerRef,
      resolveExecutionEnvironmentDispatchTask,
      onOpenTaskDetail,
      onOpenHistorySessionInInspector,
      onOpenSessionConversationTaskDetail,
      sessionsForDispatchLookup,
      listVariant = "chat",
      onNavigate,
      messageListProfile = "primary",
      companionMessageListWindow,
    },
    ref,
  ) {
    const rows = useChatMessageListRows(session);

    if (rows.length === 0) {
      return null;
    }

    return (
      <ChatMessageListVirtualBody
        ref={ref}
        rows={rows}
        sessionId={session.id}
        scrollContainerRef={scrollContainerRef}
        listResetKey={session.id}
        listVariant={listVariant}
        resolveExecutionEnvironmentDispatchTask={resolveExecutionEnvironmentDispatchTask}
        onOpenTaskDetail={onOpenTaskDetail}
        onOpenHistorySessionInInspector={onOpenHistorySessionInInspector}
        onOpenSessionConversationTaskDetail={onOpenSessionConversationTaskDetail}
        sessionsForDispatchLookup={sessionsForDispatchLookup}
        onNavigate={onNavigate}
        messageListProfile={messageListProfile}
        companionMessageListWindow={companionMessageListWindow}
      />
    );
  },
);

export type { ChatMessageListNavigationHandle };
