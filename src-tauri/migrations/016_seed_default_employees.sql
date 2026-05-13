-- 首次数据库初始化时创建默认员工与工作流（幂等）

INSERT OR IGNORE INTO employees (id, name, agent_type, enabled, created_at, updated_at, display_order)
VALUES
  ('emp-dev-001',   'Developer',  'general-purpose', 1, 0, 0, 1000),
  ('emp-reviewer-001', 'Reviewer', 'code-reviewer', 1, 0, 0, 2000);

INSERT OR IGNORE INTO workflows (id, name, is_default, created_at, updated_at)
VALUES ('wf-default-001', 'Standard Workflow', 1, 0, 0);

INSERT OR IGNORE INTO workflow_stages (id, workflow_id, name, stage_order, pass_rule, reject_rule)
VALUES
  ('stage-design',    'wf-default-001', 'Design',    1, 'all', 'any'),
  ('stage-dev',       'wf-default-001', 'Development', 2, 'all', 'any'),
  ('stage-review',    'wf-default-001', 'Review',    3, 'all', 'any');

INSERT OR IGNORE INTO stage_assignees (id, stage_id, employee_id, required_count, is_required)
VALUES
  ('assign-design-reviewer',  'stage-design',  'emp-reviewer-001', 1, 1),
  ('assign-dev-developer',    'stage-dev',     'emp-dev-001',      1, 1),
  ('assign-review-reviewer',  'stage-review',  'emp-reviewer-001', 1, 1);
