-- 需求拆分面板：与项目绑定的员工、团队（workflows）引用，便于展示与后续流程使用

CREATE TABLE IF NOT EXISTS project_prd_employees (
  project_id TEXT NOT NULL,
  employee_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (project_id, employee_id),
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_project_prd_employees_project_id
  ON project_prd_employees (project_id);

CREATE TABLE IF NOT EXISTS project_prd_workflows (
  project_id TEXT NOT NULL,
  workflow_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (project_id, workflow_id),
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  FOREIGN KEY (workflow_id) REFERENCES workflows(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_project_prd_workflows_project_id
  ON project_prd_workflows (project_id);
