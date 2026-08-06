import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, type FocusEvent } from "react";
import type { ClaudeSession } from "../types";
import {
  clearChatScrollFileOpenLock,
  isChatScrollFileOpenLocked,
  setClaudeChatUserPausedFollow,
  takeChatScrollFileOpenAnchor,
} from "../stores/claudeChatMessageScrollBridge";
import { CHAT_MESSAGE_LIST_BOTTOM_RECLAIM_PX } from "../constants/claudeMessageList";
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
/** 闲置会话 Markdown 挂载会连发 DOM 变更；合并贴底，避免切换会话时消息区连跳。 */
const IDLE_HYDRATE_SCROLL_DEBOUNCE_MS = 80;
/** 距底部小于该值仍视为贴底：内容高度变化 / 窗口回收 clamp 触发的 scroll 不应暂停跟随。 */
const STILL_PINNED_TO_BOTTOM_PX = CHAT_MESSAGE_LIST_BOTTOM_RECLAIM_PX;

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
  /** 会话切换后的延迟贴底定时器：见 [session.id] reset effect。 */
  const switchResetTimerRef = useRef<number | null>(null);
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

    // 切会话后消息 / 虚拟窗口 / Markdown 要数帧才稳定：布局贴底 effect 只在
    // `session.messages` 引用变化时重跑，同引用切换（B 已在内存、快照未变）时不会触发；
    // MutationObserver 微任务又早于本被动 effect 执行，若切会话瞬间贴底处于暂停态，
    // MO 入口会跳过调度且之后不再有 DOM 变更兜底——加载出的消息就会停在中间位置。
    // 这里在 DOM 稳定窗口后强制补一次贴底（fire 时仍尊重 shouldAutoFollow，用户真在
    // 滚动则不打断），配合 MO 的 fire 时机判定，保证「切换会话即展示最新消息」。
    if (switchResetTimerRef.current != null) {
      window.clearTimeout(switchResetTimerRef.current);
    }
    switchResetTimerRef.current = window.setTimeout(() => {
      switchResetTimerRef.current = null;
      if (shouldAutoFollow()) {
        snapScrollToBottom();
      }
    }, IDLE_HYDRATE_SCROLL_DEBOUNCE_MS + 120);

    return () => {
      if (switchResetTimerRef.current != null) {
        window.clearTimeout(switchResetTimerRef.current);
        switchResetTimerRef.current = null;
      }
    };
  }, [session.id, cancelScrollFollowLoop, shouldAutoFollow, snapScrollToBottom]);

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

    const ensureScrollContainerFocus = () => {
      if (composerEditorHasFocus()) return;
      const ae = document.activeElement;
      // 已在本滚动容器内：再 focus 会触发 WebKit 隐式 scroll-into-view，
      // 触顶时 wheel 与 focus-rect reset 互相拉锯 → 弹簧式上下微弹。跳过重复 focus。
      if (ae instanceof Element && sc.contains(ae)) return;
      sc.focus({ preventScroll: true });
    };

    const onWheel = (event: WheelEvent) => {
      if (programmaticScrollRef.current) return;
      if (Math.abs(event.deltaY) <= 2) return;
      markClaudeScrollInteraction();
      ensureScrollContainerFocus();
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
        const maxScrollTop = Math.max(0, sc.scrollHeight - sc.clientHeight);
        const distanceToBottom = maxScrollTop - currentScrollTop;
        // 贴底回收卸载顶部行、流式增高后的 clamp 都会改 scrollTop；只要仍在底部阈值内
        // 就保持跟随。任意 delta 都 pause 会在「执行中等一下」后丢掉末条自动展示。
        if (distanceToBottom <= STILL_PINNED_TO_BOTTOM_PX) {
          lastScrollTopRef.current = currentScrollTop;
          return;
        }
        if (Math.abs(currentScrollTop - prevScrollTop) > 1) {
          ensureScrollContainerFocus();
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
    // 切会话瞬间 messages 常为空：先贴底再灌入会闪一下再跳到底。
    if (session.messages.length === 0) return;
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

    let debounceTimer: number | null = null;
    const mo = new MutationObserver(() => {
      if (isSessionStreaming()) return;
      if (sessionMessagesRef.current.length === 0) return;
      if (debounceTimer != null) window.clearTimeout(debounceTimer);
      // MO 微任务可能早于切会话的被动 reset effect 执行：不能在入口因「贴底暂停」直接
      // 跳过调度，否则暂停在随后的 reset 中解除后，不再有 DOM 变更来触发补滚。改为先
      // 调度、在 debounce 到期时按当时的 shouldAutoFollow 状态决定是否真正贴底。
      debounceTimer = window.setTimeout(() => {
        debounceTimer = null;
        if (shouldAutoFollow() && !isSessionStreaming() && sessionMessagesRef.current.length > 0) {
          scheduleScrollToBottom();
        }
      }, IDLE_HYDRATE_SCROLL_DEBOUNCE_MS);
    });
    // 勿监听 characterData：流式 Markdown 每 token 都会触发 MO，主线程会周期性卡死。
    mo.observe(sc, { childList: true, subtree: true });

    return () => {
      mo.disconnect();
      if (debounceTimer != null) window.clearTimeout(debounceTimer);
    };
  }, [session.id, hideMessages, scheduleScrollToBottom, shouldAutoFollow, isSessionStreaming]);

  useEffect(
    () => () => {
      cancelScrollFollowLoop();
      if (scrollNavTimeoutRef.current != null) {
        window.clearTimeout(scrollNavTimeoutRef.current);
        scrollNavTimeoutRef.current = null;
      }
      if (switchResetTimerRef.current != null) {
        window.clearTimeout(switchResetTimerRef.current);
        switchResetTimerRef.current = null;
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
