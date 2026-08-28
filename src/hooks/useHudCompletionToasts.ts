import { useCallback, useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { safeUnlisten } from "../utils/safeTauriUnlisten";
import {
  beginHudToastLeave,
  EMPTY_HUD_TOAST_BOARD,
  enqueueHudCompletionToasts,
  HUD_COMPLETION_TOAST_DURATION_MS,
  HUD_COMPLETION_TOAST_LEAVE_MS,
  parseHudCompletionToastPayload,
  removeHudToast,
  type HudToastBoard,
} from "../utils/hudCompletionToast";
import {
  parseWiseHudActiveChanged,
  WISE_HUD_ACTIVE_EVENT,
  WISE_HUD_SESSION_COMPLETE_EVENT,
} from "../utils/wiseHudSnapshot";

export function useHudCompletionToasts() {
  const [board, setBoard] = useState<HudToastBoard>(EMPTY_HUD_TOAST_BOARD);
  const leaveTimers = useRef(new Map<string, number>());
  const removeTimers = useRef(new Map<string, number>());

  const clearTimer = (bag: Map<string, number>, id: string) => {
    const timer = bag.get(id);
    if (timer != null) {
      window.clearTimeout(timer);
      bag.delete(id);
    }
  };

  const clearAllTimers = useCallback(() => {
    for (const timer of leaveTimers.current.values()) window.clearTimeout(timer);
    for (const timer of removeTimers.current.values()) window.clearTimeout(timer);
    leaveTimers.current.clear();
    removeTimers.current.clear();
  }, []);

  const dismiss = useCallback((id: string) => {
    clearTimer(leaveTimers.current, id);
    setBoard((prev) => beginHudToastLeave(prev, id));
    clearTimer(removeTimers.current, id);
    const timer = window.setTimeout(() => {
      removeTimers.current.delete(id);
      setBoard((prev) => removeHudToast(prev, id));
    }, HUD_COMPLETION_TOAST_LEAVE_MS);
    removeTimers.current.set(id, timer);
  }, []);

  useEffect(() => {
    for (const toast of board.visible) {
      if (toast.phase !== "visible") continue;
      if (leaveTimers.current.has(toast.id)) continue;
      const timer = window.setTimeout(() => dismiss(toast.id), HUD_COMPLETION_TOAST_DURATION_MS);
      leaveTimers.current.set(toast.id, timer);
    }
    for (const [id, timer] of [...leaveTimers.current]) {
      const stillVisible = board.visible.some((toast) => toast.id === id && toast.phase === "visible");
      if (stillVisible) continue;
      window.clearTimeout(timer);
      leaveTimers.current.delete(id);
    }
  }, [board.visible, dismiss]);

  useEffect(() => {
    let cancelled = false;
    let unlistenComplete: (() => void) | undefined;
    let unlistenActive: (() => void) | undefined;
    void (async () => {
      try {
        const u1 = await listen<unknown>(WISE_HUD_SESSION_COMPLETE_EVENT, (event) => {
          const items = parseHudCompletionToastPayload(event.payload);
          if (items.length === 0) return;
          setBoard((prev) => enqueueHudCompletionToasts(prev, items));
        });
        const u2 = await listen<unknown>(WISE_HUD_ACTIVE_EVENT, (event) => {
          if (parseWiseHudActiveChanged(event.payload) === false) {
            clearAllTimers();
            setBoard(EMPTY_HUD_TOAST_BOARD);
          }
        });
        if (cancelled) {
          safeUnlisten(u1);
          safeUnlisten(u2);
          return;
        }
        unlistenComplete = () => safeUnlisten(u1);
        unlistenActive = () => safeUnlisten(u2);
      } catch {
        /* 非 Tauri 预览 */
      }
    })();
    return () => {
      cancelled = true;
      unlistenComplete?.();
      unlistenActive?.();
      clearAllTimers();
    };
  }, [clearAllTimers]);

  return {
    toasts: board.visible,
    renderedCount: board.visible.length,
    dismiss,
  };
}
