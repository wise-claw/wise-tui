import { invoke } from "@tauri-apps/api/core";
import { isTauriIpcAlive } from "../utils/tauriEnv";

export type OverlayDragCursor = "grab" | "grabbing" | "reset";

export async function startOverlayWindowDrag(): Promise<void> {
  if (!isTauriIpcAlive()) return;
  try {
    await invoke("start_overlay_window_drag");
  } catch {
    /* 非桌面窗或 IPC 已关 */
  }
}

export async function setOverlayDragCursor(kind: OverlayDragCursor): Promise<void> {
  if (!isTauriIpcAlive()) return;
  try {
    await invoke("set_overlay_drag_cursor", { kind });
  } catch {
    /* 非桌面窗或 IPC 已关 */
  }
}

/** Overlay 顶栏内可点击控件悬停时恢复默认系统光标（避免仍显示拖拽手型）。 */
export function resetOverlayDragCursorOnInteractiveHover(target: EventTarget | null): void {
  if (!(target instanceof Element)) return;
  if (
    target.closest(
      "button, a, [role='button'], input, select, textarea, .app-left-sidebar-topbar-btn, .app-topbar-btn",
    )
  ) {
    void setOverlayDragCursor("reset");
  }
}
