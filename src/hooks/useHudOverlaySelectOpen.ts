import { useCallback, useEffect, useRef, useState } from "react";
import {
  HUD_SELECT_OPEN_DELAY_MS,
  shouldScheduleHudOverlayOpen,
} from "../utils/hudSelectPopup";

/**
 * HUD 仓库下拉：先把 overlay 窗口撑高，再真正打开 Select，
 * 避免 Ant Design 在 64px 高窗口里测到上方没空间后自动翻到下方。
 */
export function useHudOverlaySelectOpen(enabled: boolean): {
  open: boolean | undefined;
  overlayWanted: boolean;
  onOpenChange: (next: boolean) => void;
  prepareOverlay: () => void;
} {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const openRef = useRef(false);
  openRef.current = open;

  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const prepareOverlay = useCallback(() => {
    if (!enabled) return;
    setPending(true);
  }, [enabled]);

  const onOpenChange = useCallback(
    (next: boolean) => {
      if (!enabled) return;
      if (next) {
        setPending(true);
        if (!shouldScheduleHudOverlayOpen(openRef.current, timerRef.current != null)) {
          return;
        }
        timerRef.current = setTimeout(() => {
          timerRef.current = null;
          setOpen(true);
        }, HUD_SELECT_OPEN_DELAY_MS);
        return;
      }
      clearTimer();
      setOpen(false);
      setPending(false);
    },
    [clearTimer, enabled],
  );

  useEffect(() => {
    if (enabled) return;
    clearTimer();
    setOpen(false);
    setPending(false);
  }, [clearTimer, enabled]);

  useEffect(() => () => clearTimer(), [clearTimer]);

  return {
    open: enabled ? open : undefined,
    overlayWanted: enabled && (pending || open),
    onOpenChange,
    prepareOverlay,
  };
}
