import {
  forwardRef,
  useCallback,
  useImperativeHandle,
  useRef,
  type ReactElement,
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
  /** 内存窗口耗尽时衔接磁盘全量重载（仅主窗格 chat 变体传入） */
  onWindowExhausted?: () => void;
  /** 全量磁盘重载后解除 maxVisible 封顶，使加载更早消息按钮在长会话下仍可逐段扩展窗口。 */
  transcriptMemoryUnlimited?: boolean;
}

/** 影响单行 element 输出的上下文 prop 集合（element 缓存引用相等判据用）。 */
export interface RowElementCacheContext {
  sessionId?: string;
  listVariant?: "chat" | "monitor";
  resolveExecutionEnvironmentDispatchTask?: (meta: DispatchRecordMeta) => SessionConversationTaskItem | null;
  onOpenTaskDetail?: (taskId: string) => void;
  onOpenHistorySessionInInspector?: (sessionId: string) => void;
  onOpenSessionConversationTaskDetail?: (task: SessionConversationTaskItem) => void;
  sessionsForDispatchLookup?: readonly ClaudeSession[];
  renderRow?: (row: ChatMessageListRow, index: number) => ReactNode;
}

/** 单行 element 缓存条目：element 引用 + 命中判据所需的全量输入。 */
export interface CachedRowElement extends RowElementCacheContext {
  element: ReactElement;
  row: ChatMessageListRow;
  index: number;
}

/**
 * 行 element 缓存命中判据（纯函数，便于单测）。
 * token tick 时前缀行 row 引用不变、所有 ctx prop 引用稳定 → 命中复用 element 引用，
 * 触发 React bailoutOnAlreadyFinishedWork 跳过整子树（不 diff div、不调 rowContentEqual / rowPropsEqual）。
 * messageListProfile/companionMessageListWindow 仅经窗口 sizing → index 间接影响，已被 index 覆盖；
 * onNavigate/scrollContainerRef 不传入行 element，不需纳入；listResetKey 单独触发清空。
 */
export function rowElementCacheHit(
  cached: CachedRowElement,
  row: ChatMessageListRow,
  index: number,
  ctx: RowElementCacheContext,
): boolean {
  return (
    cached.row === row &&
    cached.index === index &&
    cached.sessionId === ctx.sessionId &&
    cached.listVariant === ctx.listVariant &&
    cached.resolveExecutionEnvironmentDispatchTask === ctx.resolveExecutionEnvironmentDispatchTask &&
    cached.onOpenTaskDetail === ctx.onOpenTaskDetail &&
    cached.onOpenHistorySessionInInspector === ctx.onOpenHistorySessionInInspector &&
    cached.onOpenSessionConversationTaskDetail === ctx.onOpenSessionConversationTaskDetail &&
    cached.sessionsForDispatchLookup === ctx.sessionsForDispatchLookup &&
    cached.renderRow === ctx.renderRow
  );
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
      onWindowExhausted,
      transcriptMemoryUnlimited,
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
      onWindowExhausted,
      transcriptMemoryUnlimited,
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

    // 行 element 引用缓存：按 row.key 复用前缀行 element，token tick 时命中 → React bailout 跳过整子树。
    const elementCacheRef = useRef<Map<string, CachedRowElement>>(new Map());
    const prevListResetKeyRef = useRef(listResetKey);
    // 切会话（listResetKey = session.id 变化）时清空缓存，渲染期生效（effect 前），无跨会话污染。
    if (prevListResetKeyRef.current !== listResetKey) {
      elementCacheRef.current = new Map();
      prevListResetKeyRef.current = listResetKey;
    }

    const rowRenderCtx: RowElementCacheContext = {
      sessionId,
      listVariant,
      resolveExecutionEnvironmentDispatchTask,
      onOpenTaskDetail,
      onOpenHistorySessionInInspector,
      onOpenSessionConversationTaskDetail,
      sessionsForDispatchLookup,
      renderRow,
    };
    // 迁移式缓存：每轮新建 nextCache，命中条目迁移，未命中 createElement 写入；
    // 循环后替换 ref，旧 Map 中未迁移条目（已移出窗口的行）随旧 Map GC。
    const nextElementCache = new Map<string, CachedRowElement>();
    const renderedRows = visibleRows.map((row, offset) => {
      const index = visibleStartIndex + offset;
      if (row.kind === "message" && !hasRenderableChatMessageBody(row.msg)) {
        return null;
      }
      const cached = elementCacheRef.current.get(row.key);
      if (cached && rowElementCacheHit(cached, row, index, rowRenderCtx)) {
        nextElementCache.set(row.key, cached);
        return cached.element;
      }
      const element = (
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
      nextElementCache.set(row.key, { element, row, index, ...rowRenderCtx });
      return element;
    });
    elementCacheRef.current = nextElementCache;

    return (
      <>
        {windowActive && hiddenRowCount > 0 ? (
          <div className="app-claude-messages-load-more">
            <button type="button" className="app-claude-messages-load-more__btn" onClick={loadMoreOlder}>
              加载更早消息（还有 {hiddenRowCount} 条）
            </button>
          </div>
        ) : null}
        {renderedRows}
      </>
    );
  },
);
