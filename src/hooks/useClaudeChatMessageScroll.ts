import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, type FocusEvent } from "react";
import type { ClaudeSession } from "../types";
import {
  clearChatScrollFileOpenLock,
  isChatScrollFileOpenLocked,
  setClaudeChatUserPausedFollow,
  takeChatScrollFileOpenAnchor,
} from "../stores/claudeChatMessageScrollBridge";
import { WORKFLOW_UI_EVENT_REPOSITORY_FILE_EDITOR_CLOSED } from "../constants/workflowUiEvents";
import {
  isClaudeScrollInteractionActive,
  markClaudeScrollInteraction,
} from "../stores/claudeScrollInteractionGate";
import { shouldShowListEndThinkingHint } from "../utils/claudeChatMessageListRows";
import type { ChatMessageListNavigationHandle } from "../components/ClaudeSessions/ClaudeVirtualMessageList";

/** 流式贴底：每帧最多移动的像素（越大越跟手，越小越丝滑） */
const SCROLL_FOLLOW_MAX_STEP_PX = 96;
/** 流式贴底读 layout 的最小间隔，避免每 RAF 强制 sync layout */
const SCROLL_FOLLOW_MIN_INTERVAL_MS = 36;

export interface UseClaudeChatMessageScrollOptions {
  session: ClaudeSession;
  hideMessages?: boolean;
}

