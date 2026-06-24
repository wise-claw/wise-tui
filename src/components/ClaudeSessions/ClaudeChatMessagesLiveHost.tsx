import { useDeferredValue, useEffect, useRef, useSyncExternalStore } from "react";
import type { ClaudeSession } from "../../types";
import {
  getClaudeChatUserPausedFollow,
  registerClaudeChatMessageScrollBridge,
  subscribeClaudeChatUserPausedFollow,
} from "../../stores/claudeChatMessageScrollBridge";
import {
  extractNotificationScrollKeyword,
  WISE_PENDING_NOTIFICATION_SCROLL_STORAGE_KEY,
} from "../../utils/claudeTurnNotificationBody";
import { useClaudeSessionLiveSnapshot } from "../../stores/claudeSessionsLiveStore";
import { useClaudeChatMessageScroll } from "../../hooks/useClaudeChatMessageScroll";
import { ClaudeChatMessagesPane, type ClaudeChatMessagesPaneProps } from "./ClaudeChatMessagesPane";

type ClaudeChatMessagesLiveHostProps = Omit<
  ClaudeChatMessagesPaneProps,
  "session" | "messagesScrollRef" | "messageListNavRef" | "showListEndThinkingHint" | "onMessagesBlur" | "onNavigateMessage"
> & {
  sessionId: string;
  claudeSessionId?: string | null;
  hideMessagesScroll?: boolean;
};

