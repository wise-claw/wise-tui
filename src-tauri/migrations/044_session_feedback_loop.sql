-- 反馈神经网：闭环历史与配置补丁效果（替代 localStorage 持久化）

CREATE TABLE IF NOT EXISTS session_feedback_loop_history (
  id TEXT PRIMARY KEY NOT NULL,
  session_id TEXT NOT NULL,
  repository_path TEXT NOT NULL,
  repository_name TEXT,
  claude_session_id TEXT,
  completed_at_ms INTEGER NOT NULL,
  completion_reason TEXT,
  cycle_count INTEGER NOT NULL,
  max_cycles INTEGER NOT NULL,
  final_overall_score REAL,
  improved_cycles INTEGER NOT NULL,
  final_summary TEXT NOT NULL DEFAULT '',
  habits_json TEXT NOT NULL DEFAULT '[]',
  trend_json TEXT NOT NULL DEFAULT '[]'
);

CREATE INDEX IF NOT EXISTS idx_session_feedback_history_repo_completed
  ON session_feedback_loop_history (repository_path, completed_at_ms DESC);

CREATE TABLE IF NOT EXISTS session_feedback_patch_effectiveness (
  id TEXT PRIMARY KEY NOT NULL,
  repository_path TEXT NOT NULL,
  kind TEXT NOT NULL,
  action TEXT NOT NULL,
  path TEXT NOT NULL,
  source TEXT NOT NULL,
  applied_at_ms INTEGER NOT NULL,
  overhead_delta_json TEXT,
  session_final_score REAL
);

CREATE INDEX IF NOT EXISTS idx_session_feedback_patch_repo_applied
  ON session_feedback_patch_effectiveness (repository_path, applied_at_ms DESC);