export function useClaudeChatMessageScroll({ session, hideMessages = false }: UseClaudeChatMessageScrollOptions) {
  const messagesScrollRef = useRef<HTMLDivElement>(null);
  const messageListNavRef = useRef<ChatMessageListNavigationHandle>(null);
  const pinToBottomRef = useRef(true);
  const lastScrollTopRef = useRef(0);
  const programmaticScrollRef = useRef(false);
  const userPausedFollowRef = useRef(false);
  const awaitNewMessageBeforeFollowRef = useRef(false);
  const followFingerprintAtBlurRef = useRef("");
  const scrollFollowLoopRafRef = useRef<number | null>(null);
  const lastScrollFollowLayoutAtRef = useRef(0);
  const scrollNavTimeoutRef = useRef<number | null>(null);
  const sessionStatusRef = useRef(session.status);
  sessionStatusRef.current = session.status;
  const sessionMessagesRef = useRef(session.messages);
  sessionMessagesRef.current = session.messages;
  const lastUserMessagePinIdRef = useRef<number | null>(null);

  const buildMessagesFollowFingerprint = useCallback((messages: ClaudeSession["messages"]) => {
    if (messages.length === 0) return "empty";
    const last = messages[messages.length - 1]!;
    const partsTextLen =
      last.parts?.reduce((sum, part) => {
        if (part.type === "text") return sum + part.text.length;
        if (part.type === "reasoning") return sum + part.text.length;
        return sum;
      }, 0) ?? 0;
    return `${messages.length}:${last.id}:${last.content.length}:${partsTextLen}`;
  }, []);

  const shouldAutoFollow = useCallback(() => {
    if (hideMessages) return false;
    return pinToBottomRef.current;
  }, [hideMessages]);

  const canScrollForNewContent = useCallback(() => {
    if (!awaitNewMessageBeforeFollowRef.current) return true;
    const fp = buildMessagesFollowFingerprint(sessionMessagesRef.current);
    if (fp === followFingerprintAtBlurRef.current) return false;
    awaitNewMessageBeforeFollowRef.current = false;
    return true;
  }, [buildMessagesFollowFingerprint]);

  const isSessionStreaming = useCallback(() => {
    const status = sessionStatusRef.current;
    return status === "running" || status === "connecting";
  }, []);

  const getMessagesScrollTarget = useCallback((sc: HTMLDivElement) => {
    return Math.max(0, sc.scrollHeight - sc.clientHeight);
  }, []);

  const applyScrollTowardBottom = useCallback(
    (sc: HTMLDivElement, opts?: { smooth?: boolean }) => {
      const target = getMessagesScrollTarget(sc);
      const current = sc.scrollTop;
      const gap = target - current;
      if (gap <= 0.5) return;

      programmaticScrollRef.current = true;
      if (!opts?.smooth || gap <= SCROLL_FOLLOW_MAX_STEP_PX) {
        sc.scrollTop = target;
      } else {
        sc.scrollTop = current + Math.min(gap, SCROLL_FOLLOW_MAX_STEP_PX);
      }
      lastScrollTopRef.current = sc.scrollTop;
      window.requestAnimationFrame(() => {
        window.requestAnimationFrame(() => {
          programmaticScrollRef.current = false;
        });
      });
    },
    [getMessagesScrollTarget],
  );

  const snapScrollToBottom = useCallback(() => {
    const sc = messagesScrollRef.current;
    if (!sc) return;
    applyScrollTowardBottom(sc);
  }, [applyScrollTowardBottom]);

  const cancelScrollFollowLoop = useCallback(() => {
    if (scrollFollowLoopRafRef.current != null) {
      window.cancelAnimationFrame(scrollFollowLoopRafRef.current);
      scrollFollowLoopRafRef.current = null;
    }
  }, []);

  const tickScrollFollowLoopRef = useRef<() => void>(() => undefined);

  const ensureScrollFollowLoop = useCallback(() => {
    if (!shouldAutoFollow() || !isSessionStreaming()) return;
    if (scrollFollowLoopRafRef.current != null) return;
    scrollFollowLoopRafRef.current = window.requestAnimationFrame(() => tickScrollFollowLoopRef.current());
  }, [shouldAutoFollow, isSessionStreaming]);

  const armAutoFollowOnMessagesBlur = useCallback(() => {
    if (isChatScrollFileOpenLocked()) return;
    if (!userPausedFollowRef.current) return;
    userPausedFollowRef.current = false;
    pinToBottomRef.current = true;
    awaitNewMessageBeforeFollowRef.current = true;
    followFingerprintAtBlurRef.current = buildMessagesFollowFingerprint(sessionMessagesRef.current);
    setClaudeChatUserPausedFollow(false);
  }, [buildMessagesFollowFingerprint]);

  const pauseAutoFollowForUserScroll = useCallback(() => {
    if (userPausedFollowRef.current) return;
    userPausedFollowRef.current = true;
    pinToBottomRef.current = false;
    awaitNewMessageBeforeFollowRef.current = false;
    cancelScrollFollowLoop();
    setClaudeChatUserPausedFollow(true);
  }, [cancelScrollFollowLoop]);

  const handleMessagesBlur = useCallback(
    (event: FocusEvent<HTMLDivElement>) => {
      const sc = messagesScrollRef.current;
      if (!sc) return;
      const next = event.relatedTarget;
      if (next instanceof Node && sc.contains(next)) return;
      armAutoFollowOnMessagesBlur();
    },
    [armAutoFollowOnMessagesBlur],
  );

  const tickScrollFollowLoop = useCallback(() => {
    scrollFollowLoopRafRef.current = null;
    if (isClaudeScrollInteractionActive()) {
      if (shouldAutoFollow() && isSessionStreaming()) {
        scrollFollowLoopRafRef.current = window.requestAnimationFrame(() => tickScrollFollowLoopRef.current());
      }
      return;
    }
    if (!shouldAutoFollow()) return;
    if (!canScrollForNewContent()) return;

    const sc = messagesScrollRef.current;
    if (!sc) return;

    const streaming = isSessionStreaming();
    const now = performance.now();
    if (streaming && now - lastScrollFollowLayoutAtRef.current < SCROLL_FOLLOW_MIN_INTERVAL_MS) {
      if (shouldAutoFollow()) {
        scrollFollowLoopRafRef.current = window.requestAnimationFrame(() => tickScrollFollowLoopRef.current());
      }
      return;
    }
    lastScrollFollowLayoutAtRef.current = now;
    applyScrollTowardBottom(sc, { smooth: streaming });

    if (streaming && shouldAutoFollow()) {
      scrollFollowLoopRafRef.current = window.requestAnimationFrame(() => tickScrollFollowLoopRef.current());
    }
  }, [shouldAutoFollow, canScrollForNewContent, isSessionStreaming, applyScrollTowardBottom]);

  tickScrollFollowLoopRef.current = tickScrollFollowLoop;

  const scheduleScrollToBottom = useCallback(() => {
    if (!shouldAutoFollow()) return;
    if (!canScrollForNewContent()) return;
    const sc = messagesScrollRef.current;
    if (!sc) return;

    applyScrollTowardBottom(sc, { smooth: isSessionStreaming() });

    if (isSessionStreaming()) {
      ensureScrollFollowLoop();
      return;
    }

    window.requestAnimationFrame(() => {
      if (!shouldAutoFollow()) return;
      if (!canScrollForNewContent()) return;
      const scNow = messagesScrollRef.current;
      if (!scNow) return;
      applyScrollTowardBottom(scNow);
    });
  }, [
    shouldAutoFollow,
    canScrollForNewContent,
    isSessionStreaming,
    applyScrollTowardBottom,
    ensureScrollFollowLoop,
  ]);

  const pauseFollowForMessageNavigation = useCallback(() => {
    userPausedFollowRef.current = true;
    pinToBottomRef.current = false;
    awaitNewMessageBeforeFollowRef.current = false;
    cancelScrollFollowLoop();
    setClaudeChatUserPausedFollow(true);
  }, [cancelScrollFollowLoop]);

  const scrollMessageTargetIntoView = useCallback(
    (target: Element | null, behavior: ScrollBehavior = "smooth") => {
      const sc = messagesScrollRef.current;
      if (!sc || !(target instanceof HTMLElement) || !sc.contains(target)) {
        return false;
      }
      const scRect = sc.getBoundingClientRect();
      const targetRect = target.getBoundingClientRect();
      const targetTop =
        sc.scrollTop + targetRect.top - scRect.top - Math.max(0, (sc.clientHeight - targetRect.height) / 2);
      const maxTop = Math.max(0, sc.scrollHeight - sc.clientHeight);
      const nextTop = Math.max(0, Math.min(maxTop, targetTop));
      pauseFollowForMessageNavigation();
      sc.scrollTo({ top: nextTop, behavior });
      lastScrollTopRef.current = nextTop;
      return true;
    },
    [pauseFollowForMessageNavigation],
  );

  const scrollToSessionMessageId = useCallback(
    (messageId: number) => {
      if (scrollNavTimeoutRef.current != null) {
        window.clearTimeout(scrollNavTimeoutRef.current);
      }
      scrollNavTimeoutRef.current = window.setTimeout(() => {
        scrollNavTimeoutRef.current = null;
        const row = document.querySelector(`[data-message-id="${CSS.escape(String(messageId))}"]`);
        if (scrollMessageTargetIntoView(row)) return;
        messageListNavRef.current?.scrollToMessageId(messageId);
      }, 50);
    },
    [scrollMessageTargetIntoView],
  );

  const showListEndThinkingHint = useMemo(
    () => shouldShowListEndThinkingHint(session.messages, session.status),
    [session.messages, session.status],
  );

  useEffect(() => {
    cancelScrollFollowLoop();
    if (scrollNavTimeoutRef.current != null) {
      window.clearTimeout(scrollNavTimeoutRef.current);
      scrollNavTimeoutRef.current = null;
    }
    pinToBottomRef.current = true;
    userPausedFollowRef.current = false;
    awaitNewMessageBeforeFollowRef.current = false;
    followFingerprintAtBlurRef.current = "";
    lastUserMessagePinIdRef.current = null;
    clearChatScrollFileOpenLock();
    takeChatScrollFileOpenAnchor();
    setClaudeChatUserPausedFollow(false);
  }, [session.id, cancelScrollFollowLoop]);

  useEffect(() => {
    const onFileEditorClosed = () => {
      const anchor = takeChatScrollFileOpenAnchor();
      if (!anchor) {
        clearChatScrollFileOpenLock();
        return;
      }
      const restore = () => {
        const sc = messagesScrollRef.current;
        if (!sc) {
          clearChatScrollFileOpenLock();
          return;
        }
        pauseFollowForMessageNavigation();
        programmaticScrollRef.current = true;
        sc.scrollTop = anchor.scrollTop;
        lastScrollTopRef.current = anchor.scrollTop;
        window.requestAnimationFrame(() => {
          window.requestAnimationFrame(() => {
            programmaticScrollRef.current = false;
            clearChatScrollFileOpenLock();
          });
        });
      };
      window.requestAnimationFrame(() => {
        window.requestAnimationFrame(restore);
      });
    };
    window.addEventListener(WORKFLOW_UI_EVENT_REPOSITORY_FILE_EDITOR_CLOSED, onFileEditorClosed);
    return () => {
      window.removeEventListener(WORKFLOW_UI_EVENT_REPOSITORY_FILE_EDITOR_CLOSED, onFileEditorClosed);
    };
  }, [pauseFollowForMessageNavigation]);

  useEffect(() => {
    if (isSessionStreaming()) return;
    if (session.messages.length === 0) return;
    const last = session.messages[session.messages.length - 1]!;
    if (last.role !== "user" && last.role !== "system") return;
    if (lastUserMessagePinIdRef.current === last.id) return;
    lastUserMessagePinIdRef.current = last.id;
    pinToBottomRef.current = true;
    userPausedFollowRef.current = false;
    awaitNewMessageBeforeFollowRef.current = false;
    setClaudeChatUserPausedFollow(false);
    cancelScrollFollowLoop();
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        snapScrollToBottom();
      });
    });
  }, [
    session.messages,
    session.status,
    cancelScrollFollowLoop,
    snapScrollToBottom,
    isSessionStreaming,
  ]);

  useLayoutEffect(() => {
    if (hideMessages) return;
    const sc = messagesScrollRef.current;
    if (!sc) return;
    let pinRaf = 0;

    lastScrollTopRef.current = sc.scrollTop;

    const composerEditorHasFocus = () => {
      const ae = document.activeElement;
      return ae instanceof Element && ae.closest("[data-wise-composer-root] .ProseMirror") != null;
    };

    const onWheel = (event: WheelEvent) => {
      if (programmaticScrollRef.current) return;
      if (Math.abs(event.deltaY) <= 2) return;
      markClaudeScrollInteraction();
      if (composerEditorHasFocus()) return;
      sc.focus({ preventScroll: true });
      pauseAutoFollowForUserScroll();
    };

    const onScroll = () => {
      if (programmaticScrollRef.current) return;
      markClaudeScrollInteraction();
      if (pinRaf !== 0) return;
      pinRaf = window.requestAnimationFrame(() => {
        pinRaf = 0;
        if (programmaticScrollRef.current) return;
        const currentScrollTop = sc.scrollTop;
        const prevScrollTop = lastScrollTopRef.current;
        if (Math.abs(currentScrollTop - prevScrollTop) > 1) {
          if (!composerEditorHasFocus()) {
            sc.focus({ preventScroll: true });
          }
          pauseAutoFollowForUserScroll();
        }
        lastScrollTopRef.current = currentScrollTop;
      });
    };
    sc.addEventListener("wheel", onWheel, { passive: true, capture: true });
    sc.addEventListener("scroll", onScroll, { passive: true });
    pinToBottomRef.current = true;
    return () => {
      sc.removeEventListener("wheel", onWheel, { capture: true });
      sc.removeEventListener("scroll", onScroll);
      if (pinRaf !== 0) window.cancelAnimationFrame(pinRaf);
    };
  }, [session.id, hideMessages, pauseAutoFollowForUserScroll]);

  useLayoutEffect(() => {
    if (hideMessages) return;
    // 流式贴底由 RAF 环负责；此处同步 scroll 会在每条 token 更新时强制 layout，造成周期性卡顿。
    if (isSessionStreaming()) return;
    scheduleScrollToBottom();
  }, [session.messages, session.status, hideMessages, scheduleScrollToBottom, isSessionStreaming]);

  useEffect(() => {
    if (hideMessages) return;
    if (shouldAutoFollow() && isSessionStreaming()) {
      ensureScrollFollowLoop();
      return;
    }
    cancelScrollFollowLoop();
  }, [
    session.status,
    hideMessages,
    shouldAutoFollow,
    isSessionStreaming,
    ensureScrollFollowLoop,
    cancelScrollFollowLoop,
  ]);

  useLayoutEffect(() => {
    if (hideMessages) return;
    const sc = messagesScrollRef.current;
    if (!sc) return;

    let raf = 0;
    const mo = new MutationObserver(() => {
      if (isSessionStreaming()) return;
      if (raf !== 0) return;
      raf = window.requestAnimationFrame(() => {
        raf = 0;
        if (shouldAutoFollow()) scheduleScrollToBottom();
      });
    });
    // 勿监听 characterData：流式 Markdown 每 token 都会触发 MO，主线程会周期性卡死。
    mo.observe(sc, { childList: true, subtree: true });

    return () => {
      mo.disconnect();
      if (raf !== 0) window.cancelAnimationFrame(raf);
    };
  }, [session.id, hideMessages, scheduleScrollToBottom, shouldAutoFollow, isSessionStreaming]);

  useEffect(
    () => () => {
      cancelScrollFollowLoop();
      if (scrollNavTimeoutRef.current != null) {
        window.clearTimeout(scrollNavTimeoutRef.current);
        scrollNavTimeoutRef.current = null;
      }
    },
    [cancelScrollFollowLoop],
  );

  return {
    messagesScrollRef,
    messageListNavRef,
    handleMessagesBlur,
    pauseFollowForMessageNavigation,
    scrollToSessionMessageId,
    scrollMessageTargetIntoView,
    showListEndThinkingHint,
  };
}
