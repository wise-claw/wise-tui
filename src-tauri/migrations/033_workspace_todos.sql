-- 右栏 Inspector：工作区/仓库级提醒事项（待办）

CREATE TABLE IF NOT EXISTS workspace_todos (
  scope_kind TEXT NOT NULL CHECK (scope_kind IN ('project', 'repository')),
  scope_id TEXT NOT NULL,
  id TEXT NOT NULL,
  title TEXT NOT NULL,
  completed INTEGER NOT NULL DEFAULT 0 CHECK (completed IN (0, 1)),
  due_at INTEGER,
  notes TEXT NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (scope_kind, scope_id, id)
);

CREATE INDEX IF NOT EXISTS idx_workspace_todos_scope_sort
  ON workspace_todos (scope_kind, scope_id, completed ASC, sort_order ASC, updated_at DESC);
