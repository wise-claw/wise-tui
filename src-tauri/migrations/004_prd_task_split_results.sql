-- PRD 任务拆分结果：独立表持久化（不再使用 app_settings 中的 JSON blob）

CREATE TABLE IF NOT EXISTS prd_task_split_results (
  id TEXT PRIMARY KEY NOT NULL,
  payload TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
