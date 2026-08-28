export type ComposerShortcutSurface = "main" | "hud";

/**
 * 会话输入快捷键只作用当前模式的一个输入面。
 * HUD 窗以自身是否隐藏为准（避免 active store 尚未同步时丢掉 HUD 快捷键）；
 * 主窗在 HUD 模式开启时忽略，避免隐藏主窗仍响应广播事件。
 */
export function shouldHandleComposerGlobalShortcut(
  surface: ComposerShortcutSurface,
  hudModeActive: boolean,
  windowHidden = false,
): boolean {
  if (surface === "hud") return !windowHidden;
  return !hudModeActive;
}
