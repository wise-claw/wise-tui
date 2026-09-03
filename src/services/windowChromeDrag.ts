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
