CREATE TABLE IF NOT EXISTS workflow_runs (
  workflow_run_id TEXT PRIMARY KEY NOT NULL,
  session_id TEXT NOT NULL,
  repository_path TEXT NOT NULL,
  payload TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_workflow_runs_repo_updated
  ON workflow_runs(repository_path, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_workflow_runs_session_updated
  ON workflow_runs(session_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS workflow_events (
  event_id TEXT PRIMARY KEY NOT NULL,
  workflow_run_id TEXT NOT NULL,
  timestamp INTEGER NOT NULL,
  payload TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_workflow_events_run_timestamp
  ON workflow_events(workflow_run_id, timestamp ASC);
