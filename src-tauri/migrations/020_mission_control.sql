-- Mission Control backend ledger.

CREATE TABLE IF NOT EXISTS mission_runs (
  mission_id TEXT PRIMARY KEY NOT NULL,
  project_id TEXT,
  project_name TEXT,
  root_path TEXT NOT NULL,
  prd_hash TEXT,
  title TEXT NOT NULL,
  stage TEXT NOT NULL,
  status TEXT NOT NULL,
  snapshot_json TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_mission_runs_project_updated
  ON mission_runs(project_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_mission_runs_root_updated
  ON mission_runs(root_path, updated_at DESC);

CREATE TABLE IF NOT EXISTS mission_events (
  event_id TEXT PRIMARY KEY NOT NULL,
  mission_id TEXT NOT NULL REFERENCES mission_runs(mission_id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  timestamp INTEGER NOT NULL,
  actor TEXT,
  payload_json TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_mission_events_mission_timestamp
  ON mission_events(mission_id, timestamp ASC);

CREATE INDEX IF NOT EXISTS idx_mission_events_type_timestamp
  ON mission_events(event_type, timestamp DESC);

CREATE TABLE IF NOT EXISTS mission_agent_assignments (
  assignment_id TEXT PRIMARY KEY NOT NULL,
  mission_id TEXT NOT NULL REFERENCES mission_runs(mission_id) ON DELETE CASCADE,
  agent_run_id TEXT UNIQUE,
  project_id TEXT,
  task_id TEXT,
  cluster_id TEXT,
  repository_id INTEGER,
  repository_path TEXT,
  agent_type TEXT NOT NULL,
  employee_id TEXT,
  stage TEXT NOT NULL,
  status TEXT NOT NULL,
  current_file TEXT,
  session_id TEXT,
  started_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  completed_at INTEGER,
  last_heartbeat_at INTEGER NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_mission_agent_assignments_mission_status
  ON mission_agent_assignments(mission_id, status, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_mission_agent_assignments_project_status
  ON mission_agent_assignments(project_id, status, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_mission_agent_assignments_task
  ON mission_agent_assignments(mission_id, task_id);
