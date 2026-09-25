-- 多仓库需求协作：仓库智能体、协作需求、任务依赖、交付包、修正单、共享资源、消息与验收。
-- 时间统一使用 UTC 毫秒；仓库沿用数字 id；不删除任何既有表。

CREATE TABLE IF NOT EXISTS collab_counters (
  name TEXT PRIMARY KEY NOT NULL,
  value INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS collab_request_log (
  request_id TEXT PRIMARY KEY NOT NULL,
  command TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  result_json TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

-- ── 仓库智能体 ─────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS repository_agent_profiles (
  id TEXT PRIMARY KEY NOT NULL,
  assistant_id TEXT,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  avatar_color TEXT,
  default_owner_project_id TEXT,
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'checked', 'enabled', 'disabled', 'archived')),
  active_revision INTEGER NOT NULL DEFAULT 0,
  draft_json TEXT NOT NULL DEFAULT '{}',
  draft_updated_at INTEGER NOT NULL DEFAULT 0,
  row_version INTEGER NOT NULL DEFAULT 1,
  last_check_json TEXT,
  auth_version INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS repository_agent_revisions (
  agent_id TEXT NOT NULL REFERENCES repository_agent_profiles(id) ON DELETE CASCADE,
  revision INTEGER NOT NULL,
  config_json TEXT NOT NULL,
  config_hash TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'publish' CHECK (source IN ('publish', 'rollback', 'import', 'template')),
  rollback_of INTEGER,
  note TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  PRIMARY KEY (agent_id, revision)
);

CREATE TABLE IF NOT EXISTS repository_agent_bindings (
  id TEXT PRIMARY KEY NOT NULL,
  agent_id TEXT NOT NULL REFERENCES repository_agent_profiles(id) ON DELETE CASCADE,
  project_id TEXT NOT NULL,
  repository_id INTEGER NOT NULL,
  responsibility TEXT NOT NULL DEFAULT '',
  role_tags_json TEXT NOT NULL DEFAULT '[]',
  access_scope TEXT NOT NULL DEFAULT 'read_write' CHECK (access_scope IN ('read', 'read_write')),
  override_json TEXT NOT NULL DEFAULT '{}',
  is_default INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'unbound')),
  auth_version INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE (agent_id, project_id, repository_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_repository_agent_default_binding
  ON repository_agent_bindings (project_id, repository_id)
  WHERE is_default = 1 AND status = 'active';

CREATE INDEX IF NOT EXISTS idx_repository_agent_bindings_repo
  ON repository_agent_bindings (repository_id, status);

CREATE TABLE IF NOT EXISTS repository_agent_memories (
  id TEXT PRIMARY KEY NOT NULL,
  agent_id TEXT NOT NULL REFERENCES repository_agent_profiles(id) ON DELETE CASCADE,
  scope TEXT NOT NULL CHECK (scope IN ('agent', 'repository', 'requirement')),
  project_id TEXT,
  repository_id INTEGER,
  requirement_id TEXT,
  content TEXT NOT NULL,
  source_attempt_id TEXT,
  evidence_json TEXT NOT NULL DEFAULT '[]',
  trust TEXT NOT NULL DEFAULT 'candidate' CHECK (trust IN ('verified', 'candidate', 'user')),
  revision INTEGER NOT NULL DEFAULT 1,
  dedupe_key TEXT NOT NULL,
  expires_at INTEGER,
  deleted_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_repository_agent_memories_dedupe
  ON repository_agent_memories (agent_id, dedupe_key) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS repository_agent_memory_revisions (
  memory_id TEXT NOT NULL REFERENCES repository_agent_memories(id) ON DELETE CASCADE,
  revision INTEGER NOT NULL,
  content TEXT NOT NULL,
  trust TEXT NOT NULL,
  change_kind TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (memory_id, revision)
);

-- ── 协作空间 ───────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS collaboration_spaces (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  dispatch_policy_json TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS collaboration_members (
  space_id TEXT NOT NULL REFERENCES collaboration_spaces(id) ON DELETE CASCADE,
  project_id TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'member')),
  joined_at INTEGER NOT NULL,
  PRIMARY KEY (space_id, project_id)
);

-- ── 会话派发意图 ───────────────────────────────────────────

CREATE TABLE IF NOT EXISTS agent_dispatch_intents (
  request_id TEXT PRIMARY KEY NOT NULL,
  origin_session_id TEXT,
  origin_message_id TEXT,
  agent_id TEXT NOT NULL,
  mode TEXT NOT NULL CHECK (mode IN ('discuss', 'plan', 'execute')),
  requirement_id TEXT,
  project_context TEXT,
  body TEXT NOT NULL,
  attachments_json TEXT NOT NULL DEFAULT '[]',
  payload_hash TEXT NOT NULL,
  state TEXT NOT NULL,
  result_json TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- ── 协作需求 ───────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS collab_requirements (
  id TEXT PRIMARY KEY NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  image_paths_json TEXT NOT NULL DEFAULT '[]',
  owner_project_id TEXT,
  owner_agent_id TEXT,
  profile_revision INTEGER,
  business_status TEXT NOT NULL DEFAULT 'open' CHECK (business_status IN ('open', 'verifying', 'done')),
  control_status TEXT NOT NULL DEFAULT 'active'
    CHECK (control_status IN ('active', 'pausing', 'paused', 'cancelling', 'cancelled')),
  stage TEXT NOT NULL DEFAULT 'planning',
  revision INTEGER NOT NULL DEFAULT 1,
  requirement_revision INTEGER NOT NULL DEFAULT 1,
  active_plan_revision INTEGER NOT NULL DEFAULT 0,
  plan_approval_required INTEGER NOT NULL DEFAULT 0,
  acceptance_policy TEXT NOT NULL DEFAULT 'manual' CHECK (acceptance_policy IN ('manual', 'machine')),
  collaboration_mode TEXT NOT NULL DEFAULT 'serial' CHECK (collaboration_mode IN ('serial', 'contract_parallel')),
  generation INTEGER NOT NULL DEFAULT 1,
  priority INTEGER NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0,
  max_concurrent_attempts INTEGER NOT NULL DEFAULT 2,
  execution_attempt_budget INTEGER NOT NULL DEFAULT 3,
  repair_round_budget INTEGER NOT NULL DEFAULT 3,
  budget_ms INTEGER,
  extra_scope_json TEXT NOT NULL DEFAULT '[]',
  origin_session_id TEXT,
  legacy_id TEXT,
  legacy_json TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_collab_requirements_legacy
  ON collab_requirements (legacy_id) WHERE legacy_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS collab_requirement_projects (
  requirement_id TEXT NOT NULL REFERENCES collab_requirements(id) ON DELETE CASCADE,
  project_id TEXT NOT NULL,
  responsibility TEXT NOT NULL DEFAULT 'participant',
  created_at INTEGER NOT NULL,
  PRIMARY KEY (requirement_id, project_id)
);

CREATE TABLE IF NOT EXISTS collab_requirement_revisions (
  requirement_id TEXT NOT NULL REFERENCES collab_requirements(id) ON DELETE CASCADE,
  revision INTEGER NOT NULL,
  kind TEXT NOT NULL,
  body TEXT NOT NULL,
  input TEXT NOT NULL DEFAULT '',
  state TEXT NOT NULL DEFAULT 'received',
  created_at INTEGER NOT NULL,
  PRIMARY KEY (requirement_id, revision)
);

CREATE TABLE IF NOT EXISTS collab_requirement_sessions (
  requirement_id TEXT NOT NULL REFERENCES collab_requirements(id) ON DELETE CASCADE,
  session_id TEXT NOT NULL,
  relation TEXT NOT NULL CHECK (relation IN ('origin', 'execution', 'legacy')),
  created_at INTEGER NOT NULL,
  PRIMARY KEY (requirement_id, session_id, relation)
);

CREATE INDEX IF NOT EXISTS idx_collab_requirement_sessions_session
  ON collab_requirement_sessions (session_id);

CREATE TABLE IF NOT EXISTS collab_plan_revisions (
  requirement_id TEXT NOT NULL REFERENCES collab_requirements(id) ON DELETE CASCADE,
  revision INTEGER NOT NULL,
  plan_json TEXT NOT NULL,
  rationale_json TEXT NOT NULL DEFAULT '{}',
  state TEXT NOT NULL CHECK (state IN ('proposed', 'active', 'superseded', 'rejected')),
  revision_kind TEXT NOT NULL DEFAULT 'initial',
  created_by_attempt_id TEXT,
  activated_at INTEGER,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (requirement_id, revision)
);

CREATE TABLE IF NOT EXISTS collab_tasks (
  id TEXT PRIMARY KEY NOT NULL,
  requirement_id TEXT NOT NULL REFERENCES collab_requirements(id) ON DELETE CASCADE,
  plan_revision INTEGER NOT NULL DEFAULT 0,
  task_key TEXT NOT NULL,
  title TEXT NOT NULL,
  project_id TEXT,
  repository_id INTEGER,
  role TEXT NOT NULL DEFAULT '',
  kind TEXT NOT NULL CHECK (kind IN ('plan', 'implement', 'repair', 'qa', 'env', 'legacy')),
  state TEXT NOT NULL CHECK (state IN (
    'waiting_dependencies', 'ready', 'running', 'waiting_change', 'checking',
    'succeeded', 'failed', 'cancelled'
  )),
  active INTEGER NOT NULL DEFAULT 1,
  revision INTEGER NOT NULL DEFAULT 1,
  spec_revision INTEGER NOT NULL DEFAULT 1,
  spec_json TEXT NOT NULL DEFAULT '{}',
  spec_hash TEXT NOT NULL DEFAULT '',
  executor_agent_id TEXT,
  profile_revision INTEGER,
  delegated_by_task_id TEXT,
  delegation_depth INTEGER NOT NULL DEFAULT 0,
  runtime_target TEXT NOT NULL DEFAULT 'local',
  workspace_binding_json TEXT NOT NULL DEFAULT '{}',
  checkpoint_id TEXT,
  generation INTEGER NOT NULL DEFAULT 0,
  failure_count INTEGER NOT NULL DEFAULT 0,
  attempt_budget INTEGER NOT NULL DEFAULT 3,
  next_action TEXT NOT NULL DEFAULT 'start',
  change_request_id TEXT,
  repair_round INTEGER,
  result_json TEXT,
  priority INTEGER NOT NULL DEFAULT 0,
  queued_at INTEGER NOT NULL,
  superseded_by TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_collab_tasks_requirement ON collab_tasks (requirement_id, active);
CREATE INDEX IF NOT EXISTS idx_collab_tasks_state ON collab_tasks (state, active);
CREATE UNIQUE INDEX IF NOT EXISTS ux_collab_tasks_repair_round
  ON collab_tasks (change_request_id, repair_round) WHERE kind = 'repair';

CREATE TABLE IF NOT EXISTS collab_dependencies (
  id TEXT PRIMARY KEY NOT NULL,
  requirement_id TEXT NOT NULL REFERENCES collab_requirements(id) ON DELETE CASCADE,
  plan_revision INTEGER NOT NULL,
  task_id TEXT NOT NULL REFERENCES collab_tasks(id) ON DELETE CASCADE,
  producer_task_id TEXT NOT NULL REFERENCES collab_tasks(id) ON DELETE CASCADE,
  gate_kind TEXT NOT NULL CHECK (gate_kind IN ('artifact_ready', 'task_succeeded', 'contract_available')),
  artifact_selector TEXT,
  required_version INTEGER,
  validation_policy_json TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_collab_dependencies_task ON collab_dependencies (task_id);

CREATE TABLE IF NOT EXISTS collab_attempts (
  id TEXT PRIMARY KEY NOT NULL,
  task_id TEXT NOT NULL REFERENCES collab_tasks(id) ON DELETE CASCADE,
  requirement_id TEXT NOT NULL,
  generation INTEGER NOT NULL,
  session_id TEXT,
  dispatch_key TEXT NOT NULL UNIQUE,
  secret TEXT NOT NULL,
  action TEXT NOT NULL DEFAULT 'start',
  covered_changes_json TEXT NOT NULL DEFAULT '[]',
  input_manifest_json TEXT NOT NULL DEFAULT '{}',
  effective_config_manifest_json TEXT NOT NULL DEFAULT '{}',
  lease_owner TEXT NOT NULL,
  lease_expiry INTEGER NOT NULL,
  fencing_token INTEGER NOT NULL,
  workspace_key TEXT,
  state TEXT NOT NULL CHECK (state IN (
    'claimed', 'running', 'stop_requested', 'stop_pending', 'lost', 'finished'
  )),
  stop_reason TEXT,
  result TEXT,
  result_json TEXT,
  reported_json TEXT,
  started_at INTEGER,
  finished_at INTEGER,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_collab_attempts_task ON collab_attempts (task_id);
CREATE INDEX IF NOT EXISTS idx_collab_attempts_state ON collab_attempts (state);
CREATE INDEX IF NOT EXISTS idx_collab_attempts_session ON collab_attempts (session_id);
CREATE UNIQUE INDEX IF NOT EXISTS ux_collab_attempts_one_active_per_task
  ON collab_attempts (task_id) WHERE state <> 'finished';

CREATE TABLE IF NOT EXISTS collab_workspace_locks (
  workspace_key TEXT PRIMARY KEY NOT NULL,
  attempt_id TEXT NOT NULL,
  fencing_token INTEGER NOT NULL,
  acquired_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS collab_checkpoints (
  id TEXT PRIMARY KEY NOT NULL,
  task_id TEXT NOT NULL REFERENCES collab_tasks(id) ON DELETE CASCADE,
  attempt_id TEXT,
  code_location_json TEXT NOT NULL DEFAULT '{}',
  worktree_digest TEXT NOT NULL DEFAULT '',
  completed_json TEXT NOT NULL DEFAULT '[]',
  todo_json TEXT NOT NULL DEFAULT '[]',
  failing_cases_json TEXT NOT NULL DEFAULT '[]',
  locked_versions_json TEXT NOT NULL DEFAULT '[]',
  resume_notes TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS collab_verification_runs (
  id TEXT PRIMARY KEY NOT NULL,
  requirement_id TEXT NOT NULL,
  task_id TEXT NOT NULL,
  attempt_id TEXT,
  repository_id INTEGER,
  kind TEXT NOT NULL DEFAULT 'command' CHECK (kind IN ('command', 'health', 'contract')),
  command TEXT NOT NULL,
  cwd TEXT NOT NULL DEFAULT '',
  exit_code INTEGER,
  passed INTEGER NOT NULL DEFAULT 0,
  head_commit TEXT,
  dirty INTEGER NOT NULL DEFAULT 0,
  output_tail TEXT NOT NULL DEFAULT '',
  started_at INTEGER NOT NULL,
  finished_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_collab_verification_runs_task ON collab_verification_runs (task_id);

-- ── 交付包 ─────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS collab_artifacts (
  id TEXT PRIMARY KEY NOT NULL,
  requirement_id TEXT NOT NULL REFERENCES collab_requirements(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'api_contract',
  producer_task_key TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE (requirement_id, name)
);

CREATE TABLE IF NOT EXISTS collab_artifact_versions (
  id TEXT PRIMARY KEY NOT NULL,
  artifact_id TEXT NOT NULL REFERENCES collab_artifacts(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  requirement_id TEXT NOT NULL,
  producer_task_id TEXT NOT NULL,
  attempt_id TEXT,
  fencing_token INTEGER,
  plan_revision INTEGER NOT NULL DEFAULT 0,
  repository_id INTEGER,
  commit_sha TEXT,
  branch TEXT,
  contract_json TEXT NOT NULL DEFAULT '{}',
  contract_hash TEXT NOT NULL DEFAULT '',
  runtime_target_id TEXT NOT NULL DEFAULT 'local',
  environment_id TEXT,
  endpoint TEXT,
  health_url TEXT,
  deployed_commit TEXT,
  health_check_at INTEGER,
  credential_ref TEXT,
  setup_guide_ref TEXT,
  fixture_refs_json TEXT NOT NULL DEFAULT '[]',
  test_evidence_json TEXT NOT NULL DEFAULT '[]',
  compatibility TEXT NOT NULL DEFAULT 'unknown' CHECK (compatibility IN ('compatible', 'breaking', 'unknown')),
  supersedes_version INTEGER,
  affected_operations_json TEXT NOT NULL DEFAULT '[]',
  changed_fields_json TEXT NOT NULL DEFAULT '[]',
  is_draft INTEGER NOT NULL DEFAULT 0,
  validation_state TEXT NOT NULL DEFAULT 'pending'
    CHECK (validation_state IN ('pending', 'valid', 'invalid', 'invalidated')),
  validation_json TEXT NOT NULL DEFAULT '{}',
  invalid_reason TEXT,
  created_at INTEGER NOT NULL,
  UNIQUE (artifact_id, version)
);

CREATE INDEX IF NOT EXISTS idx_collab_artifact_versions_requirement
  ON collab_artifact_versions (requirement_id, validation_state);

CREATE TABLE IF NOT EXISTS collab_artifact_consumers (
  task_id TEXT NOT NULL REFERENCES collab_tasks(id) ON DELETE CASCADE,
  artifact_version_id TEXT NOT NULL REFERENCES collab_artifact_versions(id) ON DELETE CASCADE,
  operations_json TEXT NOT NULL DEFAULT '[]',
  verification TEXT NOT NULL DEFAULT 'pending' CHECK (verification IN ('pending', 'passed', 'failed')),
  impact TEXT NOT NULL DEFAULT 'none' CHECK (impact IN ('none', 'affected', 'reverify')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (task_id, artifact_version_id)
);

-- ── 修正单 ─────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS collab_change_requests (
  id TEXT PRIMARY KEY NOT NULL,
  requirement_id TEXT NOT NULL REFERENCES collab_requirements(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  producer_task_id TEXT,
  reporter_task_id TEXT NOT NULL,
  dedupe_key TEXT NOT NULL,
  category TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN (
    'open', 'triaged', 'fixing', 'ready_for_retest', 'verified', 'closed', 'needs_decision', 'rejected'
  )),
  round INTEGER NOT NULL DEFAULT 1,
  revision INTEGER NOT NULL DEFAULT 1,
  round_budget INTEGER NOT NULL DEFAULT 3,
  payload_json TEXT NOT NULL,
  current_repair_task_id TEXT,
  candidate_artifact_version_id TEXT,
  merged_into TEXT,
  resolution_json TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_collab_change_requests_requirement
  ON collab_change_requests (requirement_id, state);
CREATE INDEX IF NOT EXISTS idx_collab_change_requests_dedupe
  ON collab_change_requests (requirement_id, dedupe_key);

CREATE TABLE IF NOT EXISTS collab_change_consumers (
  change_request_id TEXT NOT NULL REFERENCES collab_change_requests(id) ON DELETE CASCADE,
  consumer_task_id TEXT NOT NULL,
  round INTEGER NOT NULL,
  expected_version INTEGER,
  retest_attempt_id TEXT,
  ack_status TEXT NOT NULL DEFAULT 'waiting'
    CHECK (ack_status IN ('waiting', 'passed', 'failed', 'transferred', 'released')),
  evidence_json TEXT NOT NULL DEFAULT '{}',
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (change_request_id, consumer_task_id, round)
);

-- ── 共享资源 ───────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS collab_resources (
  id TEXT PRIMARY KEY NOT NULL,
  owner_project_id TEXT,
  owner_agent_id TEXT,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  maintainer TEXT NOT NULL DEFAULT '',
  visibility TEXT NOT NULL DEFAULT 'source'
    CHECK (visibility IN ('source', 'space', 'granted', 'agent_private')),
  space_id TEXT,
  repository_id INTEGER,
  location TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked', 'archived')),
  auth_version INTEGER NOT NULL DEFAULT 1,
  latest_version INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS collab_resource_versions (
  id TEXT PRIMARY KEY NOT NULL,
  resource_id TEXT NOT NULL REFERENCES collab_resources(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  content TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  source_ref_json TEXT NOT NULL DEFAULT '{}',
  publisher TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  published_at INTEGER NOT NULL,
  UNIQUE (resource_id, version)
);

CREATE TABLE IF NOT EXISTS collab_resource_grants (
  id TEXT PRIMARY KEY NOT NULL,
  resource_id TEXT NOT NULL REFERENCES collab_resources(id) ON DELETE CASCADE,
  grantee_kind TEXT NOT NULL CHECK (grantee_kind IN ('project', 'agent', 'task', 'space')),
  grantee_id TEXT NOT NULL,
  auth_version INTEGER NOT NULL,
  revoked_at INTEGER,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_collab_resource_grants_resource ON collab_resource_grants (resource_id);

CREATE TABLE IF NOT EXISTS collab_resource_subscriptions (
  id TEXT PRIMARY KEY NOT NULL,
  resource_id TEXT NOT NULL REFERENCES collab_resources(id) ON DELETE CASCADE,
  subscriber_kind TEXT NOT NULL CHECK (subscriber_kind IN ('project', 'agent')),
  subscriber_id TEXT NOT NULL,
  tracked_version INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE (resource_id, subscriber_kind, subscriber_id)
);

CREATE TABLE IF NOT EXISTS collab_resource_suggestions (
  id TEXT PRIMARY KEY NOT NULL,
  resource_id TEXT NOT NULL REFERENCES collab_resources(id) ON DELETE CASCADE,
  from_project_id TEXT,
  from_task_id TEXT,
  body TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'open' CHECK (state IN ('open', 'accepted', 'rejected')),
  created_at INTEGER NOT NULL
);

-- ── 事件、消息与投递 ───────────────────────────────────────

CREATE TABLE IF NOT EXISTS collab_events (
  id TEXT PRIMARY KEY NOT NULL,
  requirement_id TEXT NOT NULL,
  aggregate_seq INTEGER NOT NULL,
  type TEXT NOT NULL,
  payload_json TEXT NOT NULL DEFAULT '{}',
  correlation_id TEXT,
  causation_id TEXT,
  created_at INTEGER NOT NULL,
  UNIQUE (requirement_id, aggregate_seq)
);

CREATE TABLE IF NOT EXISTS collab_messages (
  id TEXT PRIMARY KEY NOT NULL,
  requirement_id TEXT NOT NULL,
  type TEXT NOT NULL,
  source_task_id TEXT,
  target_task_id TEXT,
  correlation_id TEXT,
  causation_id TEXT,
  aggregate_seq INTEGER,
  plan_revision INTEGER,
  change_revision INTEGER,
  round INTEGER,
  artifact_refs_json TEXT NOT NULL DEFAULT '[]',
  checkpoint_id TEXT,
  action TEXT,
  body_json TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_collab_messages_requirement ON collab_messages (requirement_id, created_at);
CREATE INDEX IF NOT EXISTS idx_collab_messages_target ON collab_messages (target_task_id);

CREATE TABLE IF NOT EXISTS collab_deliveries (
  message_id TEXT NOT NULL REFERENCES collab_messages(id) ON DELETE CASCADE,
  target_kind TEXT NOT NULL CHECK (target_kind IN ('task', 'ui', 'channel')),
  target_id TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'queued'
    CHECK (state IN ('queued', 'delivered', 'received', 'processed', 'failed', 'dropped')),
  attempts INTEGER NOT NULL DEFAULT 0,
  next_retry_at INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (message_id, target_kind, target_id)
);

CREATE INDEX IF NOT EXISTS idx_collab_deliveries_state ON collab_deliveries (target_kind, state, next_retry_at);

CREATE TABLE IF NOT EXISTS collab_outbox (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  requirement_id TEXT NOT NULL,
  event_id TEXT,
  message_id TEXT,
  channel TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'pending' CHECK (state IN ('pending', 'done', 'dead')),
  attempts INTEGER NOT NULL DEFAULT 0,
  next_retry_at INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_collab_outbox_pending ON collab_outbox (channel, state, next_retry_at);

-- ── 决策、修订、验收、环境、用量 ───────────────────────────

CREATE TABLE IF NOT EXISTS collab_decisions (
  id TEXT PRIMARY KEY NOT NULL,
  requirement_id TEXT NOT NULL REFERENCES collab_requirements(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  dedupe_key TEXT NOT NULL,
  title TEXT NOT NULL,
  task_ids_json TEXT NOT NULL DEFAULT '[]',
  blocked_ops_json TEXT NOT NULL DEFAULT '[]',
  evidence_json TEXT NOT NULL DEFAULT '{}',
  options_json TEXT NOT NULL DEFAULT '[]',
  state TEXT NOT NULL DEFAULT 'open' CHECK (state IN ('open', 'resolved', 'cancelled')),
  resolution_json TEXT,
  revision INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_collab_decisions_open
  ON collab_decisions (requirement_id, dedupe_key) WHERE state = 'open';

CREATE TABLE IF NOT EXISTS collab_revision_impacts (
  id TEXT PRIMARY KEY NOT NULL,
  requirement_id TEXT NOT NULL REFERENCES collab_requirements(id) ON DELETE CASCADE,
  from_plan_revision INTEGER NOT NULL,
  to_plan_revision INTEGER NOT NULL,
  requirement_revision INTEGER NOT NULL,
  task_key TEXT NOT NULL,
  task_id TEXT,
  action TEXT NOT NULL CHECK (action IN ('keep', 'redo', 'add', 'cancel')),
  reason TEXT NOT NULL DEFAULT '',
  input_hash TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS collab_acceptance_manifests (
  id TEXT PRIMARY KEY NOT NULL,
  requirement_id TEXT NOT NULL REFERENCES collab_requirements(id) ON DELETE CASCADE,
  revision INTEGER NOT NULL,
  manifest_json TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('current', 'stale', 'accepted', 'rejected')),
  policy TEXT NOT NULL DEFAULT 'manual',
  conclusion_json TEXT,
  request_id TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE (requirement_id, revision)
);

CREATE TABLE IF NOT EXISTS collab_runtime_resources (
  id TEXT PRIMARY KEY NOT NULL,
  kind TEXT NOT NULL,
  name TEXT NOT NULL,
  owner_requirement_id TEXT NOT NULL,
  owner_task_id TEXT,
  start_attempt_id TEXT,
  stop_method TEXT NOT NULL DEFAULT '',
  endpoint TEXT,
  port INTEGER,
  pid INTEGER,
  state TEXT NOT NULL DEFAULT 'running' CHECK (state IN ('running', 'stop_requested', 'stopped')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS collab_runtime_consumers (
  resource_id TEXT NOT NULL REFERENCES collab_runtime_resources(id) ON DELETE CASCADE,
  requirement_id TEXT NOT NULL,
  task_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  released_at INTEGER,
  PRIMARY KEY (resource_id, requirement_id, task_id)
);

CREATE TABLE IF NOT EXISTS collab_usage_ledger (
  event_id TEXT PRIMARY KEY NOT NULL,
  requirement_id TEXT NOT NULL,
  attempt_id TEXT,
  kind TEXT NOT NULL DEFAULT 'execution',
  duration_ms INTEGER NOT NULL DEFAULT 0,
  tokens INTEGER,
  source TEXT NOT NULL DEFAULT 'wise',
  confidence TEXT NOT NULL DEFAULT 'estimated' CHECK (confidence IN ('exact', 'estimated', 'unavailable')),
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_collab_usage_ledger_requirement ON collab_usage_ledger (requirement_id);
