import { useEffect, type RefObject } from "react";
import { markClaudeScrollInteraction } from "../stores/claudeScrollInteractionGate";
import type { ClaudeSession } from "../types";

export function isClaudeChatSessionStreaming(status: ClaudeSession["status"]): boolean {
  return status === "running" || status === "connecting";
}

/**
 * 流式时指针在消息列表内：仅延长 live 刷新让路窗口（markClaudeScrollInteraction）。
 * 不再挂 pointer-busy 覆盖层，避免执行中无法展开工具/复制/点选历史消息。
 */
export function useChatMessagesPointerBusy(
  scrollRootRef: RefObject<HTMLElement | null>,
  streamingActive: boolean,
): void {
  useEffect(() => {
    const el = scrollRootRef.current;
    if (!el || !streamingActive) return;

    const onPointerEnter = () => {
      markClaudeScrollInteraction();
    };

    const onPointerMove = () => {
      markClaudeScrollInteraction();
    };

    el.addEventListener("pointerenter", onPointerEnter);
    el.addEventListener("pointermove", onPointerMove, { passive: true });

    return () => {
      el.removeEventListener("pointerenter", onPointerEnter);
      el.removeEventListener("pointermove", onPointerMove);
    };
  }, [scrollRootRef, streamingActive]);
}
