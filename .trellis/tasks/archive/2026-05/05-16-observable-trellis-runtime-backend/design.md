# Observable Trellis Runtime Backend Design

## Data Flow

```text
Trellis files / hooks / task.py / agent dispatch
  -> src-tauri/src/trellis_runtime.rs commands
  -> SQLite runtime tables in wise.db
  -> src/services/trellisRuntime.ts typed service
  -> future frontend panels
```

The backend owns validation and persistence. The TypeScript layer is only a typed IPC wrapper.

## Runtime Tables

- `trellis_runtime_events`: append-only observable ledger for hooks, workflow compilation, lifecycle commands, snapshots, onboarding checks, and user/backend actions.
- `trellis_agent_runs`: project-level ownership graph for Trellis agents, separate from Mission-specific assignments.
- `trellis_spec_revisions`: durable history for spec/workflow file changes.
- `trellis_workspace_snapshots`: hashed file manifests for `.trellis/` and platform integration files.

## API Surface

- `trellis_runtime_record_event`
- `trellis_runtime_list_events`
- `trellis_runtime_compile_workflow`
- `trellis_runtime_run_task_lifecycle`
- `trellis_runtime_upsert_agent_run`
- `trellis_runtime_get_agent_ownership_graph`
- `trellis_runtime_record_spec_revision`
- `trellis_runtime_list_spec_revisions`
- `trellis_runtime_get_onboarding_state`
- `trellis_runtime_get_replay`
- `trellis_runtime_capture_workspace_snapshot`
- `trellis_runtime_diff_workspace_snapshots`

## Validation Rules

- Project paths must be absolute, canonicalized, and existing directories.
- File snapshots are limited to `.trellis/`, `.codex/`, `.claude/`, and `.agents/skills/trellis-*`.
- Snapshot content hashes use SHA-256; snapshots store metadata and short previews, not full arbitrary file content.
- Task lifecycle commands run `.trellis/scripts/task.py` through argument arrays. No shell string execution.
- Command stdout/stderr are truncated before persistence.
- All DTOs use camelCase serialization.

## Tradeoffs

- The first backend pass accepts hook events through an IPC command but does not rewrite hook scripts. This keeps the backend contract reviewable and lets hook integration happen as a later small task.
- Runtime events are independent of Mission IDs. Mission Control can correlate through `projectId`, `taskPath`, `sessionId`, and optional payload fields without making Trellis runtime depend on PRD Mission state.
- Spec revision history stores full content for user-authored spec/workflow files. Snapshot manifests store hashes and metadata to avoid duplicating the workspace on every capture.
