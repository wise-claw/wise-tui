import { useCallback, useEffect, useRef, useState } from "react";
import "./index.css";

interface Props {
  /** 拖动开始时 Git 面板的 CSS 高度（px）。 */
  startHeightPx: number;
  /** 拖动期间高频回调：组件内部已用 rAF 合批，单次拖动最多触发 ~60Hz。 */
  onHeightChange: (nextHeightPx: number) => void;
  /** 拖动结束时（pointerup / cancel）调用一次，回调已 clamp 后的最终高度。 */
  onHeightCommit?: (committedHeightPx: number) => void;
}

/** 拖动期通过添加/移除 body class 锁定 grabbing 光标。 */
function setResizingBodyClass(active: boolean) {
  if (typeof document === "undefined") return;
  const cls = "app-repo-panel-split-resizing";
  if (active) {
    document.body.classList.add(cls);
  } else {
    document.body.classList.remove(cls);
  }
}

export function RepoPanelSplitResizeHandle({
  startHeightPx,
  onHeightChange,
  onHeightCommit,
}: Props) {
  const handleRef = useRef<HTMLDivElement | null>(null);
  // 拖动上下文：startHeight 是父组件传入的「按下瞬间的高度」，startY 是按下时的 clientY。
  // 存 ref 不存 state，避免拖动期间 React 重渲（避开 Layout 子树重绘）。
  const dragRef = useRef<{
    startPointerY: number;
    startHeight: number;
    pointerId: number;
    rafId: number | null;
    pendingNext: number | null;
    latestNext: number;
  } | null>(null);

  // 仅用于触发 hover/active 视觉 class 的轻量 state：拖动时把 class 加上，结束时去掉。
  // 不参与高度数据流，避免任何父组件重渲。
  const [dragging, setDragging] = useState(false);

  /** 用 rAF 把「待提交的最新高度」合并到下一帧。 */
  const scheduleFlush = useCallback(() => {
    const drag = dragRef.current;
    if (!drag) return;
    if (drag.rafId != null) return;
    drag.rafId = window.requestAnimationFrame(() => {
      const cur = dragRef.current;
      if (!cur) return;
      cur.rafId = null;
      if (cur.pendingNext == null) return;
      const next = cur.pendingNext;
      cur.pendingNext = null;
      onHeightChange(next);
    });
  }, [onHeightChange]);

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
      // flush 最后一帧的 pending，再回调 commit。
      let committed = drag.startHeight;
      if (drag.pendingNext != null) {
        committed = drag.pendingNext;
        drag.pendingNext = null;
        onHeightChange(committed);
      } else if (drag.latestNext !== undefined) {
        committed = drag.latestNext;
      }
      dragRef.current = null;
      setResizingBodyClass(false);
      setDragging(false);
      onHeightCommit?.(committed);
    },
    [onHeightChange, onHeightCommit],
  );

  const onPointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      // 仅响应左键 / 主指针；触摸 / 笔通过 pointerType 走同一路径。
      if (event.button !== 0 && event.pointerType === "mouse") return;
      event.preventDefault();
      const target = event.currentTarget;
      handleRef.current = target;
      dragRef.current = {
        startPointerY: event.clientY,
        startHeight: startHeightPx,
        pointerId: event.pointerId,
        rafId: null,
        pendingNext: null,
        latestNext: startHeightPx,
      };
      try {
        target.setPointerCapture(event.pointerId);
      } catch {
        /* 极少数环境下 setPointerCapture 会抛错，忽略即可。 */
      }
      setResizingBodyClass(true);
      setDragging(true);
    },
    [startHeightPx],
  );

  const onPointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const drag = dragRef.current;
      if (!drag) return;
      if (event.pointerId !== drag.pointerId) return;
      event.preventDefault();
      // 语义：拖把与 Git 面板「绑在一起」运动 —— 拖把向上拖（clientY 减小），Git 上沿跟着上移 → Git 变高；
      // 反之拖把向下拖，Git 下沿跟着下移 → Git 变矮。这样跟手视觉一致。
      const delta = event.clientY - drag.startPointerY;
      const next = drag.startHeight - delta;
      drag.latestNext = next;
      drag.pendingNext = next;
      scheduleFlush();
    },
    [scheduleFlush],
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
      if (dragRef.current) endDrag();
      setResizingBodyClass(false);
    };
  }, [endDrag]);

  return (
    <div
      ref={handleRef}
      className={
        "app-repo-panel-split-resize-handle" +
        (dragging ? " app-repo-panel-split-resize-handle--dragging" : "")
      }
      role="separator"
      aria-orientation="horizontal"
      aria-label="拖动调整 Git 面板高度"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    />
  );
}