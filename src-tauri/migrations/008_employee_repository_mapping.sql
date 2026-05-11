CREATE TABLE IF NOT EXISTS employee_repositories (
  employee_id TEXT NOT NULL,
  repository_id INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (employee_id, repository_id),
  FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_employee_repositories_repo ON employee_repositories(repository_id, employee_id);
