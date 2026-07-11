-- 待办事项全局化：放宽 scope_kind 约束以支持 'global' 作用域（不绑定工作区/仓库）。
-- SQLite 无法直接修改既有 CHECK 约束，需重建表：新建 -> 复制 -> 删旧 -> 改名。

CREATE TABLE IF NOT EXISTS workspace_todos_new (
  scope_kind TEXT NOT NULL CHECK (scope_kind IN ('project', 'repository', 'global')),
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

INSERT INTO workspace_todos_new (
  scope_kind, scope_id, id, title, completed, due_at, notes, sort_order, created_at, updated_at
)
SELECT scope_kind, scope_id, id, title, completed, due_at, notes, sort_order, created_at, updated_at
FROM workspace_todos;

DROP TABLE workspace_todos;

ALTER TABLE workspace_todos_new RENAME TO workspace_todos;

CREATE INDEX IF NOT EXISTS idx_workspace_todos_scope_sort
  ON workspace_todos (scope_kind, scope_id, completed ASC, sort_order ASC, updated_at DESC);
