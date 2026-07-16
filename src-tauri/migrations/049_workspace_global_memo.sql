-- 全局工作区备忘录（单文档 Markdown，不绑定项目/仓库）

CREATE TABLE IF NOT EXISTS workspace_global_memo (
  id TEXT PRIMARY KEY NOT NULL CHECK (id = 'default'),
  body_markdown TEXT NOT NULL DEFAULT '',
  updated_at INTEGER NOT NULL
);
