import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
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

export function useCompletionToasts(notificationSurface = false) {
  const maxVisible = notificationSurface ? 1 : 3;
  const [deliveryRevision, setDeliveryRevision] = useState(0);
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
      setBoard((prev) => removeHudToast(prev, id, maxVisible));
    }, HUD_COMPLETION_TOAST_LEAVE_MS);
    removeTimers.current.set(id, timer);
  }, [maxVisible]);

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
    const unsubs: (() => void)[] = [];
    const receive = (payload: unknown) => {
      if (cancelled) return;
      const items = parseHudCompletionToastPayload(payload);
      if (items.length === 0) return;
      const revision = (payload as { revision?: unknown }).revision;
      if (typeof revision === "number") setDeliveryRevision((prev) => Math.max(prev, revision));
      setBoard((prev) => enqueueHudCompletionToasts(prev, items, maxVisible));
    };
    void (async () => {
      try {
        const unlisten = await listen<unknown>(notificationSurface ? "wise-island-session-complete" : WISE_HUD_SESSION_COMPLETE_EVENT, (event) => receive(event.payload));
        if (cancelled) { safeUnlisten(unlisten); return; }
        unsubs.push(unlisten);
        if (notificationSurface) {
          const unlistenSetting = await listen<boolean>("wise-island-notifications-changed", (event) => {
            if (!event.payload) {
              clearAllTimers();
              setBoard(EMPTY_HUD_TOAST_BOARD);
              setDeliveryRevision(0);
            }
          });
          if (cancelled) { safeUnlisten(unlistenSetting); return; }
          unsubs.push(unlistenSetting);
          const unlistenReset = await listen("wise-island-reset", () => {
            clearAllTimers();
            setBoard(EMPTY_HUD_TOAST_BOARD);
            setDeliveryRevision(0);
          });
          if (cancelled) { safeUnlisten(unlistenReset); return; }
          unsubs.push(unlistenReset);
          receive(await invoke("wise_island_completion_ready"));
        } else {
          const unlistenActive = await listen<unknown>(WISE_HUD_ACTIVE_EVENT, (event) => {
            if (parseWiseHudActiveChanged(event.payload) === false) {
              clearAllTimers();
              setBoard(EMPTY_HUD_TOAST_BOARD);
            }
          });
          if (cancelled) { safeUnlisten(unlistenActive); return; }
          unsubs.push(unlistenActive);
        }
      } catch (error) {
        console.error("[Completion] 通知监听初始化失败", error);
      }
    })();
    return () => {
      cancelled = true;
      for (const unlisten of unsubs) safeUnlisten(unlisten);
      clearAllTimers();
    };
  }, [clearAllTimers, notificationSurface, maxVisible]);

  return {
    deliveryRevision,
    toasts: board.visible,
    queuedCount: board.queued.length,
    renderedCount: board.visible.length,
    dismiss,
  };
}