/** 消息列表 + 贴底滚动：独立订阅 live sessions，流式时不拖垮 ClaudeChat 壳层。 */
export function ClaudeChatMessagesLiveHost({
  sessionId,
  claudeSessionId,
  hideMessagesScroll = false,
  ...messagesPaneProps
}: ClaudeChatMessagesLiveHostProps) {
  const userPausedFollow = useSyncExternalStore(
    subscribeClaudeChatUserPausedFollow,
    getClaudeChatUserPausedFollow,
    () => false,
  );
  const session = useClaudeSessionLiveSnapshot(sessionId);
  // render 期同步最新 session 到 ref：待处理通知滚动 effect 不再依赖 session 引用（流式 live flush
  // 每 ~100ms 产生新引用会致 effect 反复重跑），改为仅切会话（claudeSessionId 变）时重扫，
  // effect 内通过 sessionRef.current 读取当前 session。
  const sessionRef = useRef(session);
  sessionRef.current = session;
  const deferredSession = useDeferredValue(session);
  const renderSession = userPausedFollow ? deferredSession : session;

  const {
    messagesScrollRef,
    messageListNavRef,
    handleMessagesBlur,
    pauseFollowForMessageNavigation,
    scrollToSessionMessageId,
    scrollMessageTargetIntoView,
    showListEndThinkingHint,
  } = useClaudeChatMessageScroll({
    session: renderSession ?? ({
      id: sessionId,
      claudeSessionId: claudeSessionId ?? null,
      status: "idle",
      messages: [],
      repositoryPath: "",
      repositoryName: "",
      model: "",
      createdAt: 0,
      pendingPrompt: "",
    } satisfies ClaudeSession),
    hideMessages: hideMessagesScroll,
  });

  useEffect(
    () =>
      registerClaudeChatMessageScrollBridge({
        scrollToSessionMessageId,
        scrollMessageTargetIntoView,
        pauseFollowForMessageNavigation,
      }),
    [pauseFollowForMessageNavigation, scrollMessageTargetIntoView, scrollToSessionMessageId],
  );

  useEffect(() => {
    // 通过 ref 读取当前 session，避免把 session 列入依赖（流式 live flush 每 ~100ms 新引用会反复重跑）。
    // 仅 claudeSessionId / scrollMessageTargetIntoView 变化时重扫；pending 匹配与消息定位均用此处读取的 session。
    const currentSession = sessionRef.current;
    if (!currentSession) return;
    let pending: { conversationId?: string; messageId?: string; body?: string; taskId?: string } | null = null;
    try {
      const raw = sessionStorage.getItem(WISE_PENDING_NOTIFICATION_SCROLL_STORAGE_KEY);
      if (raw) {
        pending = JSON.parse(raw) as {
          conversationId?: string;
          messageId?: string;
          body?: string;
          taskId?: string;
        };
      }
    } catch {
      pending = null;
    }
    if (!pending?.conversationId) {
      return;
    }
    const matchesSession =
      pending.conversationId === currentSession.id ||
      pending.conversationId === (currentSession.claudeSessionId ?? claudeSessionId ?? "");
    if (!matchesSession) {
      return;
    }

    const scrollTimeouts: number[] = [];
    const scheduleScroll = (fn: () => void) => {
      scrollTimeouts.push(window.setTimeout(fn, 50));
    };

    const taskIdHint = pending.taskId?.trim();
    if (taskIdHint) {
      const byTask = document.querySelector(`[data-task-id="${CSS.escape(taskIdHint)}"]`);
      if (byTask) {
        scheduleScroll(() => {
          scrollMessageTargetIntoView(byTask);
          try {
            sessionStorage.removeItem(WISE_PENDING_NOTIFICATION_SCROLL_STORAGE_KEY);
          } catch {
            /* ignore */
          }
        });
        return () => {
          scrollTimeouts.forEach((id) => window.clearTimeout(id));
        };
      }
    }

    const escapedMessageId = CSS.escape((pending.messageId ?? "").trim());
    let target: Element | null = null;
    if (escapedMessageId) {
      target = document.querySelector(`[data-message-id="${escapedMessageId}"]`);
    }
    if (!target && pending.body?.trim()) {
      const keyword = extractNotificationScrollKeyword(pending.body);
      if (keyword) {
        for (let i = currentSession.messages.length - 1; i >= 0; i -= 1) {
          const msg = currentSession.messages[i]!;
          const partTexts =
            msg.parts
              ?.filter((part): part is { type: "text"; text: string } => part.type === "text" && typeof part.text === "string")
              .map((part) => part.text) ?? [];
          const fullText = [msg.content, ...partTexts].join("\n");
          if (fullText.includes(keyword)) {
            target = document.querySelector(`[data-message-id="${CSS.escape(String(msg.id))}"]`);
            break;
          }
        }
      }
    }
    if (!target) {
      return;
    }
    scheduleScroll(() => {
      const rawId = (pending.messageId ?? "").trim();
      const scrollIndex =
        rawId !== ""
          ? currentSession.messages.findIndex((m) => String(m.id) === rawId)
          : currentSession.messages.findIndex((m) => String(m.id) === target?.getAttribute("data-message-id"));
      const msg = scrollIndex >= 0 ? currentSession.messages[scrollIndex] : undefined;
      const messageIdForScroll = rawId || (msg != null ? String(msg.id) : "");
      const row =
        msg != null
          ? document.querySelector(`[data-message-id="${CSS.escape(String(msg.id))}"]`)
          : null;
      if (scrollMessageTargetIntoView(row)) {
        try {
          sessionStorage.removeItem(WISE_PENDING_NOTIFICATION_SCROLL_STORAGE_KEY);
        } catch {
          /* ignore */
        }
        return;
      }
      if (messageIdForScroll && messageListNavRef.current?.scrollToMessageId(messageIdForScroll)) {
        try {
          sessionStorage.removeItem(WISE_PENDING_NOTIFICATION_SCROLL_STORAGE_KEY);
        } catch {
          /* ignore */
        }
        return;
      }
      scrollMessageTargetIntoView(target);
      try {
        sessionStorage.removeItem(WISE_PENDING_NOTIFICATION_SCROLL_STORAGE_KEY);
      } catch {
        /* ignore */
      }
    });
    return () => {
      scrollTimeouts.forEach((id) => window.clearTimeout(id));
    };
  }, [claudeSessionId, scrollMessageTargetIntoView]);

  if (!renderSession) {
    return null;
  }

  return (
    <ClaudeChatMessagesPane
      {...messagesPaneProps}
      session={renderSession}
      messagesScrollRef={messagesScrollRef}
      messageListNavRef={messageListNavRef}
      showListEndThinkingHint={showListEndThinkingHint}
      onMessagesBlur={handleMessagesBlur}
      onNavigateMessage={pauseFollowForMessageNavigation}
    />
  );
}
