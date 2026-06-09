import { useEffect, type RefObject } from "react";
import {
  CHAT_MESSAGES_POINTER_BUSY_CLASS,
} from "../constants/chatScrollPerformance";
import { markClaudeScrollInteraction } from "../stores/claudeScrollInteractionGate";
import type { ClaudeSession } from "../types";

export function isClaudeChatSessionStreaming(status: ClaudeSession["status"]): boolean {
  return status === "running" || status === "connecting";
}

/** 流式时指针在消息列表内：挂 busy class 并延长 live/markdown 让路窗口。 */
export function useChatMessagesPointerBusy(
  scrollRootRef: RefObject<HTMLElement | null>,
  streamingActive: boolean,
): void {
  useEffect(() => {
    const el = scrollRootRef.current;
    if (!el) return;

    let moveRaf = 0;
    let pointerInside = false;

    const syncBusyClass = () => {
      const busy = pointerInside && streamingActive;
      if (busy) {
        el.classList.add(CHAT_MESSAGES_POINTER_BUSY_CLASS);
      } else {
        el.classList.remove(CHAT_MESSAGES_POINTER_BUSY_CLASS);
      }
    };

    const onPointerEnter = () => {
      pointerInside = true;
      syncBusyClass();
      if (streamingActive) markClaudeScrollInteraction();
    };

    const onPointerLeave = () => {
      pointerInside = false;
      syncBusyClass();
    };

    const onPointerMove = () => {
      if (!streamingActive || !pointerInside) return;
      markClaudeScrollInteraction();
      if (moveRaf) return;
      moveRaf = requestAnimationFrame(() => {
        moveRaf = 0;
        el.classList.add(CHAT_MESSAGES_POINTER_BUSY_CLASS);
      });
    };

    el.addEventListener("pointerenter", onPointerEnter);
    el.addEventListener("pointerleave", onPointerLeave);
    el.addEventListener("pointermove", onPointerMove, { passive: true });
    syncBusyClass();

    return () => {
      el.removeEventListener("pointerenter", onPointerEnter);
      el.removeEventListener("pointerleave", onPointerLeave);
      el.removeEventListener("pointermove", onPointerMove);
      if (moveRaf) cancelAnimationFrame(moveRaf);
      el.classList.remove(CHAT_MESSAGES_POINTER_BUSY_CLASS);
    };
  }, [scrollRootRef, streamingActive]);
}
