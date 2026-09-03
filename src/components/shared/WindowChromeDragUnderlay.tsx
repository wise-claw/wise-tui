import { useCallback, useEffect, useRef, type MouseEvent as ReactMouseEvent } from "react";
import { setOverlayDragCursor, startOverlayWindowDrag } from "../../services/windowChromeDrag";
import { suppressTextSelectionUntilMouseUp } from "../../utils/suppressTextSelectionUntilMouseUp";

/**
 * Overlay 顶栏拖区。
 * 在 `mousedown`（不要用 pointermove）里 startDragging，抓取点由后端按当前光标窗口坐标校正。
 * 按下时暂时禁止划选；不要 preventDefault，以免 macOS Overlay 拖窗口抓取点错位。
 */
export function WindowChromeDragUnderlay({ className }: { className: string }) {
  const stopSelectionRef = useRef<(() => void) | null>(null);

  useEffect(
    () => () => {
      stopSelectionRef.current?.();
      stopSelectionRef.current = null;
    },
    [],
  );

  const onPointerEnter = useCallback(() => {
    void setOverlayDragCursor("grab");
  }, []);

  const onPointerLeave = useCallback(() => {
    void setOverlayDragCursor("reset");
  }, []);

  const onMouseDown = useCallback((event: ReactMouseEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    // 不要 preventDefault：会改掉 NSApp currentEvent，startDragging 抓取点错位导致窗口漂移。
    stopSelectionRef.current?.();
    stopSelectionRef.current = suppressTextSelectionUntilMouseUp();
    void setOverlayDragCursor("grabbing");
    void startOverlayWindowDrag();
  }, []);

  const onMouseUp = useCallback(() => {
    stopSelectionRef.current?.();
    stopSelectionRef.current = null;
    void setOverlayDragCursor("grab");
  }, []);

  return (
    <div
      className={className}
      aria-hidden
      onPointerEnter={onPointerEnter}
      onPointerLeave={onPointerLeave}
      onMouseDown={onMouseDown}
      onMouseUp={onMouseUp}
    />
  );
}
