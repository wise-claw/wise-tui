import { useCallback, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  wiseMainWindowFocus,
  wiseMascotHide,
  wiseMascotSavePosition,
  wiseNotificationMarkAllRead,
  wiseNotificationUnreadTotal,
} from "./services/wiseMascot";
import "./mascot.css";

function MascotApp() {
  const [total, setTotal] = useState(0);
  const [toast, setToast] = useState<{ title: string; body: string } | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const moveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refreshTotal = useCallback(async () => {
    try {
      const n = await wiseNotificationUnreadTotal();
      setTotal(Number(n));
    } catch {
      setTotal(0);
    }
  }, []);

  useEffect(() => {
    void refreshTotal();
  }, [refreshTotal]);

  const unsubsRef = useRef<UnlistenFn[]>([]);

  useEffect(() => {
    unsubsRef.current = [];
    void (async () => {
      unsubsRef.current.push(
        await listen<{ total: number }>("wise-unread-changed", (e) => {
          setTotal(Number(e.payload.total ?? 0));
        }),
      );
      unsubsRef.current.push(
        await listen<{ title: string; body: string }>("wise-toast", (e) => {
          const { title, body } = e.payload;
          setToast({ title, body });
          if (toastTimer.current) clearTimeout(toastTimer.current);
          toastTimer.current = setTimeout(() => setToast(null), 4200);
        }),
      );
      const win = getCurrentWindow();
      unsubsRef.current.push(
        await win.onMoved(({ payload: pos }) => {
          if (moveTimer.current) clearTimeout(moveTimer.current);
          moveTimer.current = setTimeout(() => {
            void wiseMascotSavePosition(pos.x, pos.y);
          }, 280);
        }),
      );
    })();

    return () => {
      if (toastTimer.current) clearTimeout(toastTimer.current);
      if (moveTimer.current) clearTimeout(moveTimer.current);
      for (const u of unsubsRef.current) {
        u();
      }
      unsubsRef.current = [];
    };
  }, []);

  return (
    <div className="app-mascot-root">
      {toast ? (
        <div className="app-mascot-toast" role="status">
          <div className="app-mascot-toast-title">{toast.title}</div>
          <div className="app-mascot-toast-body">{toast.body}</div>
        </div>
      ) : null}
      <div className="app-mascot-card">
        <div className="app-mascot-drag" data-tauri-drag-region title="拖动可移动窗口">
          <div className="app-mascot-avatar-wrap" data-tauri-drag-region>
            <div className="app-mascot-avatar" data-tauri-drag-region>
              <span className="app-mascot-avatar-letter">W</span>
              {total > 0 ? (
                <span className="app-mascot-badge">{total > 99 ? "99+" : total}</span>
              ) : null}
            </div>
          </div>
        </div>
        <div className="app-mascot-actions">
          <button type="button" className="app-mascot-btn app-mascot-btn--primary" onClick={() => void wiseMainWindowFocus()}>
            主窗口
          </button>
          <button type="button" className="app-mascot-btn" onClick={() => void wiseNotificationMarkAllRead().then(() => refreshTotal())}>
            已读
          </button>
          <button type="button" className="app-mascot-btn" onClick={() => void wiseMascotHide()}>
            隐藏
          </button>
        </div>
      </div>
    </div>
  );
}

createRoot(document.getElementById("root") as HTMLElement).render(<MascotApp />);
