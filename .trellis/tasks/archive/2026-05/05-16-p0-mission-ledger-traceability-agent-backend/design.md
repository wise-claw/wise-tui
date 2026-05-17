# P0 Mission Ledger, Traceability Index, and Live Agent Assignments — Design

## 1. Boundary

This task adds backend contracts and service wrappers only. It does not redesign MissionControl UI and does not change the existing PRD split reducer behavior.

Data flow:

```text
MissionControl / future hooks
  -> src/services/missionControlBackend.ts
  -> Tauri IPC commands in src-tauri/src/mission_control.rs
  -> SQLite tables in wise.db
  -> frontend events for assignment changes
```

## 2. Persistence

Add migration `020_mission_control.sql` with three new tables:

- `mission_runs`: durable latest Mission snapshot and identity.
- `mission_events`: append-only Mission event log.
- `mission_agent_assignments`: live agent ownership / heartbeat records.

Snapshots and events store JSON as text because the Mission reducer schema is still evolving. This keeps this P0 additive and avoids prematurely baking the full frontend reducer shape into SQLite columns. Query-critical fields remain columns: `mission_id`, `project_id`, `root_path`, `stage`, `status`, timestamps, agent status, repository/task IDs.

## 3. IPC Commands

Add commands:

- `mission_create_or_resume`
- `mission_get_snapshot`
- `mission_list_recent`
- `mission_append_event`
- `mission_get_requirement_trace`
- `mission_upsert_agent_assignment`
- `mission_complete_agent_assignment`
- `mission_list_agent_assignments`

DTOs use camelCase at the IPC boundary. Backend validates required IDs and JSON payloads before writing.

## 4. Traceability

`mission_get_requirement_trace` reads the stored Mission snapshot JSON and builds a requirement-centric trace from flexible fields:

- `requirementsIndex` or `requirementsIndexJson`
- `plan.clusters` or `clusters`
- `clusterRuns`
- `writeResults`
- `repositories`
- current agent assignments

The parser tolerates missing fields and older snapshots. It returns stable empty arrays rather than failing when optional data is absent.

## 5. Agent Assignments

Assignments are keyed by `assignmentId`, with a unique optional `agentRunId`.

Status values are intentionally open strings at the DB layer but frontend types use a bounded union for current known states. This leaves room for future runtimes while keeping UI contracts typed.

Assignment writes emit a `mission-agent-assignment-changed` event with the changed assignment.

## 6. Tradeoffs

- JSON snapshot storage is chosen for compatibility and speed. P1/P2 can normalize more fields after the Mission ledger stabilizes.
- This P0 does not attach Mission execution to existing splitter calls yet. It provides the backend surface needed for MissionControl to start writing into the ledger incrementally.
- Stale assignment detection is supported through `staleAfterMs` filtering in list commands instead of a background sweeper.
