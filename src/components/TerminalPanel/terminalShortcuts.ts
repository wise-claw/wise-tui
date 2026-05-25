/** 终端标题栏展示的编辑快捷键（与 terminalInput 行为一致）。 */
export const TERMINAL_HEADER_SHORTCUTS = [
  { keys: "⌫", title: "删前一字符" },
  { keys: "⌥⌫", title: "删前一个词" },
  { keys: "Del", title: "向前删除" },
  { keys: "⌃U", title: "清空当前行" },
  { keys: "⌃K", title: "删到行尾" },
  { keys: "⌃W", title: "删前一个词" },
  { keys: "↑↓", title: "命令历史" },
  { keys: "Tab", title: "补全提示" },
] as const;
