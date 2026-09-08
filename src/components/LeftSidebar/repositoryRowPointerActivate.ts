import type { PointerEvent as ReactPointerEvent } from "react";

const REPOSITORY_ROW_NESTED_ACTION_SELECTOR = [
  ".app-repository-row-actions",
  ".app-repository-row-running-status",
  ".app-repository-expand",
  ".app-repository-header-btn",
  ".app-repository-drag-handle",
  "button",
  "a",
].join(",");

export function isRepositoryRowNestedActionTarget(target: EventTarget | null): boolean {
  return target instanceof Element && Boolean(target.closest(REPOSITORY_ROW_NESTED_ACTION_SELECTOR));
}

/**
 * 仓库行在 pointerdown 激活（与会话树同一模式）：
 * 焦点在 Composer 时，首次 click 常被失焦/切仓重渲吞掉，导致要点两次。
 * 整行 draggable 时不能 preventDefault，否则 HTML5 拖拽无法开始。
 * 键盘激活仍走 onClick。
 */
export function handleRepositoryRowPointerDown(
  event: ReactPointerEvent<HTMLElement>,
  activate: () => void,
  options?: { preserveDefaultForDrag?: boolean },
): void {
  if (event.button !== 0) return;
  if (isRepositoryRowNestedActionTarget(event.target)) return;
  if (!options?.preserveDefaultForDrag) {
    event.preventDefault();
  }
  activate();
}

/** 鼠标 click 已由 pointerdown 激活；只把键盘合成的 click（detail === 0）留给 onClick。 */
export function isKeyboardRepositoryRowClick(event: { detail: number }): boolean {
  return event.detail === 0;
}
