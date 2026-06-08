import {
  forwardRef,
  useCallback,
  useImperativeHandle,
  type ReactNode,
  type RefObject,
} from "react";
import {
  useChatMessageListPendingScroll,
  useChatMessageListWindow,
} from "../../hooks/useChatMessageListWindow";
import type { ClaudeSession, SessionConversationTaskItem } from "../../types";
import type { DispatchRecordMeta } from "../../utils/claudeChatMessageDisplay";
import type { ChatMessageListRow } from "../../utils/claudeChatMessageListRows";
import { hasRenderableChatMessageBody } from "../../utils/claudeChatMessageDisplay";
import { findChatMessageRowIndexByMessageId } from "../../utils/chatMessageListWindow";
import { ChatMessageListRowContent } from "./ChatMessageListRowContent";
import { chatMessageListRowClassName } from "./chatMessageListRowStyles";

export interface ChatMessageListNavigationHandle {
  scrollToMessageId: (messageId: string | number) => boolean;
  scrollToRowIndex: (
    index: number,
    opts?: { align?: "start" | "center" | "end" | "auto"; behavior?: ScrollBehavior },
  ) => boolean;
}

interface Props {
  rows: ChatMessageListRow[];
  sessionId?: string;
  scrollContainerRef: RefObject<HTMLDivElement | null>;
  /** 切换会话时重置尾部窗口 */
  listResetKey?: string;
  listVariant?: "chat" | "monitor";
  resolveExecutionEnvironmentDispatchTask?: (meta: DispatchRecordMeta) => SessionConversationTaskItem | null;
  onOpenTaskDetail?: (taskId: string) => void;
  onOpenHistorySessionInInspector?: (sessionId: string) => void;
  onOpenSessionConversationTaskDetail?: (task: SessionConversationTaskItem) => void;
  sessionsForDispatchLookup?: readonly ClaudeSession[];
  /** 自定义行渲染；提供时覆盖 listVariant 默认内容 */
  renderRow?: (row: ChatMessageListRow, index: number) => ReactNode;
  onNavigate?: () => void;
  messageListProfile?: "primary" | "companion";
  companionMessageListWindow?: { initialVisible: number; loadStep: number };
}

function scrollElementIntoScrollContainer(
  sc: HTMLDivElement,
  target: HTMLElement,
  behavior: ScrollBehavior = "smooth",
): void {
  const scRect = sc.getBoundingClientRect();
  const targetRect = target.getBoundingClientRect();
  const nextTop =
    sc.scrollTop +
    targetRect.top -
    scRect.top -
    Math.max(0, (sc.clientHeight - targetRect.height) / 2);
  const maxTop = Math.max(0, sc.scrollHeight - sc.clientHeight);
  sc.scrollTo({ top: Math.max(0, Math.min(maxTop, nextTop)), behavior });
}

export const ChatMessageListVirtualBody = forwardRef<ChatMessageListNavigationHandle, Props>(
  function ChatMessageListVirtualBody(
    {
      rows,
      sessionId,
      scrollContainerRef,
      listResetKey,
      listVariant = "chat",
      resolveExecutionEnvironmentDispatchTask,
      onOpenTaskDetail,
      onOpenHistorySessionInInspector,
      onOpenSessionConversationTaskDetail,
      sessionsForDispatchLookup,
      renderRow,
      onNavigate,
      messageListProfile = "primary",
      companionMessageListWindow,
    },
    ref,
  ) {
    const {
      visibleRows,
      hiddenRowCount,
      visibleStartIndex,
      windowActive,
      loadMoreOlder,
      ensureMessageVisible,
      queueScrollToMessageId,
      pendingScrollMessageIdRef,
      scrollGeneration,
    } = useChatMessageListWindow({
      rows,
      scrollContainerRef,
      listResetKey,
      profile: messageListProfile,
      companionMessageListWindow,
    });

    const scrollFn = useCallback(
      (sc: HTMLDivElement, target: HTMLElement, behavior?: ScrollBehavior) => {
        scrollElementIntoScrollContainer(sc, target, behavior);
      },
      [],
    );

    useChatMessageListPendingScroll(
      scrollContainerRef,
      pendingScrollMessageIdRef,
      scrollGeneration,
      onNavigate,
      scrollFn,
    );

    useImperativeHandle(
      ref,
      () => ({
        scrollToMessageId(messageId) {
          const sc = scrollContainerRef.current;
          if (!sc) return false;
          const rowIndex = findChatMessageRowIndexByMessageId(rows, messageId);
          if (rowIndex < 0) return false;

          const expanded = ensureMessageVisible(messageId);
          if (expanded) {
            queueScrollToMessageId(messageId);
            return true;
          }

          const target = sc.querySelector(
            `[data-message-id="${CSS.escape(String(messageId))}"]`,
          );
          if (!(target instanceof HTMLElement)) return false;
          onNavigate?.();
          scrollElementIntoScrollContainer(sc, target, "smooth");
          return true;
        },
        scrollToRowIndex(index, opts) {
          if (index < 0 || index >= rows.length) return false;
          const row = rows[index];
          if (!row || row.kind !== "message") return false;
          const sc = scrollContainerRef.current;
          if (!sc) return false;

          const expanded = ensureMessageVisible(row.msg.id);
          if (expanded) {
            queueScrollToMessageId(row.msg.id);
            return true;
          }

          const target = sc.querySelector(`[data-message-id="${CSS.escape(String(row.msg.id))}"]`);
          if (!(target instanceof HTMLElement)) return false;
          onNavigate?.();
          scrollElementIntoScrollContainer(sc, target, opts?.behavior ?? "smooth");
          return true;
        },
      }),
      [
        ensureMessageVisible,
        onNavigate,
        queueScrollToMessageId,
        rows,
        scrollContainerRef,
      ],
    );

    return (
      <>
        {windowActive && hiddenRowCount > 0 ? (
          <div className="app-claude-messages-load-more">
            <button type="button" className="app-claude-messages-load-more__btn" onClick={loadMoreOlder}>
              加载更早消息（还有 {hiddenRowCount} 条）
            </button>
          </div>
        ) : null}
        {visibleRows.map((row, offset) => {
          const index = visibleStartIndex + offset;
          if (row.kind === "message" && !hasRenderableChatMessageBody(row.msg)) {
            return null;
          }
          return (
            <div key={row.key} className={chatMessageListRowClassName(row, index)}>
              {renderRow ? (
                renderRow(row, index)
              ) : (
                <ChatMessageListRowContent
                  row={row}
                  sessionId={sessionId}
                  listVariant={listVariant}
                  resolveExecutionEnvironmentDispatchTask={resolveExecutionEnvironmentDispatchTask}
                  onOpenTaskDetail={onOpenTaskDetail}
                  onOpenHistorySessionInInspector={onOpenHistorySessionInInspector}
                  onOpenSessionConversationTaskDetail={onOpenSessionConversationTaskDetail}
                  sessionsForDispatchLookup={sessionsForDispatchLookup}
                />
              )}
            </div>
          );
        })}
      </>
    );
  },
);
