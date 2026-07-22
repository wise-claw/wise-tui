/**
 * 仅用于 layout / useCenterView 感知「终端占用中栏 slot」。
 * 真实 TerminalPanel 由 ClaudeSessions 在注入 panelBelowMessages 时替换本 sentinel。
 */
export const TERMINAL_CENTER_SLOT_SENTINEL = (
  <div className="app-terminal-center-slot-sentinel" hidden aria-hidden />
);
