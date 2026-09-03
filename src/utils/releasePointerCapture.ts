/** 释放 pointer capture；无 capture / 节点已卸载时忽略。 */
export function releasePointerCaptureSafe(
  el: { hasPointerCapture?: (id: number) => boolean; releasePointerCapture: (id: number) => void } | null,
  pointerId: number,
): void {
  if (!el) return;
  try {
    if (el.hasPointerCapture?.(pointerId)) {
      el.releasePointerCapture(pointerId);
    }
  } catch {
    /* already released or detached */
  }
}
