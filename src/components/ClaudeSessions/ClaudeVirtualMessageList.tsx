import { forwardRef, useMemo, type RefObject } from "react";
import type { ClaudeSession } from "../../types";
import {
  buildChatMessageListRows,
} from "../../utils/claudeChatMessageListRows";
import {
  ChatMessageListVirtualBody,
  type ChatMessageListNavigationHandle,
} from "./ChatMessageListVirtualBody";

interface Props {
  session: ClaudeSession;
  showListEndThinkingHint: boolean;
  scrollContainerRef: RefObject<HTMLDivElement | null>;
  onOpenTaskDetail?: (taskId: string) => void;
  /** 主会话气泡 vs 监控/只读列（含时间戳头） */
  listVariant?: "chat" | "monitor";
  onNavigate?: () => void;
  /** 主窗格 vs 多屏伴生窗格 */
  messageListProfile?: "primary" | "companion";
}

export const ClaudeVirtualMessageList = forwardRef<ChatMessageListNavigationHandle, Props>(
  function ClaudeVirtualMessageList(
    {
      session,
      showListEndThinkingHint,
      scrollContainerRef,
      onOpenTaskDetail,
      listVariant = "chat",
      onNavigate,
      messageListProfile = "primary",
    },
    ref,
  ) {
    const rows = useMemo(
      () =>
        buildChatMessageListRows(session.messages, {
          sessionStatus: session.status,
          showListEndThinkingHint,
        }),
      [session.messages, session.status, showListEndThinkingHint],
    );

    if (rows.length === 0) {
      return null;
    }

    return (
      <ChatMessageListVirtualBody
        ref={ref}
        rows={rows}
        scrollContainerRef={scrollContainerRef}
        listResetKey={session.id}
        listVariant={listVariant}
        onOpenTaskDetail={onOpenTaskDetail}
        onNavigate={onNavigate}
        messageListProfile={messageListProfile}
      />
    );
  },
);

export type { ChatMessageListNavigationHandle };
