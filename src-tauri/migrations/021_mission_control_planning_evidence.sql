-- Mission Control planning mutations, session sync, agent control, and evidence replay.

CREATE TABLE IF NOT EXISTS mission_reassign_previews (
  preview_id TEXT PRIMARY KEY NOT NULL,
  mission_id TEXT NOT NULL REFERENCES mission_runs(mission_id) ON DELETE CASCADE,
  requirement_id TEXT NOT NULL,
  source_cluster_id TEXT,
  target_cluster_id TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  committed_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_mission_reassign_previews_mission
  ON mission_reassign_previews(mission_id, created_at DESC);

CREATE TABLE IF NOT EXISTS mission_session_bindings (
  session_id TEXT PRIMARY KEY NOT NULL,
  mission_id TEXT NOT NULL REFERENCES mission_runs(mission_id) ON DELETE CASCADE,
  project_id TEXT,
  attached_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_mission_session_bindings_mission
  ON mission_session_bindings(mission_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_mission_session_bindings_project
  ON mission_session_bindings(project_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS mission_instructions (
  instruction_id TEXT PRIMARY KEY NOT NULL,
  mission_id TEXT NOT NULL REFERENCES mission_runs(mission_id) ON DELETE CASCADE,
  session_id TEXT,
  target_kind TEXT NOT NULL,
  target_id TEXT,
  instruction TEXT NOT NULL,
  actor TEXT,
  status TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  delivered_at INTEGER,
  metadata_json TEXT NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_mission_instructions_target
  ON mission_instructions(mission_id, target_kind, target_id, created_at DESC);

CREATE TABLE IF NOT EXISTS mission_agent_commands (
  command_id TEXT PRIMARY KEY NOT NULL,
  mission_id TEXT NOT NULL REFERENCES mission_runs(mission_id) ON DELETE CASCADE,
  command_type TEXT NOT NULL,
  target_kind TEXT NOT NULL,
  target_id TEXT,
  assignment_id TEXT,
  agent_run_id TEXT,
  status TEXT NOT NULL,
  requested_at INTEGER NOT NULL,
  completed_at INTEGER,
  result_json TEXT NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_mission_agent_commands_mission
  ON mission_agent_commands(mission_id, requested_at DESC);

CREATE TABLE IF NOT EXISTS mission_evidence (
  evidence_id TEXT PRIMARY KEY NOT NULL,
  mission_id TEXT NOT NULL REFERENCES mission_runs(mission_id) ON DELETE CASCADE,
  task_id TEXT,
  requirement_id TEXT,
  cluster_id TEXT,
  agent_run_id TEXT,
  repository_path TEXT,
  evidence_type TEXT NOT NULL,
  status TEXT NOT NULL,
  summary TEXT,
  payload_json TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_mission_evidence_mission_created
  ON mission_evidence(mission_id, created_at ASC);

CREATE INDEX IF NOT EXISTS idx_mission_evidence_task
  ON mission_evidence(mission_id, task_id, created_at ASC);

CREATE INDEX IF NOT EXISTS idx_mission_evidence_requirement
  ON mission_evidence(mission_id, requirement_id, created_at ASC);
