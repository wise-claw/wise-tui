CREATE TABLE IF NOT EXISTS employees (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  agent_type TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS employee_repositories (
  employee_id TEXT NOT NULL,
  repository_id INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (employee_id, repository_id),
  FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS workflows (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  is_default INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS workflow_stages (
  id TEXT PRIMARY KEY,
  workflow_id TEXT NOT NULL,
  name TEXT NOT NULL,
  stage_order INTEGER NOT NULL,
  pass_rule TEXT NOT NULL,
  reject_rule TEXT NOT NULL,
  FOREIGN KEY (workflow_id) REFERENCES workflows(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS stage_assignees (
  id TEXT PRIMARY KEY,
  stage_id TEXT NOT NULL,
  employee_id TEXT NOT NULL,
  required_count INTEGER NOT NULL DEFAULT 1,
  is_required INTEGER NOT NULL DEFAULT 1,
  FOREIGN KEY (stage_id) REFERENCES workflow_stages(id) ON DELETE CASCADE,
  FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  creator TEXT NOT NULL,
  workflow_id TEXT NOT NULL,
  current_stage_index INTEGER NOT NULL,
  status TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (workflow_id) REFERENCES workflows(id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS task_stage_decisions (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  stage_id TEXT NOT NULL,
  employee_id TEXT NOT NULL,
  decision TEXT NOT NULL,
  reason TEXT,
  decided_at INTEGER,
  FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE,
  FOREIGN KEY (stage_id) REFERENCES workflow_stages(id) ON DELETE CASCADE,
  FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS task_events (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_tasks_status_stage ON tasks(status, current_stage_index);
CREATE INDEX IF NOT EXISTS idx_decisions_task_stage ON task_stage_decisions(task_id, stage_id, decision);
CREATE INDEX IF NOT EXISTS idx_stages_workflow_order ON workflow_stages(workflow_id, stage_order);
CREATE INDEX IF NOT EXISTS idx_assignees_stage_employee ON stage_assignees(stage_id, employee_id);
CREATE INDEX IF NOT EXISTS idx_employee_repositories_repo ON employee_repositories(repository_id, employee_id);
