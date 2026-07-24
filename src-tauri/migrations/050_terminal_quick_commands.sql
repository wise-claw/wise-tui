-- 终端顶栏快捷指令（全局，独立表落库）

CREATE TABLE IF NOT EXISTS terminal_quick_commands (
  id TEXT PRIMARY KEY NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  command TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_terminal_quick_commands_sort
  ON terminal_quick_commands (sort_order ASC, updated_at DESC);
