import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";

export const PRIMARY_MAIN_WINDOW_LABEL = "main";
export const AUX_MAIN_WINDOW_LABEL_PREFIX = "main-dock";

/** 进程内缓存：窗口 label 在单 WebView 生命周期内不变，避免 tabs/标题等热路径重复 IPC。 */
let cachedWindowLabel: string | null | undefined;

function resolveCurrentWindowLabel(): string | null {
  if (cachedWindowLabel !== undefined) {
    return cachedWindowLabel;
  }
  try {
    cachedWindowLabel = getCurrentWindow().label;
  } catch {
    cachedWindowLabel = null;
  }
  return cachedWindowLabel;
}

export function isMainWorkspaceWindowLabel(label: string | null | undefined): boolean {
  if (!label) return false;
  return label === PRIMARY_MAIN_WINDOW_LABEL || label.startsWith(AUX_MAIN_WINDOW_LABEL_PREFIX);
}

export function isPrimaryMainWorkspaceWindowLabel(label: string | null | undefined): boolean {
  return label === PRIMARY_MAIN_WINDOW_LABEL;
}

/** 同步读取当前窗口 label（首调后走内存缓存）。 */
export function getCurrentMainWorkspaceWindowLabel(): string | null {
  return resolveCurrentWindowLabel();
}

export async function readCurrentMainWorkspaceWindowLabel(): Promise<string | null> {
  return resolveCurrentWindowLabel();
}

export function isCurrentPrimaryMainWorkspaceWindowSync(): boolean {
  return isPrimaryMainWorkspaceWindowLabel(getCurrentMainWorkspaceWindowLabel());
}

export async function isCurrentPrimaryMainWorkspaceWindow(): Promise<boolean> {
  return isCurrentPrimaryMainWorkspaceWindowSync();
}

/** 新建独立主工作区窗口（跨平台；macOS Dock 菜单亦会调用后端同名逻辑）。 */
export async function openMainWorkspaceWindow(repositoryId?: number): Promise<string> {
  return invoke<string>("wise_open_main_window", {
    repositoryId: repositoryId ?? null,
  });
}

/** 关闭当前聚焦的主工作区窗口；主窗在 macOS 上为隐藏应用。 */
export async function closeMainWorkspaceWindow(): Promise<void> {
  await invoke("wise_close_main_workspace_window");
}
