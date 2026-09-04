import { useEffect } from "react";
import { cursorPosition, getCurrentWindow } from "@tauri-apps/api/window";
import { hudPointShouldClickThrough } from "../utils/hudClickThrough";

const POLL_MS = 32;

/**
 * 窗口始终高于胶囊时，透明区必须忽略鼠标，否则会挡住后面的桌面。
 * 点在胶囊/浮层上时恢复命中，避免开合菜单再改窗口高度。
 */
export function useHudClickThrough(): void {
  useEffect(() => {
    const win = getCurrentWindow();
    let cancelled = false;
    let ignored: boolean | null = null;
    let desired = true;
    let inflight = false;
    let pollTimer: ReturnType<typeof setTimeout> | null = null;

    const clearPoll = () => {
      if (pollTimer) {
        clearTimeout(pollTimer);
        pollTimer = null;
      }
    };

    const apply = async (next: boolean) => {
      desired = next;
      if (inflight) return;
      inflight = true;
      try {
        while (!cancelled && ignored !== desired) {
          const send = desired;
          await win.setIgnoreCursorEvents(send);
          ignored = send;
        }
      } catch {
        /* 非 Tauri 预览 */
      } finally {
        inflight = false;
      }
    };

    const throughAtClient = (x: number, y: number): boolean => {
      return hudPointShouldClickThrough(document.elementFromPoint(x, y));
    };

    const schedulePoll = () => {
      if (cancelled || pollTimer != null) return;
      pollTimer = setTimeout(() => {
        pollTimer = null;
        void pollCursor();
      }, POLL_MS);
    };

    const pollCursor = async () => {
      if (cancelled) return;
      try {
        const [cursor, pos, scale] = await Promise.all([
          cursorPosition(),
          win.outerPosition(),
          win.scaleFactor(),
        ]);
        const through = throughAtClient((cursor.x - pos.x) / scale, (cursor.y - pos.y) / scale);
        await apply(through);
        if (through) schedulePoll();
      } catch {
        schedulePoll();
      }
    };

    const onMouseMove = (event: MouseEvent) => {
      const through = throughAtClient(event.clientX, event.clientY);
      void apply(through).then(() => {
        if (through) schedulePoll();
        else clearPoll();
      });
    };

    window.addEventListener("mousemove", onMouseMove, true);
    void apply(true).then(() => {
      if (!cancelled) void pollCursor();
    });

    return () => {
      cancelled = true;
      clearPoll();
      window.removeEventListener("mousemove", onMouseMove, true);
      void win.setIgnoreCursorEvents(false).catch(() => undefined);
    };
  }, []);
}
