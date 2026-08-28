import { invoke } from "@tauri-apps/api/core";
import { emitTo } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import { PRIMARY_MAIN_WINDOW_LABEL } from "./mainWindow";
import {
  WISE_HUD_CANCEL_EVENT,
  WISE_HUD_NEW_SESSION_EVENT,
  WISE_HUD_REQUEST_STATE_EVENT,
  WISE_HUD_SELECT_REPOSITORY_EVENT,
  WISE_HUD_SET_ENGINE_EVENT,
  WISE_HUD_SET_MODEL_EVENT,
  WISE_HUD_SUBMIT_EVENT,
} from "../utils/wiseHudSnapshot";

/** HUD 窗不能用全局 emit：主窗隐藏后收不到。经 Rust 打到 `main`，失败再 emitTo。 */
async function emitToPrimaryMain(event: string, payload?: unknown): Promise<void> {
  try {
    await invoke("wise_hud_emit_to_main", {
      event,
      payload: payload ?? null,
    });
  } catch {
    await emitTo(PRIMARY_MAIN_WINDOW_LABEL, event, payload);
  }
}

export async function wiseHudToggle(): Promise<void> {
  return invoke("wise_hud_toggle");
}

export async function wiseHudEnter(): Promise<void> {
  return invoke("wise_hud_enter");
}

export async function wiseHudExit(): Promise<void> {
  return invoke("wise_hud_exit");
}

export async function wiseHudSnapToCursor(): Promise<void> {
  return invoke("wise_hud_snap_to_cursor");
}

export async function wiseHudResetLayout(): Promise<void> {
  return invoke("wise_hud_reset_layout");
}

export async function wiseHudSaveBounds(x: number, y: number, width?: number): Promise<void> {
  return invoke("wise_hud_save_bounds", {
    x,
    y,
    width: typeof width === "number" && Number.isFinite(width) ? width : null,
  });
}

/** 只改 HUD 高度，窗口底边（胶囊）保持不动。 */
export async function wiseHudSetOverlayHeight(height: number): Promise<void> {
  return invoke("wise_hud_set_overlay_height", { height });
}

export async function wiseHudIsActive(): Promise<boolean> {
  return invoke<boolean>("wise_hud_is_active");
}

/** 聚焦当前模式的输入面：HUD 开着时聚焦 HUD，否则置顶主窗口。 */
export async function wiseFocusActiveComposerSurface(): Promise<void> {
  return invoke("wise_focus_composer_surface");
}

export async function wiseHudRequestState(): Promise<void> {
  await emitToPrimaryMain(WISE_HUD_REQUEST_STATE_EVENT);
}

export async function wiseHudSubmit(text: string, sessionId?: string | null): Promise<void> {
  const trimmedId = sessionId?.trim();
  await emitToPrimaryMain(
    WISE_HUD_SUBMIT_EVENT,
    trimmedId ? { text, sessionId: trimmedId } : { text },
  );
}

export async function wiseHudCancel(): Promise<void> {
  await emitToPrimaryMain(WISE_HUD_CANCEL_EVENT);
}

export async function wiseHudSelectRepository(repositoryId: number): Promise<void> {
  await emitToPrimaryMain(WISE_HUD_SELECT_REPOSITORY_EVENT, { repositoryId });
}

export async function wiseHudNewSession(): Promise<void> {
  await emitToPrimaryMain(WISE_HUD_NEW_SESSION_EVENT);
}

export async function wiseHudSetEngine(
  engine: string,
  sessionId?: string | null,
): Promise<void> {
  const trimmedId = sessionId?.trim();
  await emitToPrimaryMain(
    WISE_HUD_SET_ENGINE_EVENT,
    trimmedId ? { engine, sessionId: trimmedId } : { engine },
  );
}

export async function wiseHudSetModel(model: string, sessionId?: string | null): Promise<void> {
  const trimmedId = sessionId?.trim();
  await emitToPrimaryMain(
    WISE_HUD_SET_MODEL_EVENT,
    trimmedId ? { model, sessionId: trimmedId } : { model },
  );
}

/** 选择本地文件，路径供 HUD 以 `@path` 附到草稿。 */
export async function pickHudAttachmentPaths(): Promise<string[]> {
  try {
    const result = await open({ multiple: true, directory: false });
    if (result == null) return [];
    const paths = Array.isArray(result) ? result : [result];
    return paths.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
  } catch {
    return [];
  }
}

export { appendHudAttachmentMentions } from "../utils/wiseHudSnapshot";
