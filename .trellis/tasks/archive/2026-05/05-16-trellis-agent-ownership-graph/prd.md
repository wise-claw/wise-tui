# Trellis Agent Ownership Graph

## Goal

Track which Trellis agent is working on which task, session, repository, and file so Wise can later show team/agent ownership across the selected project.

## Requirements

- Upsert project-level agent runs independent from Mission assignments.
- Support filtering by project/root/session/task/status.
- Return graph nodes for agents, tasks, repositories, and sessions plus ownership edges.

## Acceptance Criteria

- [ ] `trellis_runtime_upsert_agent_run` persists current agent ownership state.
- [ ] `trellis_runtime_get_agent_ownership_graph` returns agents and edges for visualization.
- [ ] Agent runs have heartbeat and completion timestamps.
