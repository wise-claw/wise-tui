-- Migration 043: Trellis/Mission/PRD split features removed; drop legacy tables and settings.

DROP TABLE IF EXISTS mission_evidence;
DROP TABLE IF EXISTS mission_agent_commands;
DROP TABLE IF EXISTS mission_instructions;
DROP TABLE IF EXISTS mission_session_bindings;
DROP TABLE IF EXISTS mission_reassign_previews;
DROP TABLE IF EXISTS mission_agent_assignments;
DROP TABLE IF EXISTS mission_events;
DROP TABLE IF EXISTS mission_runs;

DROP TABLE IF EXISTS trellis_workspace_snapshots;
DROP TABLE IF EXISTS trellis_spec_revisions;
DROP TABLE IF EXISTS trellis_agent_runs;
DROP TABLE IF EXISTS trellis_runtime_events;

DROP TABLE IF EXISTS project_prd_employees;
DROP TABLE IF EXISTS project_prd_workflows;
DROP TABLE IF EXISTS prd_executable_tasks;
DROP TABLE IF EXISTS prd_task_split_results;

DELETE FROM app_settings WHERE key LIKE 'split_prompt_layers:%';
DELETE FROM app_settings WHERE key LIKE 'repo_task_split_prompt:%';
DELETE FROM app_settings WHERE key = 'prd_task_draft';
DELETE FROM app_settings WHERE key = 'prd_task_split_result';
