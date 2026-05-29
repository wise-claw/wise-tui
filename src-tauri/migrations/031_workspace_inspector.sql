-- 右栏 Inspector：工作区/仓库级快捷操作与备忘录（替代 app_settings JSON blob）

CREATE TABLE IF NOT EXISTS workspace_quick_actions (
  scope_kind TEXT NOT NULL CHECK (scope_kind IN ('project', 'repository')),
  scope_id TEXT NOT NULL,
  id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('link', 'directory')),
  label TEXT NOT NULL,
  target TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (scope_kind, scope_id, id)
);

CREATE INDEX IF NOT EXISTS idx_workspace_quick_actions_scope_updated
  ON workspace_quick_actions (scope_kind, scope_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS workspace_memos (
  scope_kind TEXT NOT NULL CHECK (scope_kind IN ('project', 'repository')),
  scope_id TEXT NOT NULL,
  id TEXT NOT NULL,
  title TEXT NOT NULL,
  body_markdown TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (scope_kind, scope_id, id)
);

CREATE INDEX IF NOT EXISTS idx_workspace_memos_scope_updated
  ON workspace_memos (scope_kind, scope_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS workspace_memo_scope_prefs (
  scope_kind TEXT NOT NULL CHECK (scope_kind IN ('project', 'repository')),
  scope_id TEXT NOT NULL,
  last_selected_id TEXT,
  PRIMARY KEY (scope_kind, scope_id)
);
