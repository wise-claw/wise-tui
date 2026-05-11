-- 可执行任务：与 prd_task_split_results（拆分任务）分表存储，避免两类任务混在同一 JSON 中。

CREATE TABLE IF NOT EXISTS prd_executable_tasks (
  id TEXT PRIMARY KEY NOT NULL,
  payload TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
