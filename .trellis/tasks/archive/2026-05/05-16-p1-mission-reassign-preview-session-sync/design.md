# P1 Mission Planning Mutations and Main-Session Synchronization — Design

## 1. Boundary

This task extends the P0 Mission backend. Frontend drag-and-drop and chat UI are not implemented here.

Data flow:

```text
MissionControl / main session hooks
  -> src/services/missionControlBackend.ts
  -> Tauri IPC commands in src-tauri/src/mission_control.rs
  -> SQLite tables from 021_mission_control_planning_evidence.sql
  -> mission-updated frontend event
```

## 2. Persistence

Migration `021_mission_control_planning_evidence.sql` adds:

- `mission_reassign_previews`: deterministic, expiring impact previews.
- `mission_session_bindings`: sessionId -> missionId attachments.
- `mission_instructions`: structured user instructions targeted at task, cluster, repository, or assignment.
- `mission_agent_commands`: durable retry, pause, cancel, and instruction command records.

## 3. Reassignment Preview

`mission_preview_requirement_reassign` reads the latest Mission snapshot and returns:

- source and target clusters.
- affected clusters.
- invalidated task ids.
- manual edit cluster ids.
- dependency task ids.
- active/completed agent assignments that need retry or cancellation.

The preview id is deterministic from Mission id, requirement id, target cluster, and snapshot update timestamp. This makes repeated previews stable for the same state and input.

## 4. Commit

`mission_commit_requirement_reassign` marks the preview committed, patches `snapshot.clusterPlanEdits.reassignedRequirements`, updates the Mission snapshot, and appends `mission.requirement.reassigned`.

The backend does not try to re-run the full frontend reducer. It records the canonical mutation so the reducer/UI can replay or refresh from the persisted snapshot.

## 5. Session Sync

`mission_attach_to_session` binds a Mission to a main chat session. `mission_get_session_mission` resolves that binding. `mission_append_instruction` stores structured instructions with target routing metadata so the main session and subagent surfaces can consume the same backend contract.

## 6. Agent Commands

`mission_record_agent_command` records retry/pause/cancel/instruction commands. Pause/cancel are explicitly recorded as runtime-dependent rather than pretending every local process can be paused.
