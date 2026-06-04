-- 执行环境派发任务：按主会话锚点持久化，支持按时间范围查询

CREATE TABLE IF NOT EXISTS execution_environment_dispatch_batch (
  batch_id TEXT PRIMARY KEY NOT NULL,
  anchor_session_id TEXT NOT NULL,
  repository_path TEXT NOT NULL,
  execution_engine TEXT NOT NULL,
  session_count INTEGER NOT NULL,
  preview_text TEXT NOT NULL DEFAULT '',
  batch_hint TEXT,
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS execution_environment_dispatch_item (
  item_key TEXT PRIMARY KEY NOT NULL,
  batch_id TEXT NOT NULL,
  anchor_session_id TEXT NOT NULL,
  worker_session_id TEXT NOT NULL,
  label TEXT NOT NULL,
  preview_text TEXT NOT NULL DEFAULT '',
  batch_index INTEGER NOT NULL,
  session_count INTEGER NOT NULL,
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL,
  FOREIGN KEY (batch_id) REFERENCES execution_environment_dispatch_batch(batch_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_exec_env_dispatch_batch_anchor_created
  ON execution_environment_dispatch_batch (anchor_session_id, created_at_ms DESC);

CREATE INDEX IF NOT EXISTS idx_exec_env_dispatch_item_batch
  ON execution_environment_dispatch_item (batch_id, batch_index ASC);

CREATE INDEX IF NOT EXISTS idx_exec_env_dispatch_item_anchor_updated
  ON execution_environment_dispatch_item (anchor_session_id, updated_at_ms DESC);
