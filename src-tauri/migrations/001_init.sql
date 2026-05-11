-- Wise 本地库：消息未读 + 桌面小人位置（后续可扩展会话/同步游标等）

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY NOT NULL,
  conversation_id TEXT NOT NULL,
  direction TEXT NOT NULL,
  server_msg_id TEXT,
  body TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  read_at TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_messages_server
  ON messages (conversation_id, server_msg_id)
  WHERE server_msg_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS mascot_prefs (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  window_x INTEGER,
  window_y INTEGER,
  visible INTEGER NOT NULL DEFAULT 0
);

INSERT OR IGNORE INTO mascot_prefs (id, window_x, window_y, visible) VALUES (1, NULL, NULL, 0);
