-- 项目、仓库关联、应用设置（任务模板 / 活跃项目等）

CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS project_repositories (
  project_id TEXT NOT NULL,
  repository_id INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (project_id, repository_id)
);

CREATE INDEX IF NOT EXISTS idx_project_repositories_project_id
  ON project_repositories (project_id);

CREATE INDEX IF NOT EXISTS idx_project_repositories_repository_id
  ON project_repositories (repository_id);

CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY NOT NULL,
  value TEXT NOT NULL
);
