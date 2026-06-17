import { useDeferredValue, useEffect, useSyncExternalStore } from "react";
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
    if (!session) return;
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
      pending.conversationId === session.id || pending.conversationId === (session.claudeSessionId ?? claudeSessionId ?? "");
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
        for (let i = session.messages.length - 1; i >= 0; i -= 1) {
          const msg = session.messages[i]!;
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
          ? session.messages.findIndex((m) => String(m.id) === rawId)
          : session.messages.findIndex((m) => String(m.id) === target?.getAttribute("data-message-id"));
      const msg = scrollIndex >= 0 ? session.messages[scrollIndex] : undefined;
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
  }, [claudeSessionId, scrollMessageTargetIntoView, session]);

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
