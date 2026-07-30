/**
 * 内置终端的 PTY 命名空间（`workspaceId`）。
 *
 * 多屏下每屏独立一个命名空间，避免 terminal-created / terminal-frame 事件串台。
 * 第一屏恒为 `pane-0`：单屏与多屏走的是两套渲染路径（`ClaudeSessionsChatHost`
 * 按 paneCount 分支），命名空间一致才能在切屏后 attach 回同一批 PTY。
 */

export const DEFAULT_TERMINAL_WORKSPACE_ID = "0";

export function paneTerminalWorkspaceId(paneIndex: number): string {
  if (!Number.isFinite(paneIndex) || paneIndex < 0) return "pane-0";
  return `pane-${Math.floor(paneIndex)}`;
}
