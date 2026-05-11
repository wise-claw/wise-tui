import { useCallback, useRef } from "react";
import "./index.css";

// ── Types ──

interface Props {
  /** 左栏与中栏之间：向右拖加宽左栏；中栏与右栏之间：向左拖加宽右栏 */
  variant: "left" | "right";
  /** 拖动开始时侧栏的 CSS 宽度（px） */
  startWidthPx: number;
  onWidthChange: (nextWidthPx: number) => void;
}

// ── Component ──

export function MainLayoutResizeHandle({ variant, startWidthPx, onWidthChange }: Props) {
  const captureTargetRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{
    startPointerX: number;
    startWidth: number;
  } | null>(null);

  const endDrag = useCallback(() => {
    dragRef.current = null;
  }, []);

  const onPointerMove = useCallback(
    (event: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag) return;
      const delta = event.clientX - drag.startPointerX;
      const next =
        variant === "left" ? drag.startWidth + delta : drag.startWidth - delta;
      onWidthChange(next);
    },
    [onWidthChange, variant],
  );

  const onPointerUp = useCallback(
    (event: PointerEvent) => {
      if (dragRef.current == null) return;
      const el = captureTargetRef.current;
      if (el?.hasPointerCapture?.(event.pointerId)) {
        el.releasePointerCapture(event.pointerId);
      }
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerUp);
      endDrag();
    },
    [endDrag, onPointerMove],
  );

  const onPointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (event.button !== 0) return;
      event.preventDefault();
      captureTargetRef.current = event.currentTarget;
      dragRef.current = {
        startPointerX: event.clientX,
        startWidth: startWidthPx,
      };
      event.currentTarget.setPointerCapture(event.pointerId);
      window.addEventListener("pointermove", onPointerMove);
      window.addEventListener("pointerup", onPointerUp);
      window.addEventListener("pointercancel", onPointerUp);
    },
    [onPointerMove, onPointerUp, startWidthPx],
  );

  return (
    <div
      className="app-main-layout-resize-handle"
      role="separator"
      aria-orientation="vertical"
      aria-label={variant === "left" ? "拖动调整左栏宽度" : "拖动调整右栏宽度"}
      onPointerDown={onPointerDown}
    />
  );
}
