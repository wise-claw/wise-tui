import { useCallback, useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import { createRoot } from "react-dom/client";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { WisePetSprite, type WisePetState } from "./components/MascotPet/WisePetSprite";
import {
  wiseMainWindowFocus,
  wiseMascotHide,
  wiseMascotSavePosition,
  wiseNotificationMarkAllRead,
  wiseNotificationUnreadTotal,
} from "./services/wiseMascot";
import { SESSION_NOTIFICATION_UI_EVENT_OPEN_PANEL } from "./constants/workflowUiEvents";
import { safeUnlisten, ensureTauriEventUnlistenPatched } from "./utils/safeTauriUnlisten";
import "./mascot.css";

ensureTauriEventUnlistenPatched();

/**
 * Mascot 表情来源：当前是简化版（直接用未读计数 > 0 进入 working）。
 * 真实状态机会在主窗口侧通知中心消费消息时通过 `wise-mascot-state` 事件下发，避免宠物伪造来源。
 */
function MascotApp() {
  const [total, setTotal] = useState(0);
  const [petState, setPetState] = useState<WisePetState>("idle");
  const [menuOpen, setMenuOpen] = useState(false);
  const moveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);

  const refreshTotal = useCallback(async () => {
    try {
      const n = await wiseNotificationUnreadTotal();
      setTotal(Number(n));
    } catch {
      setTotal(0);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const n = await wiseNotificationUnreadTotal();
        if (!cancelled) setTotal(Number(n));
      } catch {
        if (!cancelled) setTotal(0);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const unsubs: UnlistenFn[] = [];
    void (async () => {
      const u1 = await listen<{ total: number }>("wise-unread-changed", (e) => {
        const n = Number(e.payload.total ?? 0);
        setTotal(n);
        // 未读从 0 变 >0 时切到 working 表情（表达"有事要处理"），用户点开/标记已读后回到 idle。
        setPetState((prev) => (n > 0 && prev === "idle" ? "working" : prev === "permission" ? "permission" : n > 0 ? prev : "idle"));
      });
      if (cancelled) {
        safeUnlisten(u1);
        return;
      }
      unsubs.push(u1);

      const u2 = await listen<{ state?: WisePetState }>("wise-mascot-state", (e) => {
        const next = e.payload.state;
        if (next === "idle" || next === "working" || next === "permission") {
          setPetState(next);
        }
      });
      if (cancelled) {
        safeUnlisten(u2);
        return;
      }
      unsubs.push(u2);

      const win = getCurrentWindow();
      const u3 = await win.onMoved(({ payload: pos }) => {
        if (moveTimer.current) clearTimeout(moveTimer.current);
        moveTimer.current = setTimeout(() => {
          void wiseMascotSavePosition(pos.x, pos.y);
        }, 280);
      });
      if (cancelled) {
        safeUnlisten(u3);
        return;
      }
      unsubs.push(u3);
    })();

    return () => {
      cancelled = true;
      if (moveTimer.current) clearTimeout(moveTimer.current);
      for (const u of unsubs) {
        safeUnlisten(u);
      }
    };
  }, []);

  useEffect(() => {
    if (!menuOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      const root = rootRef.current;
      if (!root) return;
      if (event.target instanceof Node && root.contains(event.target)) return;
      setMenuOpen(false);
    };
    window.addEventListener("pointerdown", onPointerDown);
    return () => window.removeEventListener("pointerdown", onPointerDown);
  }, [menuOpen]);

  const handlePetClick = () => {
    // 拖拽事件由独立的 `app-mascot-pet-drag-shell` 在 OS 层拦截，不会落到此按钮；
    // 此处仅响应真正命中 sprite 的鼠标点击 → 安全 focus 主窗。
    setMenuOpen(false);
    void wiseMainWindowFocus();
  };

  /**
   * 99+ 角标点击：聚焦主窗口 + 派发「任意会话展开通知中心」事件；
   * 主窗口侧任一有未读的 ClaudeChat 实例接收后展开 dock。
   */
  const handleBadgeClick = (event: ReactMouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    event.preventDefault();
    setMenuOpen(false);
    void wiseMainWindowFocus().then(() => {
      window.dispatchEvent(
        new CustomEvent(SESSION_NOTIFICATION_UI_EVENT_OPEN_PANEL, {
          detail: { any: true },
        }),
      );
    });
  };

  const handlePetContextMenu = (event: ReactMouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    setMenuOpen((open) => !open);
  };

  const handleMarkRead = () => {
    setMenuOpen(false);
    void wiseNotificationMarkAllRead().then(() => {
      refreshTotal();
      setPetState("idle");
    });
  };

  const handleHide = () => {
    setMenuOpen(false);
    void wiseMascotHide();
  };

  const badgeLabel = total > 99 ? "99+" : String(total);

  return (
    <div className="app-mascot-root" ref={rootRef}>
      {/*
       * 拖拽与点击分离：
       * Tauri 2 的 `data-tauri-drag-region` 在拖动结束时是否派发浏览器原生 click
       * 在不同版本/平台上有不确定性。一旦 click 落到按钮上，handlePetClick
       * 就会被触发，导致「拖动也打开主窗」。
       * 把 `data-tauri-drag-region` 拆到独立的绝对定位全屏透明壳层，
       * 真正接收 OS 层拖拽；sprite + badge 按钮放在壳层之上的点击层，
       * 不带 drag region，按钮 onClick 永远只在真正点击时派发。
       * 99+ 角标按钮保留 `stopPropagation`，因为它本来也不应触发宠物点击。
       */}
      <div className="app-mascot-pet-drag-shell" data-tauri-drag-region aria-hidden />
      <button
        type="button"
        className="app-mascot-pet"
        title="拖动移动 · 点击回主窗口 · 右键更多"
        aria-label={total > 0 ? `Wise 宠物，${total} 条未读` : "Wise 宠物"}
        onClick={handlePetClick}
        onContextMenu={handlePetContextMenu}
      >
        <span className="app-mascot-pet-sprite">
          <WisePetSprite state={petState} />
        </span>
        {total > 0 ? (
          <button
            type="button"
            className="app-mascot-badge"
            title={`${total} 条未读，点击展开需要处理的消息`}
            aria-label={`展开 ${total} 条未读消息`}
            onClick={handleBadgeClick}
          >
            {badgeLabel}
          </button>
        ) : null}
      </button>

      {menuOpen ? (
        <div className="app-mascot-menu" role="menu">
          <button type="button" className="app-mascot-menu-item" role="menuitem" onClick={handlePetClick}>
            打开主窗口
          </button>
          <button type="button" className="app-mascot-menu-item" role="menuitem" onClick={handleMarkRead}>
            全部已读
          </button>
          <button type="button" className="app-mascot-menu-item" role="menuitem" onClick={handleHide}>
            隐藏宠物
          </button>
        </div>
      ) : null}
    </div>
  );
}

createRoot(document.getElementById("root") as HTMLElement).render(<MascotApp />);