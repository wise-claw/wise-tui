-- Observable Trellis runtime backend.

CREATE TABLE IF NOT EXISTS trellis_runtime_events (
  event_id TEXT PRIMARY KEY NOT NULL,
  project_id TEXT,
  root_path TEXT NOT NULL,
  session_id TEXT,
  task_path TEXT,
  task_id TEXT,
  event_kind TEXT NOT NULL,
  platform TEXT,
  actor TEXT,
  correlation_id TEXT,
  parent_event_id TEXT,
  payload_json TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_trellis_runtime_events_project_created
  ON trellis_runtime_events(project_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_trellis_runtime_events_root_created
  ON trellis_runtime_events(root_path, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_trellis_runtime_events_task_created
  ON trellis_runtime_events(root_path, task_path, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_trellis_runtime_events_kind_created
  ON trellis_runtime_events(event_kind, created_at DESC);

CREATE TABLE IF NOT EXISTS trellis_agent_runs (
  agent_run_id TEXT PRIMARY KEY NOT NULL,
  project_id TEXT,
  root_path TEXT NOT NULL,
  session_id TEXT,
  task_path TEXT,
  task_id TEXT,
  repository_id INTEGER,
  repository_path TEXT,
  agent_type TEXT NOT NULL,
  stage TEXT,
  status TEXT NOT NULL,
  current_file TEXT,
  started_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  completed_at INTEGER,
  last_heartbeat_at INTEGER NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_trellis_agent_runs_project_status
  ON trellis_agent_runs(project_id, status, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_trellis_agent_runs_root_status
  ON trellis_agent_runs(root_path, status, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_trellis_agent_runs_task
  ON trellis_agent_runs(root_path, task_path, updated_at DESC);

CREATE TABLE IF NOT EXISTS trellis_spec_revisions (
  revision_id TEXT PRIMARY KEY NOT NULL,
  project_id TEXT,
  root_path TEXT NOT NULL,
  file_path TEXT NOT NULL,
  file_hash TEXT NOT NULL,
  content TEXT NOT NULL,
  author TEXT,
  reason TEXT,
  source TEXT,
  task_path TEXT,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_trellis_spec_revisions_file_created
  ON trellis_spec_revisions(root_path, file_path, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_trellis_spec_revisions_project_created
  ON trellis_spec_revisions(project_id, created_at DESC);

CREATE TABLE IF NOT EXISTS trellis_workspace_snapshots (
  snapshot_id TEXT PRIMARY KEY NOT NULL,
  project_id TEXT,
  root_path TEXT NOT NULL,
  source TEXT,
  reason TEXT,
  manifest_json TEXT NOT NULL,
  file_count INTEGER NOT NULL,
  content_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_trellis_workspace_snapshots_project_created
  ON trellis_workspace_snapshots(project_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_trellis_workspace_snapshots_root_created
  ON trellis_workspace_snapshots(root_path, created_at DESC);
