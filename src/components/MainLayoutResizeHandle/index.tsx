import { useCallback, useEffect, useRef, useState } from "react";
import "./index.css";

// ── Types ──

interface Props {
  /** 左栏与中栏之间：向右拖加宽左栏；中栏与右栏之间：向左拖加宽右栏 */
  variant: "left" | "right";
  /** 拖动开始时侧栏的 CSS 宽度（px） */
  startWidthPx: number;
  /** 拖动期间高频回调：组件内部已用 rAF 合批，单次拖动最多触发 ~60Hz。 */
  onWidthChange: (nextWidthPx: number) => void;
}

// ── Helpers ──

/** 在拖动期通过添加/移除 body class 锁定 grabbing 光标，避免指针
 *  拖出 handle 区域后光标回到默认箭头而让人以为"拖不动"。 */
function setResizingBodyClass(active: boolean) {
  if (typeof document === "undefined") return;
  const cls = "app-main-layout-resizing";
  if (active) {
    document.body.classList.add(cls);
  } else {
    document.body.classList.remove(cls);
  }
}

// ── Component ──

export function MainLayoutResizeHandle({ variant, startWidthPx, onWidthChange }: Props) {
  const handleRef = useRef<HTMLDivElement | null>(null);
  // 拖动上下文：startWidth 是父组件传入的"按下瞬间的宽度"，startX 是按下时的 clientX。
  // 之所以存 ref 不存 state，是因为拖动期间我们不希望 React 重渲（避免 Layout 子树重绘）。
  const dragRef = useRef<{
    startPointerX: number;
    startWidth: number;
    pointerId: number;
    rafId: number | null;
    pendingNext: number | null;
    latestNext: number;
  } | null>(null);

  // 仅用于触发 hover/active 视觉 class 的轻量 state：拖动时把 class 加上，结束时去掉。
  // 不参与宽度数据流，避免任何父组件重渲。
  const [dragging, setDragging] = useState(false);

  /** 用 rAF 把"待提交的最新宽度"合并到下一帧。
   *  多次 pointermove 在同一帧时只 commit 一次最新值，绕开 React 逐事件重渲。 */
  const scheduleFlush = useCallback(() => {
    const drag = dragRef.current;
    if (!drag) return;
    if (drag.rafId != null) return; // 已有一帧在排队
    drag.rafId = window.requestAnimationFrame(() => {
      const cur = dragRef.current;
      if (!cur) return;
      cur.rafId = null;
      if (cur.pendingNext == null) return;
      const next = cur.pendingNext;
      cur.pendingNext = null;
      onWidthChange(next);
    });
  }, [onWidthChange]);

  /** 收尾：释放 pointer capture、清理 rAF、去掉 dragging 视觉与 body class。 */
  const endDrag = useCallback(
    (event?: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag) return;
      const el = handleRef.current;
      if (el && event && el.hasPointerCapture?.(event.pointerId)) {
        el.releasePointerCapture(event.pointerId);
      }
      if (drag.rafId != null) {
        window.cancelAnimationFrame(drag.rafId);
      }
      // flush 最后一帧的 pending（用户最后 1 个 pointermove 后通常还会有一帧在排队）
      if (drag.pendingNext != null) {
        const next = drag.pendingNext;
        drag.pendingNext = null;
        // 用同步调用即可：pointerup 后不会再有新的 move 写入。
        onWidthChange(next);
      }
      dragRef.current = null;
      setResizingBodyClass(false);
      setDragging(false);
    },
    [onWidthChange],
  );

  const onPointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      // 仅响应左键 / 主指针；触摸 / 笔通过 pointerType 走同一路径。
      if (event.button !== 0 && event.pointerType === "mouse") return;
      event.preventDefault();
      const target = event.currentTarget;
      handleRef.current = target;
      dragRef.current = {
        startPointerX: event.clientX,
        startWidth: startWidthPx,
        pointerId: event.pointerId,
        rafId: null,
        pendingNext: null,
        latestNext: startWidthPx,
      };
      try {
        target.setPointerCapture(event.pointerId);
      } catch {
        /* 极少数环境下 setPointerCapture 会抛错，忽略即可。 */
      }
      setResizingBodyClass(true);
      setDragging(true);
    },
    [startWidthPx],
  );

  /** 把 onPointerDown / onPointerMove / onPointerUp / onPointerCancel 都接到 React 合成事件
   *  上，配合 setPointerCapture，单一路径处理所有指针事件，行为一致且无 race。 */
  const onPointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const drag = dragRef.current;
      if (!drag) return;
      // 仅处理当前正在拖动的 pointerId，避免多指 / 多设备串扰。
      if (event.pointerId !== drag.pointerId) return;
      event.preventDefault();
      const delta = event.clientX - drag.startPointerX;
      const next =
        variant === "left" ? drag.startWidth + delta : drag.startWidth - delta;
      drag.latestNext = next;
      drag.pendingNext = next;
      scheduleFlush();
    },
    [scheduleFlush, variant],
  );

  const onPointerUp = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (!dragRef.current) return;
      if (event.pointerId !== dragRef.current.pointerId) return;
      endDrag(event.nativeEvent);
    },
    [endDrag],
  );

  // 兜底：window 失焦 / 切到后台 / 关闭页面 / 组件卸载时强制释放拖动状态。
  // 否则拖到一半切窗口再回来，handle 会卡在 dragging 视觉、body cursor 锁住、raf 仍在跑。
  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState !== "hidden") return;
      if (!dragRef.current) return;
      endDrag();
    };
    const onBlur = () => {
      if (!dragRef.current) return;
      endDrag();
    };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("blur", onBlur);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("blur", onBlur);
      // 组件卸载兜底
      if (dragRef.current) endDrag();
      setResizingBodyClass(false);
    };
  }, [endDrag]);

  return (
    <div
      ref={handleRef}
      className={
        "app-main-layout-resize-handle" +
        (dragging ? " app-main-layout-resize-handle--dragging" : "")
      }
      role="separator"
      aria-orientation="vertical"
      aria-label={variant === "left" ? "拖动调整左栏宽度" : "拖动调整右栏宽度"}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    />
  );
}