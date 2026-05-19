-- Assistant linkage for mission/agent ledger.
--
-- Adds an `assistant_id` reference column to all three audit tables so each
-- mission, mission-side assignment, and trellis-side agent run can be
-- attributed to a specific assistant (`builtin:prd-split`, `custom:<id>`, ...).
-- Also adds `task_dir` to mission_runs so the assistant conversation can locate
-- the `.trellis/tasks/<MM-DD-slug>` directory it was created against.
--
-- Existing rows keep `assistant_id IS NULL` and `task_dir IS NULL` to mark the
-- "pre-assistant era". UI surfaces label these as legacy entries.

ALTER TABLE mission_runs              ADD COLUMN assistant_id TEXT;
ALTER TABLE mission_runs              ADD COLUMN task_dir TEXT;
ALTER TABLE mission_agent_assignments ADD COLUMN assistant_id TEXT;
ALTER TABLE trellis_agent_runs        ADD COLUMN assistant_id TEXT;

CREATE INDEX IF NOT EXISTS idx_mission_runs_assistant
  ON mission_runs(assistant_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_mission_runs_task_dir
  ON mission_runs(task_dir);

CREATE INDEX IF NOT EXISTS idx_mission_agent_assignments_assistant
  ON mission_agent_assignments(assistant_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_trellis_agent_runs_assistant
  ON trellis_agent_runs(assistant_id, updated_at DESC);
