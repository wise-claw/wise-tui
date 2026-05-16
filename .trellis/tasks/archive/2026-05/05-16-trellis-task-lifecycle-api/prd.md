# Trellis Task Lifecycle API

## Goal

Expose Trellis task lifecycle operations through Wise backend commands that run `.trellis/scripts/task.py` and record observable results.

## Requirements

- Support create, start, finish, archive, validate, add-context, and list-context operations.
- Validate project root and command inputs before execution.
- Persist stdout/stderr summaries, exit code, status, and task path in the runtime ledger.

## Acceptance Criteria

- [ ] `trellis_runtime_run_task_lifecycle` builds argument arrays, not shell strings.
- [ ] Command result records are returned to callers and appended to runtime events.
- [ ] Invalid lifecycle actions are rejected before process execution.
